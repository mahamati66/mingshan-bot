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
 *   護持統計：自動加總每個人的存福、存慧點數
 *   活動行事曆：福慧存摺「本月重點活動」的來源
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
const TYPES = ['修福', '修慧'];

// 修福紀錄、修慧紀錄的欄位：時間｜日期｜姓名｜地點｜LINE ID
const LOG_COLS = 5;

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  TYPES.forEach(type => {
    const log = ss.getSheetByName(LOGS[type]) || ss.insertSheet(LOGS[type]);
    log.getRange(1, 1, 1, LOG_COLS).setValues([['時間', '日期', '姓名', '地點', 'LINE ID']]);
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

  // 活動行事曆：福慧存摺的「本月重點活動」從這裡讀，每月由知客處更新
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
    const fn = { passbook: passbook, admin: admin }[req.action] || handle;
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

  // 3. 看這個人今天這一類碰過幾次、今年這一類幾點、累積幾點
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const year = today.slice(0, 4);
  const todayRows = [];
  let yearCount = 0;
  let total = 0;
  for (const r of logRows(ss)) {
    if (r[5] !== req.userId) continue;
    total++;
    if (r[4] !== type) continue;
    if (r[1].slice(0, 4) === year) yearCount++;
    if (r[1] === today) todayRows.push(r);
  }

  // 4. 這一類今天已經滿 2 點
  if (todayRows.length >= MAX_PER_DAY) {
    return { ok: true, status: 'dailyMax', name: name, type: type, times: todayRows.map(r => hhmm(r[0])) };
  }

  // 5. 這一類今天上一次打卡還沒滿 4 小時
  if (todayRows.length) {
    const lastAt = new Date(todayRows[todayRows.length - 1][0]);
    const nextAt = new Date(lastAt.getTime() + GAP_HOURS * 3600 * 1000);
    if (now < nextAt) {
      const nextDay = Utilities.formatDate(nextAt, TZ, 'yyyy-MM-dd') !== today;
      return {
        ok: true, status: 'tooSoon', name: name, type: type,
        lastAt: hhmm(lastAt), nextAt: nextDay ? '' : hhmm(nextAt),
        justNow: now - lastAt < 5 * 60 * 1000,
      };
    }
  }

  // 6. 記 1 點到修福紀錄或修慧紀錄
  ss.getSheetByName(LOGS[type]).appendRow([now, today, name, req.spot, req.userId]);
  return {
    ok: true, status: 'arrive', name: name, type: type,
    count: yearCount + 1, total: total + 1, today: todayRows.length + 1,
  };
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
