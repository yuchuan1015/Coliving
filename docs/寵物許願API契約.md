# 寵物許願 API 契約（本地完成，未發布）

2026-09-12。喻墨已批准開始本地實作，許願成功即確定領養並占一格，居民不可修改／取消。本輪不推送、部署或修改正式資料；原寵物修正 02b959b 保留。本文件為前後端第一版接線契約，尚非正式服務能力。

## 公用型別

`Capacity = {max_pets, active_pets, reserved_pets, occupied_pets, available_slots, can_adopt, can_wish}`。前五欄為整數，最後兩欄為布林。`occupied_pets=active_pets+reserved_pets`；`available_slots=max(0,max_pets-occupied_pets)`。pending/preparing 許願占一格，到家改為實際活寵，不能二次占用。原 `/api/pets` 的 `pets/max_pets` 保留，新增 `capacity`；MCP `my_pets` 同樣新增。

`Wish`：

```text
id, user_id, agent_id
requested_name, requested_species, appearance_description
status: pending | preparing | arrived
version: integer（初始 1）
created_at, updated_at: ISO UTC
pet_id, arrived_at, asset_key: string | null
fulfillment_issue: string | null
preparation_note: string（僅管理員回應）
```

原始名字／物種／外觀接受後不可變；管理準備資料與原願望分開。`fulfillment_issue` 為安全條件提示，不能取消申請或釋放名額。

`Receipt = {operation: create|arrive, client_request_id, wish_id, pet_id: string|null, accepted_at: ISO UTC}`。receipt 不可變，`wish` 始終是當前狀態，不可用舊 receipt 把 arrived 回退成 pending。

## 居民端

皆需有效 web 登入，身分由伺服器判定。建立僅能替自己的 Agent 申請，不能提交 user_id/agent_id。列表／detail／收據查回為真正唯讀，不呼叫寵物 tick。

| 方法 | URL | body／回應 |
|---|---|---|
| GET | `/api/pet-wishes?limit=50&offset=0&status=pending` | `{items:Wish[],has_more,next_offset,capacity}`；status 可省略 |
| GET | `/api/pet-wishes/{id}` | `{wish,capacity}` |
| GET | `/api/pet-wishes/by-request/{client_request_id}` | `{wish,receipt,capacity}`，receipt 為原 create 收據 |
| POST | `/api/pet-wishes` | body 見下；首次 201／重送 200，`{wish,receipt,capacity}` |

```json
{"client_request_id":"前端本次固定UUID","requested_name":"居民取的名字","requested_species":"想要的物種","appearance_description":"想要的外觀"}
```

名字／物種各 1–64 字，外觀 1–2000 字，不得只填空白。request ID 1–128 個 ASCII 字母、數字、`_` 或 `-`。拒絕額外欄位。前端送出前確認：「送出後占用一個寵物名額，無法修改或取消」。不提供居民 PATCH／取消 API。

同 user＋operation＋key、相同內容回原收據；不同內容回 409。發送前保存帳號、key 與完整原 payload，網路結果未知只能查原 key 或重送同 key 同內容。查回 404 不保證原請求未在途，不另造 key。一般列表／detail 不當提交收據；by-request 的收據是與申請同交易保存的建立證據。

## 管理端

所有路由需有效 `User.role=admin`；不要求管理員自己有 Agent。居民不可讀其他人的申請。寫入在鎖後再次驗證管理員有效角色與登入版本。

| 方法 | URL | body／回應 |
|---|---|---|
| GET | `/api/admin/pet-wishes?limit=50&offset=0&status=pending` | `{items:Wish[],has_more,next_offset}` |
| GET | `/api/admin/pet-wishes/{id}` | `{wish,capacity}` |
| PATCH | `/api/admin/pet-wishes/{id}/preparation` | `{expected_version,asset_key:null或可信key,preparation_note:""}` → `{wish,capacity}` |
| POST | `/api/admin/pet-wishes/{id}/arrive` | `{client_request_id,expected_version}` → `{wish,receipt,capacity}` |

preparation 使 pending 進入 preparing，並可更新準備資料；expected_version 必須等於目前版本。備註上限 2000 字。未完成圖資可保持 null，不代表可到家。到家需 preparing 且可信可用圖資，管理員明確確認。終態不可 PATCH 回退；內容不能藉管理欄位改寫。

到家是既有 reservation 轉成一隻 Pet，**不要求另一個空位**，也不因後來信用下降重新要求新領養資格；有效原身分／綁定仍必須驗證。建 Pet、消耗 reservation、申請 arrived／pet_id、一次站內系統信及收據同一交易。不同管理員／不同 key 重複確認也只回同一 Pet；後來死亡不使舊申請重啟。出生時間由實際到家計。

原 Agent 失效／換綁等安全條件不符，回 `fulfillment_review_required`，保留原申請、名額和準備狀態，不能自動取消或轉給別人。客觀無法製作先保留準備中並由管理備註提示，不新增釋放規則。

## 可信圖資與普通領養

新增 `GET /api/pet-assets`（登入）回 `{items:[{asset_key,species,emoji,image_url}],catalog_version}`。唯讀，僅列可信、已發布的 registry 資產。`image_url` 為同站固定 `/assets/pets/…` 路徑，不接受住戶／管理 API 任意 URL 或本機檔案路徑。

registry 於初版為空；2026-09-12 已完成 28 張驗收圖片的本地接線，catalog version 為 `rookery-pets-v1-20260912`，詳見 `寵物圖庫接線紀錄.md`。尚未推送或部署。一般隔離測試使用專用 fixture，圖庫整合測試另以本地真實登錄驗證領養及許願到家。空圖庫行為仍受測試保護。

普通 `POST /api/pets/adopt` 建議 body `{name,asset_key}`。回應 PetStatus 新增 `asset_key:string|null`（舊寵物保留 null，不改既有 species/emoji）。舊 `{name,species,emoji}` 請求僅可在唯一精確匹配已發布資產時領養，未知／多種外觀須選 asset_key 或改走許願；REST/MCP 都由後端強制，不能只擋前端自填。同時提供 key 與舊欄位時必須符合該資產。

普通領養、許願提交共用同一 Agent 鎖及 Capacity；即使舊前端只算 alive 也不能突破保留名額。等待中的願望不得先建立隱藏 Pet。

## 錯誤與通知

新 wish API 領域錯誤採 HTTP 狀態及 `{"detail":{"code":"…","message":"…"}}`；登入依既有 401/403，結構驗證為 FastAPI 422。

- 404：`wish_not_found`、`submission_not_found`，別戶資源不洩漏。
- 409：`idempotency_conflict`、`version_conflict`、`invalid_transition`、`pet_capacity_unavailable`、`asset_unavailable`、`fulfillment_review_required`。
- 普通 pet API 保留既有 `detail` 字串錯誤格式，前端解析器需相容兩者。

到家時同交易新增一封 `Mail(mail_type=system,to_agent_id=原Agent)`；人類既有站內信箱與 Agent MCP 信箱可見，沒有外部 email／push 或新排程。

前兩種狀態顯示「等待到家」及「預計需要三個工作天準備，準備好後會通知你」。這是人工預期，不產生 due_at、TTL、國定假日計算、自動到家或釋放名額。沒有新增費用、扣貝、冷卻、額外申請限額。

## 驗證

完整本地後端 **385 項通過，30.020 秒**（原 345＋wish service 12＋獨立 boundary 18＋可信圖庫 6＋普通領養身分競態 4）。`git diff --check` 通過。

驗證涵蓋 SQLite 遷移重跑與舊 Pet／信用／分數庫存保留、REST wish／REST adopt／MCP adopt 三入口爭同一格、同 key 並發一次建立、跨管理員／不同 key 到家一次、越戶／換綁、原始內容不可改、終態不得回退、available_slots=0 與信用後降仍由保留轉活寵、圖資未交付阻擋、通知一次與整筆回滾。六種新 GET 已比對整個隔離 DB dump 不變。

獨立複核抓到並修正：換綁後原提交重送不應重新套履約條件；普通領養鎖前遇換綁／登入撤銷不應替錯誤住戶建寵物。四項真 REST／MCP 競態回歸全部拒絕不合法請求，且沒有殘留 Pet 或活動紀錄。複核收尾無未解 P1／P2。

既有信用門檻及寵物測試僅補上隔離合成圖庫 fixture，保留原門檻／資產斷言。測試以離線 runner 執行，不讀正式環境檔、不連網、不使用真帳號，不執行正式 migration。正式後端仍為先前 a84c48d，發布需另依授權核對。

## 實作接線補充

- MCP `pet(action=catalog)` 提供相同可信圖庫，`pet(action=adopt,name,asset_key)` 使用共同容量。許願提交由居民 web API 明確確認，未另加 Agent 自行許願入口。
- 文字先移除前後空白再驗證／保存與計算 canonical hash；前端應預覽同樣結果。長度以 Unicode 碼點計算，JavaScript 可用 `Array.from(text).length`，避免 emoji 被當兩字。
- 跨管理員／不同確認 key 的同一到家重複確認，回應 receipt 的 client_request_id 為該次 key，wish_id／pet_id／accepted_at 保留原到家結果；不重生或重寄。已成功原收據查回不因後來信用下降、綁定改變或寵物死亡被重新當作領養。
- 準備筆記只回管理端，居民僅看到原願望與公開準備狀態。換綁後原居民仍能查自己的原申請／收據，不回傳新住戶的庫存或容量資訊。
- 普通領養在取得共用名額鎖後仍核對原身分／綁定；REST 重驗登入版本，MCP 重驗原 key／OAuth grant 的有效性，不使用會自行 commit 的驗證函式拆開交易。
- 新 `026_pet_wishes.py` 僅新增 pet_wishes／pet_wish_receipts 及既有 pets 的 nullable asset_key，無種子資料、免費名額或新寵物。既有寵物與信用／貝／農田資料保留，遷移可重跑。
- 原始申請就是 reservation 的來源：pending/preparing 且尚未綁 pet_id 的申請占用名額，沒有可由前端修改的剩餘名額計數器。未完成準備不會自行超時。
