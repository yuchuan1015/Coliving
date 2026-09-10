# 菜園第一級 API 契約

2026-09-11。正式資料來源為種田任務 `handoff/tier1-v1/`；這份文件記錄 `codex/garden-tier1` 的實作契約。第一級 12 種須全部通過服務流程驗收，才可安排經授權的發布。資料包驗證不等於後端已驗收或部署。

## 身分、權限與時鐘

- 瀏覽器只用既有 Web access token，呼叫下列 REST。伺服器以登入者建立 user actor；管理員角色也不會變成 agent。前端不提供 agent 操作控制。
- Agent 只用既有 MCP 固定鑰匙或 OAuth 連線憑證呼叫 `garden`。入口先走 `_token_from_ctx`、`_verify_mcp_token`，再由帳號查同戶有效 agent。Web access token 不能拿來呼叫 MCP，MCP token 不能拿來使用 Web REST。
- `owner=user|agent` 只選擇同戶倉庫，不能切換執行身分或查另一戶。私田只限同戶，四塊地由伺服器建立。
- 寫入 body 與 MCP 工具參數不接受 `role`、`actor`、`household_id`、`user_id`、`agent_id`、`now` 等自行指定身分或時間的欄位。
- 種植、批次成熟、照顧 tick、再生與投票一律依 `time_service.now_utc()` 補結算。查詢可能補結算已經過的時間；重整不憑空增長、不重抽問題。作物栽培日只除 7 一次，公田投票為 12 個現實小時。

| 場域 | user 操作 | agent 操作 | 系統操作 |
|---|---|---|---|
| 私田 | 澆水、偷菜、共同挖除提案／同意／撤回 | 種植、照顧、實際採收、共同挖除提案／同意／撤回、清除死株 | 時鐘與生長結算 |
| 公田 | 澆水、照顧、投票 | 澆水、照顧、投票 | 種植、成熟採收與均分、整輪清除、開投票 |

最終可執行動作由服務依當下田地、批次、提案與身分判斷。藏起按鈕不能代替伺服器權限檢查；瀏覽器提交 `plant`、`harvest` 或系統動作不會取得那些權限。

## REST 查詢

共用 `Authorization: Bearer <web access token>`。

| 方法與路徑 | 用途 |
|---|---|
| `GET /api/garden/private` | 同戶四塊私田、作物、各獨立批次、照顧需求、共同挖除狀態 |
| `GET /api/garden/public` | 公田作物、當批貢獻身分與當輪投票狀態 |
| `GET /api/garden/inventory?owner=user&limit=100&offset=0` | 同戶指定身分的持久倉庫總量 |
| `GET /api/garden/progress` | 同戶圖鑑進度；只有私田正數 agent 實收才累積 |

`owner` 只能是 `user` 或 `agent`，REST 預設 `user`；`limit` 為 1–100，`offset` 至少為 0。非法查詢值回 HTTP 422。查詢成功直接回傳服務的物件；沒有另包 `result`。

所有 ID 都取自查詢回應，前端不組合或推算 plot、planting、batch、proposal、vote ID。不把舊預覽資料、client 倒數或旗標寫回伺服器。作物／batch 狀態、可偷取與可操作條件應採用伺服器回應。

### 私田／公田回應欄位

`private`、`public` 回應同一種物件；私田 `plots` 有四筆，公田有一筆。

| 欄位 | 內容 |
|---|---|
| `server_now` | 伺服器 UTC ISO 時間，作為此次畫面時間基準 |
| `garden_time`、`garden_month` | 共享菜園日期與 1–12 月份 |
| `epoch_at` | 持久世界起算時間；不是各次重新整理時間 |
| `time_multiplier` | `7`；僅作物與菜園日曆，不套用投票 |
| `vote_duration_real_hours` | `12` |
| `actor` | `{kind,id,household_id}`，本次已認證身分；只讀 |
| `plots` | 以下地塊物件陣列 |
| `crops` | 完整第一級 12 種清單；每筆有 `id,name,category,tier,timing,harvest,care,capacity` |
| `public_area` | `{gross_m2:667,productive_m2:480}`；有效面積由伺服器保存並只套一次產量係數 |

每塊地有：

| 欄位 | 內容 |
|---|---|
| `id,scope,number,revision` | 地塊 ID、`private|public`、地塊序號、伺服器修訂序號 |
| `planting` | 無作物為 `null`；有作物為下述生長狀態 |
| `crop_name` | 作物中文名，空地為 `null` |
| `vote` | 無投票為 `null`；有投票為 `{id,opened_at,closes_at,candidates,status,counts,my_vote}` |
| `allowed_actions` | 當前身分與狀態可用動作字串陣列；前端據此顯示 user 控制 |
| `steal_available` | 這块私田是否至少有一批現在可偷 |
| `need` | 當前照顧需求，例如 `water,nutrients,care` |
| `short_status` | 伺服器提供的簡短狀態文字 |
| `contributors` | 公田目前貢獻身分陣列，每筆 `{kind,id,household_id}`；私田為空陣列 |
| `care_logs` | 最近 20 筆，倒序；每筆 `id,kind,actor_key,planting_id,detail,created_at`，前端預設收合 |

`planting` 的主要畫面欄位為 `planting_id,crop_id,status,planted_at,last_advanced_at,health,moisture,nutrients,needs,random_problem,batches`。狀態為 `growing`、`harvest_ready`、`regrowing`、`production_complete`、`dead`；空地對外為 `planting:null`。`production_complete` 與 `dead` 分開顯示；多年生周期持續，不因固定採次完畢顯示死亡。`random_problem` 是 `null` 或含 `kind,label,started_at,tick_index` 的物件。

`planting.batches` 是以 batch ID 為 key 的物件，不是陣列。每批包括 `id,cycle_index,batch_index,status,yield_g,remaining_g,stolen,matured_at,steal_available,harvest_available`；批次的 `cycle_index` 與 `batch_index` 從 0 開始，畫面可加 1 顯示。成熟後 `yield_g` 鎖定；`remaining_g` 才是尚未收走的量。各批分開呈現，不合併偷取資格。批狀態包括 `ready,harvested,failed,lost`，操作資格直接看該批旗標。

共同挖除提案位於 `planting.clear_proposal`，未提出或已撤回時可缺少或為 `null`。存在時為 `{id,planting_id,reason,proposed_by,approved_by,created_at}`。以 `proposal.id` 傳 `proposal_id`；清除同意只能用本輪種植與本提案。`approved_by`／`proposed_by` 使用 `user:<id>` 或 `agent:<id>` 的身分 key。

私人田地每塊 2.5 坪是總面積；正式 v1 取約 8.25 m²，其中 6 m² 有效栽培、2.25 m² 作業空間。每批量已是整地數量，前端不再乘面積、株數或包數。來源為版本化 `rules.json` 的 `v1_defaults.plot` 與 `README.md`。

#### 私人清除提案的畫面判斷

從 GET 的 `actor.kind`、`actor.id` 組成唯讀 `actorKey`，再與 `proposed_by`／`approved_by` 比較；不能拿同戶 ID 代替 user／agent 身分，也不將 actorKey 當成操作身分送入 body。提出提案就代表提出者已同意，因此新提案的 `approved_by` 起初已有提出者。

| user 所見狀態 | 判斷與操作 |
|---|---|
| 自己提出，等待室友 | `proposed_by === actorKey`；一般沒有 `consent_clear`，可用 `revoke_clear` 撤回 |
| 室友提出，等待自己 | 自己尚未在 `approved_by`，且有 `consent_clear`；同意送 `accept:true`，拒絕送 `accept:false` |
| 已拒絕或撤回 | 提案變為 null、植株仍在、可再提出新提案；沒有另一個長期保存的 rejected proposal 狀態 |
| 雙方同意完成 | 當筆成功回 `cleared:true`、`plot.planting:null`；不等待 GET 出現「兩人已同意但仍 pending」狀態。user 空地仍無播種權限 |

目前 `revoke_clear` 對提案雙方都會提供，不能只看它是否存在就判定自己是提出者；以 `proposed_by` 區分「撤回自己的」和「回覆室友的」。每次回覆都帶目前 `planting_id`、`proposal_id` 及該意圖的 `request_id`，完成後刷新 GET；原 ID 重試可能回較舊的保存結果。

共同清除只將尚未入倉的成熟餘量記為 `clear_loss`，保留已入倉收成，不增加圖鑑。注意 `care_logs.kind="consent_clear"` 表示回覆過提案，目前紀錄不帶 accept，不能只憑此 kind 寫成「同意清除」；清除成功依當筆 `cleared` 與刷新後地塊判斷，歷史紀錄可中性顯示「回覆清除提案」。完整隔離範例見 [清除提案 fixtures](examples/garden-tier1/clear-proposals/README.md)。

投票 `candidates` 為 crop ID 陣列，`counts` 為 crop ID 對應票數；`my_vote` 是 `null` 或 `{crop_id,sequence,at}`。當 `allowed_actions` 沒有 `vote` 時不提供投票送出。顯示倒數以 `closes_at-server_now` 為基準；到期只刷新資料，不由前端發動系統播種。

### 倉庫與圖鑑回應欄位

倉庫為 `{owner,owner_id,items,has_more,next_offset,unit:"g"}`；`items` 每筆為 `{crop_id,crop_name,quantity_g}`。持久帳本在伺服器記錄進倉／損失來源，這個查詢回傳依作物彙總的庫存，不提供帳本歷史介面。

**`quantity_g` 是精確數量字串，可能為 `"2637"` 或 `"200/3"`。** 公田均分保留分數，不能用 `parseFloat("200/3")` 當成 200。前端應解析分子／分母再轉換顯示單位與小數位；顯示四捨五入不寫回庫存，也不把尾差分給其中一個人。mutation 的 `credited_g` 也用數量字串。

圖鑑為 `{completed_crop_ids,completed_count,required_count:12,unlocked_tier,available_tiers:[1]}`。收完 12 種時 `unlocked_tier=2` 記錄解鎖資格；目前實作仍只允許 `available_tiers` 中的第一級，不自行啟用第二級播種。偷菜與公田分配不增加此進度。

## REST 操作與獨立交易

`POST /api/garden/actions` 接受 1–4 筆動作，輸入順序即回傳順序。即使只做一筆，也使用 `actions` 陣列。

```json
{
  "actions": [
    {
      "plot_id": "從查詢取得的地塊ID",
      "planting_id": "目前這輪種植ID",
      "action": "water",
      "request_id": "客戶端為這次意圖產生的唯一ID"
    },
    {
      "plot_id": "另一塊地ID",
      "planting_id": "該地目前種植ID",
      "batch_id": "成熟批次ID",
      "action": "steal",
      "request_id": "另一筆操作的唯一ID"
    }
  ]
}
```

每筆允許以下欄位，其他欄位回 HTTP 422：

| 欄位 | 格式／使用方式 |
|---|---|
| `plot_id` | 必填，非空字串，最多 128 字元 |
| `action` | 必填，非空字串，最多 64 字元；可用性逐筆由服務判斷 |
| `request_id` | 必填，非空字串，最多 128 字元；同一意圖的重試保持原值及原內容 |
| `planting_id` | 操作既有植株時使用，避免舊畫面操作下一輪作物 |
| `batch_id` | `steal`／`harvest` 使用，明確指向某個成熟批次 |
| `crop_id` | `plant`／`vote` 使用，取正式第一級清單 |
| `proposal_id` | 同意、拒絕或撤回共同挖除時使用 |
| `reason` | 挖除提案理由，非空字串，最多 500 字元 |
| `accept` | JSON boolean，預設 `true`；回應清除提案時 `false` 表示拒絕 |
| `vote_id` | 公田當輪投票 ID，防止舊票落入新一輪 |

可選 ID 若有提供，也必須是非空字串且最多 128 字元。字串會先去除頭尾空白；純空白無效。字串型數字、字串型 boolean 不自動轉型成正確型別。

```json
{
  "results": [
    {"ok": true, "result": {"操作結果": "由服務回傳"}},
    {"ok": false, "error": {"code": "業務錯誤代碼", "detail": "可顯示的原因", "status_code": 409}}
  ]
}
```

動作已通過基本結構驗證後，整份請求回 HTTP 200；前端必須逐筆讀 `ok`，不能只讀 HTTP 狀態就當全部成功。未知 action、無權操作、空地、尚未成熟、舊批次等業務錯誤都只影響該筆，其他合法項繼續。每筆服務自行 commit／rollback，入口不以一個大交易包住四塊地。

body 型別、未列出的欄位、缺少 request_id 或 0／超過 4 筆等結構問題，整份回 HTTP 422，完全不執行。登入失效用既有認證 HTTP 401；無法建立合法菜園身分時回對應 HTTP 4xx。服務錯誤格式為 `{ok:false,error:{code,detail,status_code}}`；既有登入與 FastAPI 結構錯誤仍沿用其原生 `detail`。

一次操作成功後，重讀相關田地與私田倉庫／圖鑑。遇到逾時或不確定結果時，以相同 `request_id` 和原封不動的動作內容重試；不要先換新 ID。若改了目標、批次或動作，那是新的意圖，使用新 ID。重試不得重複進倉、重複偷取、重複貢獻或沿用過期清除同意。

成功 `result` 為 `{plot,server_now,...}`；偷菜與採收另回 `credited_g,batch_id`，提出清除另回 `proposal_id`，完成雙方同意清除另回 `cleared:true`。`plot` 格式與查詢相同，權限依當次 actor。同內容重試會回保存的原結果，因此其中的 plot/server_now 可能已舊；重試後仍刷新 GET。相同 ID 配不同內容回 `idempotency_conflict`，不能當成成功。

### 業務錯誤代碼

| 代碼 | 狀態 | 意義／畫面處理 |
|---|---|---|
| `inactive_user` | 401 | 帳號／登入無效，清除登入狀態 |
| `agent_required`、`invalid_actor` | 403 | 沒有室友或伺服器無法建立合法菜園身分 |
| `plot_not_found` | 404 | 地塊不存在或屬於另一戶；不暴露另一戶內容 |
| `unknown_action`、`invalid_crop` | 400 | 未支援動作或不是本輪／本級候選作物 |
| `action_forbidden` | 403 | 已知動作，但該身分或場域不允許 |
| `empty_plot`、`plot_occupied` | 409 | 空地不能操作植株，或已有植株不能重種 |
| `stale_planting`、`stale_vote`、`stale_proposal` | 409 | 指向舊一輪種植／投票／清除提案，重讀相關狀態 |
| `batch_not_ready`、`already_stolen` | 409 | 批次尚未成熟／已收完，或已偷過；重讀批次 |
| `plant_dead` | 409 | 已死亡，依清除權限處理 |
| `joint_consent_required`、`proposal_exists` | 409 | 健康作物須共同挖除，或已有提案待回應 |
| `clear_reason_required` | 400 | 提案未填 1–500 字原因；有填但超界會先被 schema 422 擋下 |
| `already_voted` | 409 | 此身分本輪已投票 |
| `idempotency_conflict` | 409 | 同一 request_id 的內容已改變 |
| `invalid_garden_state` | 409 | 作物狀態不允許此操作，重讀狀態 |
| `catchup_limit` | 503 | 補結算未完成，稍後以原意圖重試 |
| `invalid_request` | 422 | MCP 參數或 JSON 格式不合法 |
| `internal_error` | 500 | 此筆執行異常，以原 request_id 重試，勿把其他成功項當成失敗重做 |

MCP 憑證不合法另回 `unauthorized` 401。所有業務拒絕有可顯示的 `detail`；前端至少保留逐筆錯誤，不能只顯示整批「完成」。

可直接用於前端 fixture 的 11 份實際 REST／MCP 請求與回應，見 [範例說明](examples/garden-tier1/README.md)。檔案保留同組身分、地塊、植株及批次 ID，涵蓋成長、成熟、部分成功、偷取、實收、倉庫及圖鑑。

## MCP `garden` 工具

保留既有「一個場域一個工具」形式；沒有新增 agent REST 入口。`garden` 的所有分支都需要有效 MCP 憑證。

- 讀取：`action=status|private|public|inventory|progress`。`status` 為私田查詢別名。查詢成功回 JSON 字串 `{ok:true,result:{...}}`。
- `inventory` 的 `owner` 預設 `agent`；可顯式選同戶 `user`，分頁限制與 REST 相同。
- 單筆動作：`action=plant|water|care|harvest|propose_clear|consent_clear|revoke_clear|clear_dead_crop|vote`，其餘欄位與 REST 動作一致。成功／失敗回 `{ok,result|error}`。
- 批次動作：`action=actions`，`actions_json` 是 1–4 筆動作的 JSON 陣列字串，最多 16,384 字元。回 `{results:[...]}`，逐筆結果與 REST 相同。批次模式不再同時帶最外層 `plot_id` 等單筆欄位。
- 查詢不能夾帶 `request_id` 或其他動作參數。未列出的參數在工具 argument model 與 `actions_json` 模型都會被拒絕，不會默默忽略。
- `steal` 是 user 權限，未列入 agent 可用動作。惡意放進單筆或批次仍由服務拒絕，不會變身 user。`open_vote`、系統採收等也不對玩家開放。

```json
{
  "action": "actions",
  "actions_json": "[{\"plot_id\":\"私田1ID\",\"action\":\"plant\",\"crop_id\":\"作物ID\",\"request_id\":\"種植意圖ID\"},{\"plot_id\":\"私田2ID\",\"planting_id\":\"種植ID\",\"action\":\"care\",\"request_id\":\"照顧意圖ID\"}]"
}
```

本輪實測 MCP 2.0.0；requirements 為 2.x 範圍，發布使用已驗證版本並保留 transport 檢查。僅 `garden` 的 generated argument model 設為 `extra=forbid`、strict；更新 MCP 依賴時需跑 transport 測試確認 top-level spoofing 仍拒絕。其他既有工具未改驗證行為。

## 生長排程入口

`backend/garden_tick.py` 提供一次性 `run()`，只建立 session、呼叫 `garden_service.tick_all(db)`、關閉 session。服務負責作物補結算、公田系統採收／分配與投票；不呼叫付費模型，不送 webhook，不代替 agent 採私田。失敗會 rollback 並以非零 CLI exit status 回報，不吞掉錯誤假裝 timer 成功。

部署經授權後可由獨立 timer 在 backend 工作目錄呼叫 `python garden_tick.py`。本次程式修改沒有安裝 timer，也沒有修改既有 `wake_scheduler.py`。正式執行會改菜園持久資料，不能拿它對正式資料庫做試跑。部署、migration、timer 安裝及生效須一併列入發布驗收。

## 驗證邊界

`backend/tests/test_garden_transport.py` 的 24 個測試已用離線入口執行通過，涵蓋身份／時鐘偽裝拒絕、憑證類型與作廢停用、參數限制、四筆獨立結果、未知或無權動作不取消合法項、例外回復、MCP 實際 Tool.run 驗證、路由註冊及 CLI 失敗回報。

其中 `GardenRealEndpointFlowTest.test_real_rest_mcp_plant_water_mature_steal_harvest_and_persistent_stock` 以真實 REST JWT、MCP Tool.run／固定鑰匙、獨立 SQLite 和原 v1 秀珍菇 6 個栽培日完成種植、照顧、成熟、立即偷 50%、實收餘量、倉庫與圖鑑。只控制伺服器時間、偏好季節及不發生隨機問題，不注入假成熟批。`test_real_four_plot_partial_success_and_request_id_conflict` 實測四筆澆水成功／空地失敗／成熟偷取成功／他戶 404，以及同請求重試和不同內容 409。其餘 adapter 單元測試使用受控服務結果；都不代替全 12 種與均分／並發的服務驗收。

第一級逐作物流程與核心共同案例仍須由服務驗收覆蓋；前端也須完成實際 API 回應對接與 user 操作的瀏覽器驗證。未通過上述整體驗收前，不標成可上線。
