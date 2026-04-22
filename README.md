# 明善寺小助手 (mingshan-bot)

竹山明善寺 Facebook 自動回覆機器人，使用 Claude API 以溫暖佛法語氣回覆留言。

## 功能

- 自動偵測 Facebook 粉絲專頁留言
- 使用 Claude AI 生成繁體中文回覆（100 字以內）
- 詢問地址時自動回覆：南投縣竹山鎮竹山路 27 號，電話：049-2642840

## 環境變數

| 變數名稱 | 說明 |
|---|---|
| `VERIFY_TOKEN` | Facebook Webhook 驗證 Token（預設：mingshan2024） |
| `PAGE_ACCESS_TOKEN` | Facebook 粉絲專頁存取 Token |
| `CLAUDE_API_KEY` | Anthropic Claude API 金鑰 |
| `PORT` | 伺服器埠號（預設：3000） |

## 安裝與啟動

```bash
npm install
node index.js
```

## GitHub 帳號

mahamati66
