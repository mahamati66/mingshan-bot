const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const app = express();
// 保留原始內容，LINE webhook 要用它驗證簽章
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mingshan2024';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';
// 回覆時順帶邀請即將到來活動的機率（0.3 = 約三則回覆邀請一次）
const INVITE_RATE = 0.3;
// 短留言（佛號、感恩）回覆的切入角度，每次隨機挑一個，讓回覆不重複
const SHORT_REPLY_ANGLES = [
  '祝福對方平安健康',
  '念佛時心的安定',
  '隨喜功德、善緣相續',
  '生活中的一點覺察',
  '感念因緣、珍惜當下',
  '願福慧增長、法喜充滿',
  '與家人共享這份善念',
  '持續修行、一步一腳印',
];

// === Webhook 驗證（GET）===
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook 驗證成功');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// === 健康檢查（給 UptimeRobot 用，避免打到 webhook）===
app.get('/', (req, res) => {
  res.status(200).send('明善寺小助手運行中 🙏');
});

// === Webhook 接收（POST）===
app.post('/webhook', async (req, res) => {
  // ⚠️ 重要：先回 200，避免 FB 超時停訂閱
  res.status(200).send('EVENT_RECEIVED');

  const body = req.body;
  if (body.object !== 'page') return;

  for (const entry of body.entry) {
    const changes = entry.changes || [];
    for (const change of changes) {
      if (change.field === 'feed' && change.value.item === 'comment') {
        // 過濾自己粉專回的留言，避免無限迴圈
        if (change.value.verb !== 'add') continue;
        if (change.value.from && change.value.from.id === entry.id) {
          console.log('忽略粉專自己的留言');
          continue;
        }

        const commentId = change.value.comment_id;
        const commentText = change.value.message;
        const postId = change.value.post_id;

        if (!commentText) {
          console.log('留言無文字內容，跳過');
          continue;
        }

        console.log('收到留言：', commentText);
        try {
          const post = postId ? await getPost(postId) : null;
          const reply = await generateReply(commentText, post);
          await postReply(commentId, reply);
        } catch (err) {
          console.error('處理留言時發生錯誤:', err);
        }
      }
    }
  }
});

// === 取得該留言所屬的貼文內容（讓回覆能呼應當天貼文主題）===
async function getPost(postId) {
  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/${postId}?fields=message,created_time&access_token=${PAGE_ACCESS_TOKEN}`);
    const data = await response.json();
    if (!data.message) return null;
    return { message: data.message, createdTime: data.created_time };
  } catch (err) {
    console.error('取得貼文內容失敗:', err);
    return null;
  }
}

// === 取得即將到來的活動（來自 events.json，過期的自動略過）===
function getUpcomingEvents(today) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'events.json'), 'utf8'))
      .filter(e => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(e => `- ${e.date}　${e.name}`)
      .join('\n');
  } catch (err) {
    console.error('讀取 events.json 失敗:', err);
    return '';
  }
}

// === 呼叫 Claude API 產生回覆 ===
async function generateReply(comment, post) {
  try {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
    const angle = SHORT_REPLY_ANGLES[Math.floor(Math.random() * SHORT_REPLY_ANGLES.length)];
    const upcomingEvents = Math.random() < INVITE_RATE ? getUpcomingEvents(today) : '';
    const upcomingContext = upcomingEvents
      ? `\n以下是明善寺即將到來的活動，可在祝福之後自然、簡短地順帶邀請對方參加最近的一場，不要寫得像廣告（只能用這份清單，不要編造活動或日期）：\n${upcomingEvents}\n\n`
      : '';
    const postDate = post && post.createdTime
      ? new Date(post.createdTime).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
      : '不明';
    const postContext = post
      ? `今天日期：${today}（台灣時間）。這則留言是留在以下這篇貼文底下（貼文發布日：${postDate}），如果貼文內容跟留言有關聯，回覆時可以自然呼應貼文主題。若貼文提到的活動、法會日期已經過了，不要再邀請對方參加那個已過期的活動，只給予祝福（例如隨喜功德、願法喜常在）：\n"${post.message}"\n\n`
      : '';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `你是竹山明善寺的小助手，請用溫暖、佛法的語氣，回覆這則臉書留言（繁體中文）。回覆長度要跟留言的份量相稱：
- 留言只是佛號、表情符號或「感恩」「隨喜」「讚嘆」這類簡短留言：這代表對方認同、隨喜貼文，請當成認同來回應。回 1～2 句，不超過 40 字，包含一句祝福，加上一點小小的想法或提點（不要引用經典原文、不要長篇講道理，也不要邀請活動）。這次請從「${angle}」的角度回應。開頭不要用「感謝您」「感恩您」「虔誠念誦」，也不要用「每一聲佛號」，直接從祝福或想法切入，每次用字都要不同。
- 留言有分享心得、感受或提問：回 40～80 字，具體呼應對方說的內容。
表情符號最多用一個 🙏，不要用其他表情符號。
若對方詢問地址或交通，請告知：地址：南投縣竹山鎮竹山路27號，電話：049-2642840。
12/20 阿彌陀佛聖誕暨明善寺落成50週年慶因需管控人數，僅開放已報名者參加：不要主動提及或邀請；若對方主動詢問，請告知需事先報名，並請來電洽詢 049-2642840。\n\n${postContext}${upcomingContext}留言內容："${comment}"`
        }]
      })
    });

    const data = await response.json();

    // 防呆：API 回錯誤時不會崩潰
    if (!data.content || !data.content[0] || !data.content[0].text) {
      console.error('Claude API 回傳異常:', JSON.stringify(data));
      return '感恩您的留言，阿彌陀佛 🙏';
    }

    return data.content[0].text;
  } catch (err) {
    console.error('Claude API 錯誤:', err);
    return '感恩您的留言，阿彌陀佛 🙏';
  }
}

// === 透過 Facebook Graph API 回覆留言 ===
async function postReply(commentId, message) {
  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/${commentId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        access_token: PAGE_ACCESS_TOKEN
      })
    });
    const data = await response.json();

    if (data.error) {
      console.error('Facebook API 回錯誤:', JSON.stringify(data.error));
    } else {
      console.log('回覆成功 (commentId:', commentId, ') →', data);
    }
  } catch (err) {
    console.error('回覆失敗:', err);
  }
}

// =====================================================================
// 義工打卡（NFC 貼紙 + LINE 登入）＋ 福慧存摺
// 貼紙網址：https://liff.line.me/<LIFF_ID>?spot=ketang
// 存摺網址：https://liff.line.me/<LIFF_ID>/passbook
// 負責人總覽：https://liff.line.me/<LIFF_ID>/admin（名冊「權限」欄填「負責人」才看得到）
// =====================================================================
const LIFF_ID = process.env.LIFF_ID || '';
const LINE_LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID || '';
const CHECKIN_SCRIPT_URL = process.env.CHECKIN_SCRIPT_URL || '';
const CHECKIN_SECRET = process.env.CHECKIN_SECRET || '';

// 四張貼紙：地點代號 → 顯示名稱、類別（type 留 null 代表讓義工自己選修福或修慧）
const CHECKIN_SPOTS = {
  ketang:  { label: '客堂',     type: '修福' },
  xidan:   { label: '西單客堂', type: '修福' },
  dadian:  { label: '大殿',     type: '修慧' },
  jiaoshi: { label: '教室',     type: '修慧' },
};

function loadPage(file) {
  try {
    return fs.readFileSync(path.join(__dirname, 'checkin', file), 'utf8')
      .replace('__LIFF_ID__', LIFF_ID.replace(/[^\w-]/g, ''));
  } catch (err) {
    console.error(`讀取 checkin/${file} 失敗:`, err);
    return '';
  }
}
const CHECKIN_PAGE = loadPage('checkin.html');
const PASSBOOK_PAGE = loadPage('passbook.html');
const ADMIN_PAGE = loadPage('admin.html');
const PROXY_PAGE = loadPage('proxy.html');
const LOTUS_JS = loadPage('lotus.js');

app.get('/checkin', (req, res) => res.type('html').send(CHECKIN_PAGE));
app.get('/checkin/passbook', (req, res) => res.type('html').send(PASSBOOK_PAGE));
app.get('/checkin/admin', (req, res) => res.type('html').send(ADMIN_PAGE));
app.get('/checkin/proxy', (req, res) => res.type('html').send(PROXY_PAGE));
app.get('/checkin/lotus.js', (req, res) => res.type('application/javascript').send(LOTUS_JS));

// 向 LINE 確認這個人真的是用 LINE 登入的，回傳 { userId, lineName }
async function verifyLineUser(idToken) {
  if (!idToken) return null;
  const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: LINE_LOGIN_CHANNEL_ID }),
  });
  const data = await response.json();
  if (!response.ok || !data.sub) {
    console.warn('LINE 身分驗證失敗:', data.error_description || data.error || response.status);
    return null;
  }
  return { userId: data.sub, lineName: data.name || '' };
}

// 把資料交給 Google Apps Script（寫進試算表）
async function callCheckinScript(payload) {
  const response = await fetch(CHECKIN_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ secret: CHECKIN_SECRET }, payload)),
  });
  return response.json();
}

function checkinConfigured(res) {
  if (LIFF_ID && LINE_LOGIN_CHANNEL_ID && CHECKIN_SCRIPT_URL && CHECKIN_SECRET) return true;
  console.error('打卡功能尚未設定完成：請設定 LIFF_ID、LINE_LOGIN_CHANNEL_ID、CHECKIN_SCRIPT_URL、CHECKIN_SECRET');
  res.status(500).json({ ok: false, error: 'not_configured' });
  return false;
}

app.post('/checkin/api', async (req, res) => {
  if (!checkinConfigured(res)) return;
  const { idToken, spot, name, type } = req.body || {};
  const spotInfo = CHECKIN_SPOTS[spot];
  if (!spotInfo) return res.json({ ok: false, error: 'bad_spot' });

  try {
    const user = await verifyLineUser(idToken);
    if (!user) return res.status(401).json({ ok: false, error: 'relogin' });

    const result = await callCheckinScript({
      userId: user.userId,
      lineName: user.lineName,
      spot: spotInfo.label,
      spotType: spotInfo.type,
      name: typeof name === 'string' ? name.trim().slice(0, 20) : '',
      type: type === '修福' || type === '修慧' ? type : '',
    });
    console.log('打卡：', spotInfo.label, result.status, result.name || '');
    res.json(Object.assign({ spotLabel: spotInfo.label }, result));
  } catch (err) {
    console.error('打卡失敗:', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// 班長代打卡（Apps Script 會再檢查是不是班長或負責人）
app.post('/checkin/proxy/api', async (req, res) => {
  if (!checkinConfigured(res)) return;
  const { idToken, op, targetId, newName, type, spot } = req.body || {};
  try {
    const user = await verifyLineUser(idToken);
    if (!user) return res.status(401).json({ ok: false, error: 'relogin' });

    if (op === 'list') {
      const result = await callCheckinScript({ action: 'proxyList', userId: user.userId });
      const spots = Object.entries(CHECKIN_SPOTS).map(([key, s]) => ({ key, label: s.label, type: s.type }));
      return res.json(Object.assign({ spots }, result));
    }

    const spotInfo = CHECKIN_SPOTS[spot];
    if (!spotInfo) return res.json({ ok: false, error: 'bad_spot' });
    if (type !== '修福' && type !== '修慧') return res.json({ ok: false, error: 'bad_type' });
    const result = await callCheckinScript({
      action: 'proxyCheckin',
      userId: user.userId,
      targetId: typeof targetId === 'string' ? targetId : '',
      newName: typeof newName === 'string' ? newName.trim().slice(0, 20) : '',
      type,
      spot: spotInfo.label,
    });
    console.log('代打卡：', spotInfo.label, type, result.status, result.name || '');
    res.json(result);
  } catch (err) {
    console.error('代打卡失敗:', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// 福慧存摺（只回自己的）與負責人總覽（Apps Script 會再檢查是不是負責人）
for (const action of ['passbook', 'admin']) {
  app.post(`/checkin/${action}/api`, async (req, res) => {
    if (!checkinConfigured(res)) return;
    try {
      const user = await verifyLineUser((req.body || {}).idToken);
      if (!user) return res.status(401).json({ ok: false, error: 'relogin' });
      res.json(await callCheckinScript({ action, userId: user.userId }));
    } catch (err) {
      console.error(`讀取 ${action} 失敗:`, err);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}

// =====================================================================
// LINE 官方帳號：信眾傳「打卡」「存摺」＋每月統計表
// Webhook URL：https://<機器人網址>/line/webhook
// 每月統計：https://<機器人網址>/line/report?key=<REPORT_KEY>
// =====================================================================
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const REPORT_KEY = process.env.REPORT_KEY || '';

const CHECKIN_WORDS = ['打卡'];
const PASSBOOK_WORDS = ['存摺', '存折', '福慧存摺', '福慧存折'];

function validLineSignature(req) {
  const signature = req.get('x-line-signature') || '';
  if (!LINE_CHANNEL_SECRET || !signature || !req.rawBody) return false;
  const expected = crypto.createHmac('sha256', LINE_CHANNEL_SECRET).update(req.rawBody).digest('base64');
  const a = Buffer.from(signature), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function lineReply(replyToken, text) {
  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
  if (!response.ok) console.error('LINE 回覆失敗:', response.status, await response.text());
}

async function lineDisplayName(userId) {
  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!response.ok) return '';
    return (await response.json()).displayName || '';
  } catch (err) {
    return '';
  }
}

async function handleLineText(event) {
  const text = (event.message.text || '').trim();
  const userId = event.source && event.source.userId;
  if (!userId) return;
  const isCheckin = CHECKIN_WORDS.includes(text);
  const isPassbook = PASSBOOK_WORDS.includes(text);
  if (!isCheckin && !isPassbook) return;  // 其他訊息交給官方帳號原本的自動回應

  if (!CHECKIN_SCRIPT_URL || !CHECKIN_SECRET) {
    console.error('信眾打卡尚未設定：請設定 CHECKIN_SCRIPT_URL、CHECKIN_SECRET');
    return lineReply(event.replyToken, '阿彌陀佛，打卡功能還在準備中，請稍候再試 🙏');
  }

  if (isCheckin) {
    const name = await lineDisplayName(userId);
    const r = await callCheckinScript({ action: 'devoteeCheckin', userId, name });
    if (!r.ok) throw new Error(JSON.stringify(r));
    const numbers = `累計 ${r.totalDays} 天，連續 ${r.streak} 天`;
    return lineReply(event.replyToken, r.status === 'already'
      ? `阿彌陀佛，今天已經打卡囉 🙏\n本月第 ${r.monthDays} 天，${numbers}`
      : `阿彌陀佛，今天是您本月第 ${r.monthDays} 天打卡，${numbers} 🙏`);
  }

  const r = await callCheckinScript({ action: 'devoteeStats', userId });
  if (!r.ok) throw new Error(JSON.stringify(r));
  if (!r.totalDays) {
    return lineReply(event.replyToken, '阿彌陀佛，您的福慧存摺還是新的 🙏\n傳「打卡」，就從今天開始記錄');
  }
  return lineReply(event.replyToken, [
    '阿彌陀佛，這是您的福慧存摺 🙏',
    `累計打卡：${r.totalDays} 天`,
    `連續打卡：${r.streak} 天`,
    `本月打卡：${r.monthDays} 天`,
    r.checkedToday ? '今天已經打卡囉' : '今天還沒打卡，傳「打卡」就可以囉',
  ].join('\n'));
}

app.post('/line/webhook', (req, res) => {
  if (!validLineSignature(req)) {
    console.warn('LINE webhook 簽章不符，略過');
    return res.sendStatus(401);
  }
  res.sendStatus(200);  // 先回 200，再慢慢處理

  for (const event of (req.body && req.body.events) || []) {
    if (event.type !== 'message' || !event.message || event.message.type !== 'text') continue;
    handleLineText(event).catch(err => {
      console.error('處理 LINE 打卡失敗:', err);
      lineReply(event.replyToken, '阿彌陀佛，系統剛剛有點忙，請稍後再傳一次 🙏').catch(() => {});
    });
  }
});

// === 每月統計表（只有知道 REPORT_KEY 的人能看）===
function reportAllowed(req, res) {
  const key = String(req.query.key || '');
  const ok = REPORT_KEY && key.length === REPORT_KEY.length &&
    crypto.timingSafeEqual(Buffer.from(key), Buffer.from(REPORT_KEY));
  if (!ok) res.status(404).send('Not Found');
  return ok;
}

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const htmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function loadReport(req) {
  const thisMonth = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : thisMonth;
  const r = await callCheckinScript({ action: 'devoteeReport', month });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r;
}

app.get('/line/report', async (req, res) => {
  if (!reportAllowed(req, res)) return;
  let r;
  try {
    r = await loadReport(req);
  } catch (err) {
    console.error('讀取每月統計失敗:', err);
    return res.status(500).send('統計表暫時打不開，請稍後再試');
  }
  const key = encodeURIComponent(String(req.query.key));
  const link = m => `/line/report?key=${key}&month=${m}`;
  const rows = r.people.map((p, i) => `
    <tr><td class="n">${i + 1}</td><td>${htmlEsc(p.name)}</td><td class="d">${p.days}</td><td class="l">${htmlEsc(p.last.slice(5).replace('-', '/'))}</td></tr>`).join('');
  res.type('html').send(`<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>信眾打卡月報 ${r.month}</title>
<style>
  :root { --bg:#f6f2ea; --card:#fffdf8; --ink:#2f2a24; --muted:#8a8174; --green:#3d5a45; --gold:#b08d57; --line:#e7dfd1; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:-apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif; }
  .wrap { max-width:640px; margin:0 auto; padding:28px 16px 48px; }
  .brand { font-size:13px; letter-spacing:.35em; color:var(--gold); }
  h1 { font-size:22px; margin:8px 0 20px; letter-spacing:.1em; font-weight:600; }
  .nav { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
  .nav a { color:var(--gold); text-decoration:none; font-size:14px; }
  .nav b { font-size:18px; letter-spacing:.08em; }
  .sum { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px; }
  .sum div { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px 8px; text-align:center; }
  .sum b { display:block; font-size:28px; color:var(--green); font-weight:600; }
  .sum span { font-size:13px; color:var(--muted); letter-spacing:.1em; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:14px; overflow:hidden; }
  th, td { padding:12px 14px; border-top:1px solid var(--line); font-size:15px; text-align:left; }
  th { border-top:none; font-size:12px; color:var(--muted); font-weight:500; letter-spacing:.1em; background:#f3ece0; }
  .n { width:44px; color:var(--muted); font-size:13px; }
  .d { text-align:right; color:var(--green); font-weight:600; }
  .l { text-align:right; color:var(--muted); font-size:13px; width:80px; }
  .csv { display:block; margin-top:18px; text-align:center; padding:14px; border-radius:12px; background:var(--green); color:#fff; text-decoration:none; letter-spacing:.12em; }
  .empty { padding:32px; text-align:center; color:var(--muted); }
  .note { margin-top:18px; font-size:12px; color:var(--muted); text-align:center; line-height:1.8; }
</style></head><body><div class="wrap">
  <div class="brand">竹山 明善寺</div>
  <h1>信眾打卡月報</h1>
  <div class="nav"><a href="${link(shiftMonth(r.month, -1))}">← 上個月</a><b>${r.month.replace('-', ' 年 ')} 月</b><a href="${link(shiftMonth(r.month, 1))}">下個月 →</a></div>
  <div class="sum">
    <div><b>${r.people.length}</b><span>位信眾</span></div>
    <div><b>${r.visits}</b><span>全寺總人次</span></div>
  </div>
  ${r.people.length ? `<table><tr><th class="n">#</th><th>姓名（LINE 名稱）</th><th class="d">打卡天數</th><th class="l">最近</th></tr>${rows}</table>`
    : '<div class="empty">這個月還沒有人打卡</div>'}
  <a class="csv" href="/line/report.csv?key=${key}&month=${r.month}">下載 CSV（用 Excel 開）</a>
  <div class="note">這個網址只有您知道，請不要分享出去<br>全寺總人次＝這個月每位信眾打卡天數的加總</div>
</div></body></html>`);
});

app.get('/line/report.csv', async (req, res) => {
  if (!reportAllowed(req, res)) return;
  let r;
  try {
    r = await loadReport(req);
  } catch (err) {
    console.error('下載每月統計失敗:', err);
    return res.status(500).send('統計表暫時打不開，請稍後再試');
  }
  // 名稱開頭是 = + - @ 時加上 '，避免 Excel 當成公式執行
  const cell = v => `"${String(v).replace(/^[=+\-@]/, "'$&").replace(/"/g, '""')}"`;
  const lines = [['月份', '姓名（LINE 名稱）', '打卡天數', '最近打卡日'].map(cell).join(',')]
    .concat(r.people.map(p => [r.month, p.name, p.days, p.last].map(cell).join(',')))
    .concat([[r.month, '全寺總人次', r.visits, ''].map(cell).join(',')]);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="mingshan-checkin-${r.month}.csv"`);
  res.send('\uFEFF' + lines.join('\r\n'));  // 加 BOM，Excel 開中文才不會亂碼
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`明善寺小助手運行中，Port: ${PORT}`));
