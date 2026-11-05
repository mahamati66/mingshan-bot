/**
 * 明善寺 義工打卡 —— Google Apps Script（貼到試算表的「擴充功能 → Apps Script」）
 *
 * 試算表會有三個工作表：
 *   打卡紀錄：每一次碰貼紙的紀錄
 *   義工名冊：LINE 帳號 ↔ 名字（名字要改，直接改這裡）
 *   護持統計：自動加總每個人的修福、修慧次數與時數
 *
 * 第一次使用：把 SECRET 改掉 → 執行一次 setup() → 部署成「網頁應用程式」。
 */

// 要跟伺服器的 CHECKIN_SECRET 一模一樣
const SECRET = '請改成一組只有你知道的密碼';
const TZ = 'Asia/Taipei';
// 幾分鐘內重複碰，視為不小心多碰一下，不另外記錄
const REPEAT_MINUTES = 3;

const LOG = '打卡紀錄';
const ROSTER = '義工名冊';
const STATS = '護持統計';
const TYPES = ['修福', '修慧'];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const log = ss.getSheetByName(LOG) || ss.insertSheet(LOG);
  log.getRange(1, 1, 1, 8).setValues([['時間', '日期', '姓名', '地點', '類別', '狀態', '時數', 'LINE ID']]);
  log.setFrozenRows(1);
  log.getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm');
  log.getRange('B:B').setNumberFormat('@');  // 日期存成文字，避免被自動轉格式
  log.hideColumns(8);

  const roster = ss.getSheetByName(ROSTER) || ss.insertSheet(ROSTER);
  roster.getRange(1, 1, 1, 4).setValues([['LINE ID', '姓名', 'LINE 名稱', '登記時間']]);
  roster.setFrozenRows(1);
  roster.getRange('D:D').setNumberFormat('yyyy/mm/dd hh:mm');

  const stats = ss.getSheetByName(STATS) || ss.insertSheet(STATS);
  stats.clear();
  stats.getRange('A1').setValue('修福（發心工作）');
  stats.getRange('A2').setFormula(
    `=IFERROR(QUERY('${LOG}'!A2:G, "select C, count(C), sum(G) where E = '修福' and F = '圓滿' group by C order by sum(G) desc label C '姓名', count(C) '次數', sum(G) '時數'", 0), "尚無紀錄")`);
  stats.getRange('E1').setValue('修慧（來上課）');
  stats.getRange('E2').setFormula(
    `=IFERROR(QUERY('${LOG}'!A2:G, "select C, count(C), sum(G) where E = '修慧' and F = '圓滿' group by C order by sum(G) desc label C '姓名', count(C) '次數', sum(G) '時數'", 0), "尚無紀錄")`);
  stats.getRange('A1:E1').setFontWeight('bold');
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
    return json(req.action === 'passbook' ? passbook(req) : handle(req));
  } finally {
    lock.releaseLock();
  }
}

/**
 * req: { userId, lineName, spot, spotType, name?, type? }
 *   spotType：這張貼紙預設的類別（修福／修慧），空的代表要讓義工自己選
 */
function handle(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = ss.getSheetByName(LOG);
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

  // 2. 找這個人最近一筆紀錄，順便算今年各類別來了幾次
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const year = today.slice(0, 4);
  const rows = log.getLastRow() > 1 ? log.getRange(2, 1, log.getLastRow() - 1, 8).getValues() : [];
  let last = null;
  const yearCount = { 修福: 0, 修慧: 0 };
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r[7] !== req.userId) continue;
    if (!last) last = r;
    if (String(r[1]).slice(0, 4) === year && r[5] === '到寺' && yearCount[r[4]] !== undefined) {
      yearCount[r[4]]++;
    }
  }

  // 3. 剛剛才碰過：不重複記
  if (last && now - new Date(last[0]) < REPEAT_MINUTES * 60 * 1000) {
    return { ok: true, status: 'repeat', name: name, state: last[5], type: last[4] };
  }

  // 4. 今天已經到寺、還沒圓滿 → 這次是圓滿（類別跟著到寺時的類別）
  if (last && String(last[1]) === today && last[5] === '到寺') {
    const minutes = Math.round((now - new Date(last[0])) / 60000);
    const hours = Math.round(minutes / 60 * 100) / 100;
    log.appendRow([now, today, name, req.spot, last[4], '圓滿', hours, req.userId]);
    return { ok: true, status: 'leave', name: name, type: last[4], minutes: minutes };
  }

  // 5. 否則就是到寺：先確定是修福還是修慧
  const type = TYPES.indexOf(req.spotType) >= 0 ? req.spotType
             : TYPES.indexOf(req.type) >= 0 ? req.type
             : null;
  if (!type) return { ok: true, status: 'needType', name: name };

  log.appendRow([now, today, name, req.spot, type, '到寺', '', req.userId]);
  return { ok: true, status: 'arrive', name: name, type: type, count: yearCount[type] + 1 };
}

/**
 * 福慧存摺：每次「到寺」記 1 點，分存福（修福）、存慧（修慧）
 * req: { userId }
 */
function passbook(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = findName(ss.getSheetByName(ROSTER), req.userId);
  if (!name) return { ok: true, status: 'notRegistered' };

  const log = ss.getSheetByName(LOG);
  const rows = log.getLastRow() > 1 ? log.getRange(2, 1, log.getLastRow() - 1, 8).getValues() : [];
  const points = { 修福: 0, 修慧: 0 };
  const hours = { 修福: 0, 修慧: 0 };
  const visits = [];  // 每次到寺一筆，圓滿時把時數補上去
  for (const r of rows) {
    if (r[7] !== req.userId || points[r[4]] === undefined) continue;
    if (r[5] === '到寺') {
      points[r[4]]++;
      visits.push({ date: String(r[1]), type: r[4], spot: r[3], minutes: null });
    } else if (r[5] === '圓滿') {
      hours[r[4]] += Number(r[6]) || 0;
      const v = visits[visits.length - 1];
      if (v && v.date === String(r[1]) && v.minutes === null) v.minutes = Math.round((Number(r[6]) || 0) * 60);
    }
  }
  const recent = visits.slice(-10).reverse();

  return {
    ok: true,
    status: 'passbook',
    name: name,
    fu: points['修福'],
    hui: points['修慧'],
    fuHours: Math.round(hours['修福'] * 10) / 10,
    huiHours: Math.round(hours['修慧'] * 10) / 10,
    recent: recent,
  };
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
 * 修福／修慧的次數與時數、總點數、最常在哪裡、第一次與最近一次、1～12 月各來幾次
 */
function yearReport(year) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = ss.getSheetByName(LOG);
  const rows = log.getLastRow() > 1 ? log.getRange(2, 1, log.getLastRow() - 1, 8).getValues() : [];

  const people = {};  // 以 LINE ID 為準，名字取名冊上最新的
  const roster = ss.getSheetByName(ROSTER);
  const names = {};
  if (roster.getLastRow() > 1) {
    roster.getRange(2, 1, roster.getLastRow() - 1, 2).getValues().forEach(r => { names[r[0]] = r[1]; });
  }

  for (const r of rows) {
    const date = String(r[1]);
    if (date.slice(0, 4) !== year || TYPES.indexOf(r[4]) < 0) continue;
    const id = r[7] || r[2];
    const p = people[id] || (people[id] = {
      name: names[id] || r[2], fu: 0, hui: 0, fuH: 0, huiH: 0,
      spots: {}, first: date, last: date, months: new Array(12).fill(0),
    });
    if (r[5] === '到寺') {
      if (r[4] === '修福') p.fu++; else p.hui++;
      p.spots[r[3]] = (p.spots[r[3]] || 0) + 1;
      p.months[Number(date.slice(5, 7)) - 1]++;
      if (date < p.first) p.first = date;
      if (date > p.last) p.last = date;
    } else if (r[5] === '圓滿') {
      if (r[4] === '修福') p.fuH += Number(r[6]) || 0; else p.huiH += Number(r[6]) || 0;
    }
  }

  const list = Object.values(people)
    .filter(p => p.fu + p.hui > 0)
    .sort((a, b) => (b.fu + b.hui) - (a.fu + a.hui) || (b.fuH + b.huiH) - (a.fuH + a.huiH));
  const r1 = n => Math.round(n * 10) / 10;
  const favorite = spots => Object.keys(spots).sort((a, b) => spots[b] - spots[a])[0] || '';

  const header = ['姓名', '總點數', '存福（次）', '修福時數', '存慧（次）', '修慧時數', '總時數',
    '最常在', '第一次來', '最近一次', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const body = list.map(p => [p.name, p.fu + p.hui, p.fu, r1(p.fuH), p.hui, r1(p.huiH), r1(p.fuH + p.huiH),
    favorite(p.spots), p.first, p.last].concat(p.months));

  const total = ['全寺合計', 0, 0, 0, 0, 0, 0, `${list.length} 位義工`, '', ''].concat(new Array(12).fill(0));
  body.forEach(b => {
    [1, 2, 3, 4, 5, 6].forEach(i => { total[i] += b[i]; });
    for (let m = 0; m < 12; m++) total[10 + m] += b[10 + m];
  });
  [3, 5, 6].forEach(i => { total[i] = r1(total[i]); });

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
    sheet.getRange(5, 1, body.length, header.length).setValues(body);
    sheet.getRange(5, 9, body.length, 2).setNumberFormat('@');
  }
  sheet.setFrozenRows(4);
  sheet.setFrozenColumns(1);
  sheet.autoResizeColumns(1, header.length);
  ss.setActiveSheet(sheet);
}

function findName(roster, userId) {
  if (roster.getLastRow() < 2) return null;
  const rows = roster.getRange(2, 1, roster.getLastRow() - 1, 2).getValues();
  for (const r of rows) if (r[0] === userId && r[1]) return String(r[1]);
  return null;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
