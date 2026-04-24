const express = require('express');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mingshan2024';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';

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

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field === 'feed' && change.value.item === 'comment') {
          const commentId = change.value.comment_id;
          const commentText = change.value.message;
          console.log('收到留言：', commentText);
          const reply = await generateReply(commentText);
          await postReply(commentId, reply);
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

async function generateReply(comment) {
  try {
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
        system: `你是竹山明善寺的 AI 小助手，代表寺院回覆臉書粉絲專頁的留言。

回覆原則：
- 用繁體中文，語氣溫暖、真誠，帶一點佛法智慧，但不說教
- 針對留言的具體內容回應，讓對方感覺被看見、被理解
- 每次開頭不要重複（不要每次都說「感恩您的留言」）
- 字數 80 字以內，簡短有力
- 可以引用一句簡短的佛法觀點，但要自然不生硬
- 結尾可加 🙏 或相關表情，不強制

若對方詢問地址或交通：南投縣竹山鎮竹山路27號，電話：049-2642840。
若對方詢問法會或活動，請告知可來電或私訊詢問。`,
        messages: [{
          role: 'user',
          content: `請回覆這則留言：\n\n"${comment}"`
        }]
      })
    });
    const data = await response.json();
    return data.content[0].text;
  } catch (err) {
    console.error('Claude API 錯誤:', err);
    return '感恩您的留言，阿彌陀佛 🙏';
  }
}

async function postReply(commentId, message) {
  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/${commentId}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        access_token: PAGE_ACCESS_TOKEN
      })
    });
    const data = await response.json();
    console.log('回覆成功：', data);
  } catch (err) {
    console.error('回覆失敗:', err);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`明善寺小助手運行中，Port: ${PORT}`));
