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

function findName(roster, userId) {
  if (roster.getLastRow() < 2) return null;
  const rows = roster.getRange(2, 1, roster.getLastRow() - 1, 2).getValues();
  for (const r of rows) if (r[0] === userId && r[1]) return String(r[1]);
  return null;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
