const express = require('express');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mingshan2024';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || '';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';

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

        if (!commentText) {
          console.log('留言無文字內容，跳過');
          continue;
        }

        console.log('收到留言：', commentText);
        try {
          const reply = await generateReply(commentText);
          await postReply(commentId, reply);
        } catch (err) {
          console.error('處理留言時發生錯誤:', err);
        }
      }
    }
  }
});

// === 呼叫 Claude API 產生回覆 ===
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
        messages: [{
          role: 'user',
          content: `你是竹山明善寺的小助手，請用溫暖、佛法的語氣，簡短回覆這則臉書留言（100字以內，繁體中文）。若對方詢問地址或交通，請告知：地址：南投縣竹山鎮竹山路27號，電話：049-2642840。\n\n留言內容："${comment}"`
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
    const response = await fetch(`https://graph.facebook.com/v19.0/${commentId}/replies`, {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`明善寺小助手運行中，Port: ${PORT}`));
