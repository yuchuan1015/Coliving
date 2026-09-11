# 寵物介面 API 契約

> 後續許願整合已在同一分支實作（仍未發布）：普通領養改為可信圖庫、容量含 pending/preparing 保留、PetStatus 新增 asset_key。最新接線以 [寵物許願 API 契約](寵物許願API契約.md) 為準；下方自由物種等敘述為 02b959b 批次當時狀態。

2026-09-12，前端任務轉達喻墨「你去跟後端做寵物系統的部分，我去做圖片」。本輪僅本地實作／對接，**未推送、未部署、未修改正式資料**。後端獨立 `codex/pet-integration`，基於 `5648315`（正式 runtime 為 `a84c48d`）；前端與圖片由各自任務負責。

## 範圍與決策來源

- 已確認：一般第一隻需 Agent 累積信用 500，人類不獲得信用；宋祈言有依 Agent ID 綁定的第一格例外。介面信任後端 `max_pets`，不能用 500 硬鎖例外帳號。
- 現有規則保留：信用 1000 開第二格，上限兩隻；例外與信用名額取較大值，不相加。領養／照顧不扣信用、貝或作物，目前沒有食物項目、冷卻、每日次數與抽選機制。
- 舊 Claude Code 程式已存在：90–180 天壽命、隨時間降低狀態、隨機事件、死亡、活動紀錄與系統信。本輪沒有重新制定或加強這些玩法；不把「程式存在」當成新的產品決策，前端不新增壽命倒數／死亡戲劇化介面。
- 待產品決定：`rest` 目前無數值效果，`walk` 的直接 health 加成被平均值蓋掉。改成怎樣需由前端整理問喻墨，不能自行增加回血或費用。新的物種白名單、食物消耗、稀有度、繁殖等不在本輪。

## REST

全部需目前人類 web session；操作其關聯 Agent 的寵物。無室友回 403、無／失效登入回 401，別戶或未知 ID 回 404。一般服務規則錯誤為 400 `{"detail":"..."}`，輸入結構錯誤為 FastAPI 422。

| 方法 | 路徑與輸入 | 成功回應 |
|---|---|---|
| GET | `/api/pets` | `{pets: PetStatus[], max_pets: number}` |
| GET | `/api/pets/{pet_id}` | `PetStatus` |
| POST | `/api/pets/adopt`，JSON `{name,species,emoji}` | 201 `PetStatus` |
| POST | `/api/pets/{pet_id}/interact?action=feed`，不需 JSON body | `PetStatus` |

`action` 可為 `feed|clean|play|walk|rest`。名字／物種原上限 64 字元、emoji 8 字元；共用 service 補上相同非空及長度限制，不能只填空白。仍保留自由物種字串，沒有後端 catalog 或圖片欄位。

`PetStatus` 欄位：

```text
id, name, species, emoji
hunger, cleanliness, happiness, health
is_alive, born_at, died_at
age_days, lifespan_days, cause_of_death
events: [{key, text, effects: {stat: delta}}]
```

四種狀態為 0–100，回傳一位小數；**hunger 是飽足值，越高越好**。時間是 ISO 字串，`died_at` 和 `cause_of_death` 可為 null。沒有 `image_url`／穩定物種 ID，不應用寵物名字猜圖；前端可透過獨立靜態資產對照表映射已知 species，未知值保留實際 emoji。

現有 `feed` 飽足 +40、`clean` 清潔 +40、`play` 心情 +30、`walk` 心情 +20；上限 100。health 最後取三項平均值，所以 `walk` 的直接 +5 與 `rest` 的 +10 不會留下。前端只呈現後端 actual stats，不自行加值或承諾休息回血。

## 讀取及未知結果

列表與單隻 GET 都會懶結算、寫資料並 commit，**不是唯讀診斷 API**。可能發生隨機事件、活動／系統信或按既有規則判定死亡。前端可在打開入口、操作完成或手動刷新時讀取，避免高頻背景輪詢；後端驗收不使用正式帳號呼叫。

列表先取得目前 alive 寵物再結算，因此本次可能回傳剛判定 `is_alive=false` 的一筆；前端需按欄位停用互動，下次列表會省略它。單隻 GET 能取得既有非 alive 紀錄。本輪修正保存已發生的時間結算：若互動時才判定死亡，仍 commit 該次結算再回 400，不因 HTTP 錯誤將死亡／系統信回滾。

領養與照顧尚無 request_id／收據去重契約。UI 一次只送一筆，不自動重送 POST；網路結果不明先重新讀取實際狀態。領養先檢視現有寵物，不自行再建一隻；照顧重新讀取也不能證明原請求是否成功，勿把 GET 當收據。完整安全重試需要日後一併建置後端請求 ID／收據保存，單加前端 UUID 不會有效。

## MCP（本輪相容擴充）

保留公開工具 `pet`：`action=my_pets|adopt|interact`。成功／失敗仍為 JSON 字串 `{success,pets|pet,message?,error?}`。

- `my_pets` 成功結果補上 `max_pets`，包含尚無寵物的結果，讓 Agent 知道例外資格。
- `adopt` 使用 `name,species,emoji`，與 REST 共用 service 文字驗證及領養名額鎖。
- `interact` 使用 `act` 加可選 `pet_id`；有提供 ID 時只查自己 Agent 的該 ID，不能回退到名字或照顧別戶。
- 舊 `pet_name` 相容保留：沒有 ID 時只找同戶同名的活寵；多隻同名回明確歧義，要求 ID，不任選第一筆。舊死寵不再遮住同名新活寵。

## 本輪工程修正

1. GET 狀態與照顧共用鎖後重讀的 tick，避免同時餵食互相覆蓋，或兩個舊快照重複產生事件。service 不自行 commit，仍由 REST／MCP 提交。
2. 一次照顧只結算一次，保留該次 events；回應序列化不再第二次 tick 把事件洗掉。
3. 領養狀態在 commit 前生成，避免 commit 後又產生未提交的結算。
4. 互動中既有時間結算即使最後無法照顧，也會保存；不改死亡判定公式。
5. MCP 名字歧義、ID 定址與空欄領養修正如上。REST URL／主回應 shape 不變，不需 migration。

最小前端對接：艙室原入口 → 紫色彈窗 → 寵物清單／單隻詳細資料／明確照顧確認。靜態圖片、圖表對照與文案由前端／圖片任務處理，不在後端加入假寵物或樣本資料。

## 驗證

完整本地後端 **345 項通過，27.736 秒**（原 326＋新增照顧 8＋MCP 11）。覆蓋並發餵食、重複讀取事件、400 時結算保存、回應事件、跨戶／無效操作、回滾、輸入邊界、列表剛死亡、同名活寵歧義、舊死寵不遮蔽、ID 不回退、例外名額及領養回應前結算保存。`git diff --check` 通過。測試不讀正式環境檔、不連網，不使用正式住戶；正式尚未執行本輪程式。

獨立 service／REST 複核未見 P1／P2 阻擋；另以臨時 SQLite 補驗同時死亡結算只產生一份通知、狀態讀取與餵食競態保留照顧、事件與照顧一同回滾，三個額外情境通過。這三項為獨立臨時測試，沒有重複計入上述 345 項。
