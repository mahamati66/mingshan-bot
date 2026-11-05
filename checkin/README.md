# 明善寺 義工打卡 ＋ 福慧存摺

義工用手機碰一下 NFC 貼紙 → 用 LINE 認人 → 記到 Google 試算表。
每次到寺記 1 點（修福＝存福、修慧＝存慧），在 LINE 裡隨時打開「福慧存摺」看自己的點數，
每 50 點蓮花長大一階：種子 → 蓮花苗（50）→ 含苞待放（100）→ 蓮花盛開（150）。

## 一、Google 試算表（存資料）

1. 新建一個 Google 試算表，命名「明善寺義工打卡」。
2. 「擴充功能 → Apps Script」，把 `apps-script.gs` 全部貼上。
3. 把第一行的 `SECRET` 改成一組自己的密碼（等一下伺服器要填一樣的）。
4. 上方選 `setup` → 執行（第一次會要求授權，按允許）。試算表會多出「打卡紀錄」「義工名冊」「護持統計」。
5. 「部署 → 新增部署作業 → 網頁應用程式」：執行身分選「我」，存取權選「所有人」→ 部署，複製網址。

> 之後改了程式，要用「管理部署作業 → 編輯 → 新版本」，網址才不會變。

## 二、LINE Developers（認人）

1. 到 https://developers.line.biz/ 建立 Provider（例如「竹山明善寺」）。
2. 新增一個 **LINE Login** channel。記下 **Channel ID**。
3. 在這個 channel 的「LIFF」分頁新增 LIFF app：
   - Size：Full
   - Endpoint URL：`https://<機器人網址>/checkin`
   - Scope：勾 `openid`、`profile`
   - 記下 **LIFF ID**
4. channel 狀態從 Developing 改成 **Published**（不改的話，只有開發者自己能登入）。

## 三、伺服器環境變數（Render 等）

| 變數 | 內容 |
|---|---|
| `LIFF_ID` | 第二步的 LIFF ID |
| `LINE_LOGIN_CHANNEL_ID` | 第二步的 Channel ID |
| `CHECKIN_SCRIPT_URL` | 第一步部署出來的網址 |
| `CHECKIN_SECRET` | 第一步自己設的密碼 |

## 四、三張 NFC 貼紙

用手機 App「NFC Tools」→ 寫入 → 新增紀錄 → 網址，寫入以下網址，寫好後**鎖定**貼紙。

| 貼紙位置 | 網址 | 類別 |
|---|---|---|
| 齋堂／香積廚 | `https://liff.line.me/<LIFF_ID>?spot=xiangji` | 修福 |
| 大殿 | `https://liff.line.me/<LIFF_ID>?spot=dadian` | 讓義工選修福或修慧 |
| 知客處 | `https://liff.line.me/<LIFF_ID>?spot=zhike` | 修福 |

要改地點名稱或類別：改 `index.js` 裡的 `CHECKIN_SPOTS`。

## 五、在 LINE 查自己的點數

福慧存摺網址：`https://liff.line.me/<LIFF_ID>/passbook`

最方便的做法：在明善寺 LINE 官方帳號的「圖文選單」加一個按鈕「我的福慧存摺」，
動作選「連結」，貼上這個網址。義工點一下就能看到自己的點數和蓮花。

## 怎麼運作

- 一天之中，第一次碰＝到寺（+1 點），再碰一次＝圓滿（自動算時數）。
- 3 分鐘內重複碰，不會重複記。
- 忘了碰圓滿：那次只算點數、沒有時數，可以直接在試算表補。
- 名字要改：改「義工名冊」的姓名欄。
- 改蓮花門檻：改 `passbook.html` 裡的 `LEVELS`。
