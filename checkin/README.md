# 明善寺 義工打卡 ＋ 福慧存摺

義工用手機碰一下 NFC 貼紙 → 用 LINE 認人 → 記到 Google 試算表。
來寺裡時碰一下＝ +1 點（修福＝存福、修慧＝存慧）。
**修福、修慧分開記錄、分開算**：各自一天最多 2 點，同一類第二次要跟第一次隔 4 小時。
（早上 8:00 修福、9:00 接著上課修慧，兩筆都算。）
在 LINE 裡隨時打開「福慧存摺」看自己的點數。
蓮花六個等級：蓮花種子（0）→ 蓮花苗（10）→ 蓮花苞（30）→ 初開蓮花（60）→ 蓮花盛開（100）→ 金蓮（200）。
剛好升級的那一次打卡，畫面會跳出恭喜。要改門檻或文字：改 `lotus.js`。

**誰看得到什麼**
- 義工：只看得到自己的存摺（伺服器只認 LINE 驗證過的本人，查不到別人）。
- 負責人：在「義工名冊」的「權限」欄填 `負責人`，就能在 LINE 打開「負責人總覽」看全部義工；存摺頁下方也會多一個按鈕。
- 試算表本身：只分享給負責人，不要設成「知道連結的人都能看」。

## 一、Google 試算表（存資料）

1. 新建一個 Google 試算表，命名「明善寺義工打卡」。
2. 「擴充功能 → Apps Script」，把 `apps-script.gs` 全部貼上。
3. 把第一行的 `SECRET` 改成一組自己的密碼（等一下伺服器要填一樣的）。
4. 上方選 `setup` → 執行（第一次會要求授權，按允許）。試算表會多出「修福紀錄」「修慧紀錄」「義工名冊」「護持統計」「活動行事曆」。
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

- 福慧存摺：`https://liff.line.me/<LIFF_ID>/passbook`
- 負責人總覽：`https://liff.line.me/<LIFF_ID>/admin`

最方便的做法：在明善寺 LINE 官方帳號的「圖文選單」加一個按鈕「我的福慧存摺」，
動作選「連結」，貼上存摺網址。義工點一下就能看到自己的點數和蓮花。
負責人從存摺頁下方的按鈕進總覽就好，不用另外放在選單上。

**本月重點活動**：存摺頁會顯示試算表「活動行事曆」裡、月份是這個月的活動。
每月初由知客處在試算表新增幾列（月份｜活動｜類別｜日期｜時間｜圖示）就好，月份寫成 `2026-12` 這樣。

## 六、一年的護持表現

打開試算表 → 上方選單「明善寺 → 產生年度護持報表」→ 輸入年份。
會產生一張「2026 年度護持」，每位義工一列：

總點數｜存福｜存慧｜最常在哪裡｜第一次來、最近一次｜1～12 月各幾點

第一列是全寺合計，下面照點數由多到少排。年底做感謝名單、頒發護持獎，直接看這張就好。
（選單沒出現的話，重新整理一次試算表。）

## 怎麼運作

- 只要來的時候碰一下，走的時候不用碰。
- 修福記在「修福紀錄」、修慧記在「修慧紀錄」，兩張表分開，每一列就是 1 點。
- 同一類同一天第二次碰，要跟第一次隔 4 小時（例如早上 8:00 修福過，12:00 以後再修福才會加點），沒滿 4 小時碰，畫面會告訴他幾點以後可以再碰。修福和修慧之間不用隔。
- 同一類一天滿 2 點後再碰，畫面會說「今天的修福存滿囉」。
- 要改上限或間隔：改 `apps-script.gs` 最上面的 `MAX_PER_DAY`、`GAP_HOURS`（畫面上的文字在 `checkin.html` 的 `todayHint`）。
- 要補點數：直接在「修福紀錄」或「修慧紀錄」新增一列（LINE ID 從「義工名冊」複製）。
- 名字要改：改「義工名冊」的姓名欄。
- 改蓮花門檻：改 `lotus.js` 裡的 `LOTUS_LEVELS`。

---

# LINE 官方帳號：信眾「打卡」「存摺」＋每月統計

跟上面的義工 NFC 打卡分開記錄（試算表「信眾打卡」工作表，一人一天一列）。

| 信眾傳 | 機器人回 |
|---|---|
| `打卡` | 阿彌陀佛，今天是您本月第 N 天打卡，累計 X 天，連續 Y 天 🙏 |
| 同一天再傳 `打卡` | 阿彌陀佛，今天已經打卡囉 🙏（不重複計算） |
| `存摺` | 累計打卡、連續打卡、本月打卡天數，以及今天打卡了沒 |
| 其他訊息 | 不回，交給官方帳號原本的自動回應 |

連續天數：今天還沒打卡時，從昨天往回算（還不算斷）；中間少一天就重新算。

## 設定步驟

1. **官方帳號開啟 Messaging API**：LINE Official Account Manager → 設定 → Messaging API → 啟用，
   Provider 選「明善寺解惑」（跟打卡的 LINE Login 同一個，以後兩邊的 LINE ID 才對得上）。
2. **LINE Developers** 打開這個 Messaging API channel：
   - Basic settings → 複製 **Channel secret**
   - Messaging API → Channel access token（long-lived）→ Issue，複製
   - Webhook URL 填 `https://mingshan-bot.onrender.com/line/webhook`，按 Verify，打開 **Use webhook**
3. **Render** 環境變數再加三個：

| 變數 | 內容 |
|---|---|
| `LINE_CHANNEL_SECRET` | 上面的 Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | 上面的 Channel access token |
| `REPORT_KEY` | 自己編一串只有你知道的英數字（例如 20 個字），當作統計表的鑰匙 |

4. **Apps Script**：貼上新版 `apps-script.gs` 後，「管理部署作業 → 編輯 → 新版本」再部署一次（網址不變）。
   「信眾打卡」工作表第一次有人打卡時會自動建立，也可以重新執行一次 `setup`。
5. **官方帳號回應設定**：「Webhook」要開；「自動回應訊息」可以保留，「打卡」「存摺」以外的訊息照舊由它回。

## 每月統計表

```
https://mingshan-bot.onrender.com/line/report?key=<REPORT_KEY>
```

- 顯示當月每位信眾打卡天數、最近一次打卡、全寺總人次（每位信眾天數的加總），可切換上個月／下個月
- 「下載 CSV」用 Excel 打開不會亂碼
- 網址裡的 key 就是鑰匙：key 不對只會看到 Not Found。網址外流的話，改掉 Render 上的 `REPORT_KEY` 就好
