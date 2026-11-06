/**
 * 明善寺 義工打卡 —— Google Apps Script（貼到試算表的「擴充功能 → Apps Script」）
 *
 * 規則：來寺裡時碰一下貼紙＝ +1 點（修福＝存福、修慧＝存慧）
 *       修福、修慧分開算：各自一天最多 2 點，同一類第二次要跟第一次隔 4 小時以上
 *
 * 試算表會有這些工作表：
 *   修福紀錄：發心工作，每一列就是 1 點（存福）
 *   修慧紀錄：來上課、共修聞法，每一列就是 1 點（存慧）
 *   義工名冊：LINE 帳號 ↔ 名字（名字要改，直接改這裡）
 *            「權限」欄填「負責人」，這個人就能在 LINE 看全部義工的點數
 *            「權限」欄填「班長」（或負責人），這個人就能幫長輩代打卡
 *            沒有 LINE 的長輩由班長新增，LINE ID 欄會是「無LINE-」開頭
 *   護持統計：自動加總每個人的存福、存慧點數
 *   活動行事曆：福慧存摺「本月重點活動」的來源
 *   信眾打卡：LINE 官方帳號傳「打卡」的紀錄（一人一天一列）
 *
 * 第一次使用：把 SECRET 改掉 → 執行一次 setup() → 部署成「網頁應用程式」。
 */

// 要跟伺服器的 CHECKIN_SECRET 一模一樣
const SECRET = '請改成一組只有你知道的密碼';
const TZ = 'Asia/Taipei';
// 修福、修慧各自一天最多幾點
const MAX_PER_DAY = 2;
// 同一類同一天兩次打卡至少要隔幾小時
const GAP_HOURS = 4;

const LOGS = { 修福: '修福紀錄', 修慧: '修慧紀錄' };
const ROSTER = '義工名冊';
const STATS = '護持統計';
const EVENTS = '活動行事曆';
const DEVOTEE = '信眾打卡';
const TYPES = ['修福', '修慧'];

// 修福紀錄、修慧紀錄的欄位：時間｜日期｜姓名｜地點｜LINE ID｜代打卡（班長名字）
const LOG_COLS = 5;  // 讀取用到前 5 欄
// 可以代打卡的權限
const PROXY_ROLES = ['班長', '負責人'];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  TYPES.forEach(type => {
    const log = ss.getSheetByName(LOGS[type]) || ss.insertSheet(LOGS[type]);
    log.getRange(1, 1, 1, 6).setValues([['時間', '日期', '姓名', '地點', 'LINE ID', '代打卡']]);
    log.setFrozenRows(1);
    log.getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm');
    log.getRange('B:B').setNumberFormat('@');  // 日期存成文字，避免被自動轉格式
    log.hideColumns(LOG_COLS);
  });

  const roster = ss.getSheetByName(ROSTER) || ss.insertSheet(ROSTER);
  roster.getRange(1, 1, 1, 5).setValues([['LINE ID', '姓名', 'LINE 名稱', '登記時間', '權限']]);
  roster.setFrozenRows(1);
  roster.getRange('D:D').setNumberFormat('yyyy/mm/dd hh:mm');

  const stats = ss.getSheetByName(STATS) || ss.insertSheet(STATS);
  stats.clear();
  stats.getRange('A1').setValue('存福（發心工作）');
  stats.getRange('A2').setFormula(
    `=IFERROR(QUERY('${LOGS['修福']}'!A2:E, "select C, count(C) where C <> '' group by C order by count(C) desc label C '姓名', count(C) '點數'", 0), "尚無紀錄")`);
  stats.getRange('D1').setValue('存慧（來上課）');
  stats.getRange('D2').setFormula(
    `=IFERROR(QUERY('${LOGS['修慧']}'!A2:E, "select C, count(C) where C <> '' group by C order by count(C) desc label C '姓名', count(C) '點數'", 0), "尚無紀錄")`);
  stats.getRange('A1:D1').setFontWeight('bold');

  // 信眾打卡：LINE 官方帳號傳「打卡」
  const devotee = ss.getSheetByName(DEVOTEE) || ss.insertSheet(DEVOTEE);
  devotee.getRange(1, 1, 1, 4).setValues([['日期', '時間', '姓名', 'LINE ID']]);
  devotee.setFrozenRows(1);
  devotee.getRange('A:A').setNumberFormat('@');
  devotee.getRange('B:B').setNumberFormat('yyyy/mm/dd hh:mm');
  devotee.hideColumns(4);

  // 活動行事曆：福慧存摺的「本月重點活動」從這裡讀，每月由客堂更新
  let events = ss.getSheetByName(EVENTS);
  if (!events) {
    events = ss.insertSheet(EVENTS);
    events.getRange('A:A').setNumberFormat('@');  // 月份存成文字
    events.getRange(1, 1, 1, 6).setValues([['月份', '活動', '類別', '日期', '時間', '圖示']]);
    events.getRange(2, 1, 4, 6).setValues([
      ['2026-11', '大悲懺法會', '修慧', '1日', '14:30-17:00', '🏮'],
      ['2026-11', '中午值班', '修福', '每天', '13:00-15:30', '✨'],
      ['2026-11', '佛學班', '修慧', '每週五（6、13、20、27日）', '19:30-21:00', '📖'],
      ['2026-11', '環保組服務', '修福', '3、7、10、14日', '07:00-08:00', '🌿'],
    ]);
    events.setFrozenRows(1);
    events.getRange('A1:F1').setFontWeight('bold');
  }
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'bad_request' });
  }
  if (req.secret !== SECRET) return json({ ok: false, error: 'unauthorized' });

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const fn = {
      passbook: passbook, admin: admin, proxyList: proxyList, proxyCheckin: proxyCheckin,
      devoteeCheckin: devoteeCheckin, devoteeStats: devoteeStats, devoteeReport: devoteeReport,
    }[req.action] || handle;
    return json(fn(req));
  } finally {
    lock.releaseLock();
  }
}

// 把修福紀錄、修慧紀錄合在一起，照時間排好
// 每一列整理成：0 時間｜1 日期｜2 姓名｜3 地點｜4 類別｜5 LINE ID
function logRows(ss) {
  const all = [];
  TYPES.forEach(type => {
    const log = ss.getSheetByName(LOGS[type]);
    if (!log || log.getLastRow() < 2) return;
    log.getRange(2, 1, log.getLastRow() - 1, LOG_COLS).getValues().forEach(r => {
      if (r[4]) all.push([r[0], String(r[1]), r[2], r[3], type, r[4]]);
    });
  });
  return all.sort((a, b) => new Date(a[0]) - new Date(b[0]));
}

const hhmm = d => Utilities.formatDate(new Date(d), TZ, 'HH:mm');

/**
 * 打卡
 * req: { userId, lineName, spot, spotType, name?, type? }
 *   spotType：這張貼紙預設的類別（修福／修慧），空的代表要讓義工自己選
 */
function handle(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const roster = ss.getSheetByName(ROSTER);
  const now = new Date();

  // 1. 認人：從名冊找這個 LINE 帳號；第一次來就請他留名字
  let name = findName(roster, req.userId);
  if (!name) {
    const newName = String(req.name || '').trim().slice(0, 20);
    if (!newName) return { ok: true, status: 'needName', lineName: req.lineName || '' };
    roster.appendRow([req.userId, newName, req.lineName || '', now]);
    name = newName;
  }

  // 2. 確定是修福還是修慧
  const type = TYPES.indexOf(req.spotType) >= 0 ? req.spotType
             : TYPES.indexOf(req.type) >= 0 ? req.type
             : null;
  if (!type) return { ok: true, status: 'needType', name: name };

  return recordCheckin(ss, { userId: req.userId, name: name, type: type, spot: req.spot, by: '' });
}

/**
 * 記 1 點（本人打卡、班長代打卡共用同一套規則）
 * p: { userId, name, type, spot, by }   by：代打卡的班長名字，本人打卡留空
 */
function recordCheckin(ss, p) {
  const now = new Date();
  // 看這個人今天這一類碰過幾次、今年這一類幾點、累積幾點
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const year = today.slice(0, 4);
  const todayRows = [];
  let yearCount = 0;
  let total = 0;
  for (const r of logRows(ss)) {
    if (r[5] !== p.userId) continue;
    total++;
    if (r[4] !== p.type) continue;
    if (r[1].slice(0, 4) === year) yearCount++;
    if (r[1] === today) todayRows.push(r);
  }
  const base = { ok: true, name: p.name, type: p.type };

  // 這一類今天已經滿 2 點
  if (todayRows.length >= MAX_PER_DAY) {
    return Object.assign(base, { status: 'dailyMax', times: todayRows.map(r => hhmm(r[0])) });
  }

  // 這一類今天上一次打卡還沒滿 4 小時
  if (todayRows.length) {
    const lastAt = new Date(todayRows[todayRows.length - 1][0]);
    const nextAt = new Date(lastAt.getTime() + GAP_HOURS * 3600 * 1000);
    if (now < nextAt) {
      const nextDay = Utilities.formatDate(nextAt, TZ, 'yyyy-MM-dd') !== today;
      return Object.assign(base, {
        status: 'tooSoon', lastAt: hhmm(lastAt), nextAt: nextDay ? '' : hhmm(nextAt),
        justNow: now - lastAt < 5 * 60 * 1000,
      });
    }
  }

  // 記 1 點到修福紀錄或修慧紀錄
  ss.getSheetByName(LOGS[p.type]).appendRow([now, today, p.name, p.spot, p.userId, p.by || '']);
  return Object.assign(base, {
    status: 'arrive', count: yearCount + 1, total: total + 1, today: todayRows.length + 1,
  });
}

// =====================================================================
// 班長代打卡
// =====================================================================

function proxyAllowed(roster, userId) {
  const me = findPerson(roster, userId);
  return me && PROXY_ROLES.indexOf(me.role) >= 0 ? me : null;
}

function rosterMembers(roster) {
  if (roster.getLastRow() < 2) return [];
  return roster.getRange(2, 1, roster.getLastRow() - 1, 2).getValues()
    .filter(r => r[0] && r[1])
    .map(r => ({ id: String(r[0]), name: String(r[1]), noLine: String(r[0]).indexOf('無LINE-') === 0 }));
}

/** 代打卡名單 req: { userId } */
function proxyList(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const roster = ss.getSheetByName(ROSTER);
  const me = proxyAllowed(roster, req.userId);
  if (!me) return { ok: false, error: 'forbidden' };

  // 今天每個人已經打過哪些類別，讓班長一眼看出來
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const done = {};
  for (const r of logRows(ss)) {
    if (r[1] !== today) continue;
    const d = done[r[5]] || (done[r[5]] = { 修福: 0, 修慧: 0 });
    d[r[4]]++;
  }
  const members = rosterMembers(roster)
    .map(m => Object.assign(m, { today: done[m.id] || { 修福: 0, 修慧: 0 } }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  return { ok: true, status: 'proxyList', me: me.name, members: members };
}

/**
 * 代打卡 req: { userId, targetId?, newName?, type, spot }
 *   targetId：名冊上的人；newName：新增一位沒有 LINE 的長輩
 */
function proxyCheckin(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const roster = ss.getSheetByName(ROSTER);
  const me = proxyAllowed(roster, req.userId);
  if (!me) return { ok: false, error: 'forbidden' };
  if (TYPES.indexOf(req.type) < 0) return { ok: false, error: 'bad_type' };

  let target = null;
  const members = rosterMembers(roster);
  if (req.newName) {
    const name = String(req.newName).trim().slice(0, 20);
    if (!name) return { ok: false, error: 'bad_name' };
    const same = members.filter(m => m.name === name);
    if (same.length) return { ok: true, status: 'nameExists', name: name, id: same[0].id };
    target = { id: '無LINE-' + Utilities.getUuid().slice(0, 8), name: name };
    roster.appendRow([target.id, name, '', new Date(), '']);
  } else {
    target = members.filter(m => m.id === req.targetId)[0];
    if (!target) return { ok: false, error: 'no_member' };
  }
  const result = recordCheckin(ss, { userId: target.id, name: target.name, type: req.type, spot: req.spot, by: me.name });
  return Object.assign(result, { targetId: target.id });
}

/**
 * 福慧存摺：自己的存福、存慧點數與最近足跡
 * req: { userId }
 */
function passbook(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const person = findPerson(ss.getSheetByName(ROSTER), req.userId);
  if (!person) return { ok: true, status: 'notRegistered' };

  const points = { 修福: 0, 修慧: 0 };
  const visits = [];
  for (const r of logRows(ss)) {
    if (r[5] !== req.userId || TYPES.indexOf(r[4]) < 0) continue;
    points[r[4]]++;
    visits.push({ date: String(r[1]), time: hhmm(r[0]), type: r[4], spot: String(r[3]) });
  }

  return {
    ok: true,
    status: 'passbook',
    name: person.name,
    fu: points['修福'],
    hui: points['修慧'],
    recent: visits.slice(-10).reverse(),
    events: monthEvents(ss),
    isAdmin: person.role === '負責人',
    canProxy: PROXY_ROLES.indexOf(person.role) >= 0,
  };
}

/**
 * 負責人總覽：全部義工的點數（只有名冊「權限」欄是「負責人」的人能看）
 * req: { userId }
 */
function admin(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const roster = ss.getSheetByName(ROSTER);
  const me = findPerson(roster, req.userId);
  if (!me || me.role !== '負責人') return { ok: false, error: 'forbidden' };

  const people = {};
  if (roster.getLastRow() > 1) {
    roster.getRange(2, 1, roster.getLastRow() - 1, 2).getValues().forEach(r => {
      if (r[0] && r[1]) people[r[0]] = { name: String(r[1]), fu: 0, hui: 0, yearPoints: 0, last: '' };
    });
  }
  const year = Utilities.formatDate(new Date(), TZ, 'yyyy');
  for (const r of logRows(ss)) {
    const p = people[r[5]];
    if (!p || TYPES.indexOf(r[4]) < 0) continue;
    const date = String(r[1]);
    if (r[4] === '修福') p.fu++; else p.hui++;
    if (date.slice(0, 4) === year) p.yearPoints++;
    if (date > p.last) p.last = date;
  }
  const list = Object.values(people).sort((a, b) => (b.fu + b.hui) - (a.fu + a.hui));
  return { ok: true, status: 'admin', year: year, people: list };
}

// =====================================================================
// 信眾打卡（LINE 官方帳號傳「打卡」「存摺」）：一人一天算一次
// =====================================================================

function devoteeSheet(ss) {
  let sheet = ss.getSheetByName(DEVOTEE);
  if (!sheet) {  // 舊試算表沒跑過新版 setup 時，自動補上
    sheet = ss.insertSheet(DEVOTEE);
    sheet.getRange(1, 1, 1, 4).setValues([['日期', '時間', '姓名', 'LINE ID']]);
    sheet.getRange('A:A').setNumberFormat('@');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function devoteeRows(sheet) {
  return sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues() : [];
}

function dayString(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

// 從這個人的打卡日期算：本月幾天、累計幾天、連續幾天
function devoteeNumbers(dates, today) {
  const set = {};
  dates.forEach(d => { set[d] = true; });
  const month = today.slice(0, 7);
  const all = Object.keys(set);
  // 連續天數：今天有打卡就從今天往回數；今天還沒打，就從昨天往回數（還沒斷）
  const day = new Date(today + 'T12:00:00+08:00');
  if (!set[today]) day.setDate(day.getDate() - 1);
  let streak = 0;
  while (set[dayString(day)]) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return {
    monthDays: all.filter(d => d.slice(0, 7) === month).length,
    totalDays: all.length,
    streak: streak,
    checkedToday: !!set[today],
  };
}

/** req: { userId, name } */
function devoteeCheckin(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = devoteeSheet(ss);
  const now = new Date();
  const today = dayString(now);
  const dates = devoteeRows(sheet).filter(r => r[3] === req.userId).map(r => String(r[0]));
  const already = dates.indexOf(today) >= 0;
  if (!already) {
    sheet.appendRow([today, now, String(req.name || '').slice(0, 40), req.userId]);
    dates.push(today);
  }
  return Object.assign({ ok: true, status: already ? 'already' : 'checkedIn' }, devoteeNumbers(dates, today));
}

/** req: { userId } */
function devoteeStats(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dates = devoteeRows(devoteeSheet(ss)).filter(r => r[3] === req.userId).map(r => String(r[0]));
  return Object.assign({ ok: true, status: 'stats' }, devoteeNumbers(dates, dayString(new Date())));
}

/** 每月統計 req: { month: 'yyyy-MM' } */
function devoteeReport(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const month = /^\d{4}-\d{2}$/.test(req.month || '') ? req.month : Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  const people = {};
  let visits = 0;
  for (const r of devoteeRows(devoteeSheet(ss))) {
    const date = String(r[0]);
    if (date.slice(0, 7) !== month || !r[3]) continue;
    const p = people[r[3]] || (people[r[3]] = { name: '', days: {}, last: '' });
    if (!p.days[date]) { p.days[date] = true; visits++; }
    if (r[2]) p.name = String(r[2]);  // 用最新的 LINE 名稱
    if (date > p.last) p.last = date;
  }
  const list = Object.values(people)
    .map(p => ({ name: p.name || '（未留名）', days: Object.keys(p.days).length, last: p.last }))
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
  return { ok: true, status: 'report', month: month, people: list, visits: visits };
}

// 本月重點活動（活動行事曆中「月份」等於這個月的）
function monthEvents(ss) {
  const sheet = ss.getSheetByName(EVENTS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const month = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues()
    .filter(r => {
      const m = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM') : String(r[0]).trim().replace('/', '-');
      return m === month && r[1];
    })
    .map(r => ({ name: String(r[1]), type: String(r[2]), days: String(r[3]), time: String(r[4]), icon: String(r[5] || '') }));
}

// 打開試算表時，上方多一個「明善寺」選單
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('明善寺')
    .addItem('產生年度護持報表', 'yearReportPrompt')
    .addToUi();
}

function yearReportPrompt() {
  const ui = SpreadsheetApp.getUi();
  const thisYear = Utilities.formatDate(new Date(), TZ, 'yyyy');
  const res = ui.prompt('年度護持報表', `要統計哪一年？（直接按確定＝${thisYear}）`, ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const year = (res.getResponseText().trim() || thisYear).replace(/\D/g, '');
  if (year.length !== 4) return ui.alert('請輸入四位數的年份，例如 2026');
  yearReport(year);
}

/**
 * 產生「YYYY 年度護持」工作表：每位義工一列
 * 總點數、存福、存慧、最常在哪裡、第一次與最近一次、1～12 月各幾點
 */
function yearReport(year) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const roster = ss.getSheetByName(ROSTER);
  const names = {};  // 以 LINE ID 為準，名字取名冊上最新的
  if (roster.getLastRow() > 1) {
    roster.getRange(2, 1, roster.getLastRow() - 1, 2).getValues().forEach(r => { names[r[0]] = r[1]; });
  }

  const people = {};
  for (const r of logRows(ss)) {
    const date = String(r[1]);
    if (date.slice(0, 4) !== year || TYPES.indexOf(r[4]) < 0) continue;
    const id = r[5] || r[2];
    const p = people[id] || (people[id] = {
      name: names[id] || r[2], fu: 0, hui: 0, spots: {}, first: date, last: date, months: new Array(12).fill(0),
    });
    if (r[4] === '修福') p.fu++; else p.hui++;
    p.spots[r[3]] = (p.spots[r[3]] || 0) + 1;
    p.months[Number(date.slice(5, 7)) - 1]++;
    if (date < p.first) p.first = date;
    if (date > p.last) p.last = date;
  }

  const list = Object.values(people).sort((a, b) => (b.fu + b.hui) - (a.fu + a.hui));
  const favorite = spots => Object.keys(spots).sort((a, b) => spots[b] - spots[a])[0] || '';

  const header = ['姓名', '總點數', '存福', '存慧', '最常在', '第一次來', '最近一次',
    '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const body = list.map(p => [p.name, p.fu + p.hui, p.fu, p.hui, favorite(p.spots), p.first, p.last].concat(p.months));

  const total = ['全寺合計', 0, 0, 0, `${list.length} 位義工`, '', ''].concat(new Array(12).fill(0));
  body.forEach(b => {
    [1, 2, 3].forEach(i => { total[i] += b[i]; });
    for (let m = 0; m < 12; m++) total[7 + m] += b[7 + m];
  });

  const sheetName = `${year} 年度護持`;
  const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sheet.clear();
  sheet.getRange(1, 1).setValue(`${year} 年度護持報表（產生時間：${Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm')}）`)
    .setFontWeight('bold').setFontSize(13);
  sheet.getRange(3, 1, 1, header.length).setValues([header])
    .setFontWeight('bold').setBackground('#efe6d6').setHorizontalAlignment('center');
  sheet.getRange(4, 1, 1, header.length).setValues([total])
    .setFontWeight('bold').setBackground('#e4ebe3');
  if (body.length) {
    sheet.getRange(5, 6, body.length, 2).setNumberFormat('@');
    sheet.getRange(5, 1, body.length, header.length).setValues(body);
  }
  sheet.setFrozenRows(4);
  sheet.setFrozenColumns(1);
  sheet.autoResizeColumns(1, header.length);
  ss.setActiveSheet(sheet);
}

function findPerson(roster, userId) {
  if (roster.getLastRow() < 2) return null;
  const rows = roster.getRange(2, 1, roster.getLastRow() - 1, 5).getValues();
  for (const r of rows) {
    if (r[0] === userId && r[1]) return { name: String(r[1]), role: String(r[4] || '').trim() };
  }
  return null;
}

function findName(roster, userId) {
  const p = findPerson(roster, userId);
  return p ? p.name : null;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
