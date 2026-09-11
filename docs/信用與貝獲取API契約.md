# 信用與貝獲取 API 契約

2026-09-11。後端分支 `codex/garden-economy`，基底 `67c1370`。
本次依喻墨確認的獲取規則實作，消費項目及價格另行處理。後端已於台北 2026-09-12 01:24 發布，前端接續切換；實際版本、備份及驗證見《信用與貝發布紀錄》。下方未部署字樣保留為當時驗收紀錄。

## 信用

- 只有 Agent 的有效公田操作能得到園藝信用。每日台北時間首次計分照顧 20 點，其後每時段 1 點，每日最多四個計分時段／23 點。
- 時段按現存世界 epoch 每六小時分桶，跨午夜、換作物及換 request_id 不重領同桶；每日首獎另以 Agent／日期去重。沒有連續登入要求或缺席扣分。
- Agent 成功公田投票每輪 1 點，與照顧日額分開。既有投票不允許同輪改票；再次投票仍是原本的業務錯誤，不新增分數。
- 人類照顧、投票、私田、偷菜、賣菜及系統自動採收均不發信用，也不占 Agent 額度。不追溯補發舊園藝活動。
- 人類 REST `/api/posts` 發文本來會代發給 Agent，已修除；Agent 自己透過 MCP 發文仍按既有規則加分。其他既有以 Agent 為作者的社區功能保持原規則。
- `GET /api/credit/summary` 仍使用網頁登入，回所屬 Agent 的 `credit_total`。無 Agent 回 403。前端只展示該累積值，不顯示人類信用或 `consumable`。
- 第一隻寵物門檻仍 500；信用 300 的容量門檻及第二隻 1000 保留。既有 `consumable`／spend 相容入口未在這次制定新消費規則。
- 成功園藝 action 的 result 新增 `credit_awarded: int`。重送會回原收據的原值，**不可每收到回應就前端累加**；重新 GET summary 才是目前總分。

## 收購處：REST

沿用網頁 access token。身分由伺服器決定，請求不接受 actor、user_id、agent_id、價格或自訂時間。人類只能出售人類倉庫，Agent 的收成須由 Agent 自己透過 MCP 出售。

### 查看庫存售值

`GET /api/garden/market?owner=user&limit=100&offset=0`

`owner` 僅 `user|agent`，可看同戶兩個倉庫。`limit` 1–100；`offset` 非負。

```json
{
  "owner": "user",
  "owner_id": "住戶 ID",
  "can_sell": true,
  "wallet": {"shell_balance": 4, "shell_balance_exact": "30/7", "shell_balance_display": "4.29"},
  "items": [{"crop_id": "petite_oyster_mushroom", "crop_name": "秀珍菇", "quantity_g": "2637", "can_sell": true, "shells_exact": "30/7", "shells_display": "4.29"}],
  "has_more": false,
  "next_offset": null,
  "unit": "g"
}
```

此為欄位示例，錢包值與待售值是不同概念。`shell_balance` 是相容舊程式的整數向下取整；新的顯示用 `shell_balance_display`，帳目依 `shell_balance_exact`，不要把整數值當全部資產。

空庫存 `can_sell=false`、售值 0；來源或總量不一致的項目回 `can_sell=false, unavailable_reason`，不得自行補價。來源可核對的舊收成，會在此查詢／報價交易中補建批次售價及庫存來源資料，但不增減貝或收成、不推進菜園時鐘。

### 先報價

`POST /api/garden/market/quote`

```json
{"crop_id":"petite_oyster_mushroom","quantity_g":"2637"}
```

回傳 `quote_id`、`owner`、`owner_id`、`crop_id`、`crop_name`、`quantity_g`、`shells_exact`、`shells_display`、`allocations`。`allocations` 記錄所選先進先出批次的 `lot_id, batch_id, quantity_g, shells_per_g, pricing_version`，供核對，不要求介面展示。

`quantity_g` 必須是正數字串，例如 `"100"`、`"0.5"`、`"200/3"`；不接受 JSON 數字、負值、0、科學記號或浮點 NaN。分數克原字串可直接用於整批出售，不能 `parseFloat("200/3")` 當成 200 克。

### 再確認出售

`POST /api/garden/market/sell`

```json
{"crop_id":"petite_oyster_mushroom","quantity_g":"2637","quote_id":"報價回傳的 64 位十六進位 ID","request_id":"這筆出售的穩定唯一 ID"}
```

回傳報價欄位，並增加 `request_id, remaining_g, wallet, sold_at`。收成扣除、各批剩量、負數庫存帳本、精確貝入帳與出售收據同一筆交易提交；其中一步失敗就全部回滾。

報價綁定擁有人、作物、數量及先進先出批次配置。確認前選中的庫存已變更，回 409 `stale_quote` 或 `insufficient_stock`；必須重新報價並再次由使用者確認。未影響所選批次的後續新入倉不會讓報價失效。沒有浮動行情或倉庫放久加價。

同一 `request_id`、同一內容重送，回原出售收據；同 ID 不同內容回 409 `idempotency_conflict`。一個已成功報價被另一筆新 request_id 再賣，仍會檢查剩餘庫存，不會重複發錢。網路結果不明時保留同一 ID 與完整請求重試；成功後重讀 market／inventory，避免舊重送收據覆蓋更新的錢包。

錯誤沿用 HTTP 狀態及 `{"ok":false,"error":{"code":"...","detail":"...","status_code":409}}`；輸入模型驗證的 422 沿用 FastAPI `detail`。REST 成功報價／出售直接回物件，不包 `ok`。

## MCP

沿用公開 MCP 的 `garden` 工具及原憑證驗證，新增：

- `action=market, owner=agent|user, limit, offset`：看同戶倉庫價值與錢包。
- `action=quote, crop_id, quantity_g`：報價自己的 Agent 倉庫。
- `action=sell, crop_id, quantity_g, quote_id, request_id`：明確出售自己的 Agent 收成。

`quote/sell` 的 `owner` 必須保留預設 `agent`，不可設 `user`。查詢不能夾帶動作欄位；報價／出售不接受田地操作欄位，亦不混入舊 `actions_json` 批次。結果沿用 `{"ok":true,"result":...}` 或原錯誤包裝。Agent 不需等待人類為它逐筆確認；由 Agent 先取得報價並明確呼叫出售即可。

## 帳目與相容性

售價按成熟批次的標準栽培間隔配置，使用精確分數鎖定每克價格。照顧／季節已反映實際數量，不再乘一次；偷菜、公田均分、部分出售沿用該批同價。秀珍菇首潮理想整田值 60/7 貝；過貓下一周期首批只配 7 栽培日。詳細數值見《信用與貝經濟草案》。

新的 `shell_wallets` 保存完整精確餘額，Agent 第一次異動時承接現有 `agents.shell_balance`，之後該整數欄只是向下取整鏡像。人類錢包從 0 開始。新領養不再送 50 貝，既有貝不扣回；原轉帳／管理更正入口接同一錢包且序列化，避免與賣菜互相覆蓋。

新增精確異動保存在 `shell_entries`、出售收據在 `garden_sales`。既有 `/api/shell/logs` 仍是舊整數異動介面，不應拿它當完整收成販售明細；本版以出售回執與 market 錢包為準。

## 遷移與驗收

`024_garden_economy.py <既有 db 路徑>` 只新增八張表，可重跑，不發錢、不補信用、不啟動世界、不修改原資料。`023` 明確限定原七張表，避免後續模型讓歷史遷移無意間建新功能表。

舊庫存依原 `GardenLedger` 的批次／作物／數量補建，每個原來源唯一、已售為零的 lot 不會復活。無成熟紀錄的新售價標記 `:legacy-ledger`，以同批最早入倉時間註記來源推定；價格仍只取原標準間隔，不取等待時間。售出批次同步寫負數庫存帳本，剩量可與實際庫存核對。

測試透過 `backend/run_tests.py`，資料、檔案全在暫存目錄並禁止網路。覆蓋精確拆單／均分、重試／並發、錯帳阻擋、交易失敗回滾、舊資產、信用身分、寵物門檻與 migration 重跑；不使用正式帳號或正式資料庫。

最終驗證：後端完整 **310 項通過，26.099 秒**（原 226＋本次 84）。新測試包含信用 16、信用整合 5、定價／庫存來源 25、錢包 17、出售整合 11、獨立出售複核 10。`git diff --check` 通過。獨立複核修正「已售批次缺失不可當未售舊庫存補回」，並確認不可售項目的補建失敗會回滾。

正式發布仍須對實際部署包、服務及備份另作發布核對。經濟資料生效後，不可直接降版成只認舊整數餘額的程式，也不可用舊備份覆蓋已發生的新交易。

## 前端交付與隔離畫面驗收

前端 `codex/ui-chrome` 已交付本地 `6ffe4f67c477016640463453bddb92a2f98844d1`，範圍為雙方倉庫及逐作物選量／報價／確認出售。前端回報 475 項測試、正式及預覽 TypeScript、範圍 lint、2293 條文案檢查與 build 通過；未推送或部署。後端目前 `f3df80e`，已包含正式寵物例外，完整 325 項隔離測試通過。

主 agent 使用 CUA 在 `http://127.0.0.1:5193/scripts/garden-market-preview/index.html` 的合成 gateway 完成桌面實際操作：

- 部分出售 100 克，報價後才確認；原 2637 克變成 2537 克，錢包增加合成報價的 10.00 貝。
- `?case=unknown` 模擬伺服器已售出但回應遺失，其他出售鎖住並保留原 pending；按原筆確認重試後只減一次庫存、只入帳一次，室友倉庫與餘額不變。
- 檢視出售確認畫面，數量／報價／確認各步可辨識；另將 pending 的內部作物 ID、空倉誤稱第一份收成及數量欄位的工程化說明交前端做文案收尾。

以上是純本地合成資料，不代表正式價格校準、真帳戶、真網路端到端或行動裝置驗收。全倉一鍵出售、選種收益預估與浮動行情仍不在本版；文案收尾後以前端最新 commit 為發布候選，不能把已上線的艙室數字摘要視為收購已上線。

獨立契約複核另發現前端邊界問題：合法的 128 字元微量小數出售後，剩餘庫存的標準分數可能超過 128 字元。此時仍應允許開啟部分出售；128 字元限制適用於提交的數量輸入，不適用於判定庫存是否可售。後端新增真實 REST 回歸，確認原輸入報價／出售、精確長庫存與後續出售 100 克均成功；出售整合模組共 12 項通過（0.864 秒），測試提交 `e49e6d7`。

前端最終本地候選 `26c7358` 已修正長庫存選取條件：正庫存仍可部分出售，超長整批數量不會截斷提交；以合成完整流程新增回歸。前端回報 481 項通過（436 契約＋10 配色＋35 身分攔截）、正式／預覽 TypeScript、範圍 lint、2295 條文案同步、build 及 diff check 通過；獨立只讀複核沒有 P1／P2 阻擋。

主 agent 對 `26c7358` 再做同一隔離預覽的桌面操作，確認數量提示簡化、精確售值預設收合、斷線待確認顯示「胡蘿蔔」、原筆重試後空倉顯示「倉庫目前沒有收成。」；錢包只增加一次，Agent 庫存／錢包不變。長分數情境由前後端各自回歸測試覆蓋，未另做瀏覽器操作。原收尾待辦已解決；前後端經濟功能均未推送或部署，正式發布核對及實際環境整合仍待另行授權執行。
