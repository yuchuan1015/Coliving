# 私田共同清除提案：真服務 fixture

此組檔案由 `GardenRealEndpointFlowTest` 的獨立暫存 SQLite、合成 user／agent，透過真 REST 與 MCP Tool.run 產生。沒有手編服務回應、正式資料、HTTP 憑證或 seed。只控制伺服器時間、偏好季節與不發生隨機問題；沿用原 v1 秀珍菇成熟與照顧流程。

所有檔案沿用同一塊私田、同一次種植與首批 batch；三次提案各有不同 proposal ID。這些 ID 只供本機 fixture，不送正式 API。

| 前綴 | 實際流程與快照 |
|---|---|
| `00-` | 秀珍菇首批成熟，user 已偷一半；保留剩餘成熟批及已進 user 倉庫的量 |
| `01-` | user 提出清除，保存 request／response、user 與 agent 的 pending 查詢 |
| `02-` | user 自行撤回，保存 request／response 與 GET；作物保留、提案變 null |
| `03-` | agent 提出新提案，保存 MCP request／response 及兩種身分 pending 查詢 |
| `04-` | user 以 `consent_clear`、`accept:false` 拒絕；提案取消為 null，作物仍保留 |
| `05-` | agent 重新提出；新 proposal ID，仍是原 planting ID；保存兩種身分 pending 查詢 |
| `06-` | user 以 `accept:true` 同意；本次雙方同意完成，回 `cleared:true`，兩種身分 GET 都是 `planting:null` |
| `07-` | 清除後倉庫與圖鑑；先前已偷入 user 倉庫的量不扣回，agent 沒有採收進倉，圖鑑仍是 0 |

`.request.json` 為 REST body，`.response.json` 為其原始 `results` 包裝；`.mcp.request.json` 是 MCP 工具參數，`.mcp.response.json` 及 `.agent.json` 保留 MCP 的 `ok/result` 包裝。`.user.json` 是 REST `GET /api/garden/private` 原始回應。檔案序號是流程順序。

提案位於 `planting.clear_proposal`。`proposed_by` 與 `approved_by` 使用 `user:<id>`、`agent:<id>` 身分 key；提出者一開始即在 approved_by。此服務目前在有提案時，兩種身分都回 `revoke_clear`，尚未同意的另一方另回 `consent_clear`。例如 user 自己提出後，其 user 快照只有撤回相關控制；agent 提出時，user 快照同時有同意／拒絕與撤回資格。可執行按鈕依當次 `allowed_actions`，不要把 actor kind 字串直接當成 proposed_by。

拒絕不保留一個 rejected proposal，會直接取消目前提案；後續重新提出取得新 proposal ID。完成共同清除後 user 的 allowed_actions 為空陣列，agent 為 `["plant"]`。完成前始終指向同一 planting，完成後地塊 ID 保留，planting 清空。

本次首批總量 5274 g，user 已偷入倉 2637 g，剩餘 2637 g。最後清除將尚未領取的 2637 g 寫入一筆 `clear_loss` 帳本（無倉庫擁有人），不補給 user 或 agent、不扣已入倉；此結果用同一隔離 DB 查證，沒有虛構帳本 API。未採收的清除損失也不計圖鑑。

mutation 完成後刷新 GET；同一意圖重試保留原 request_id 與內容，回放結果可能是先前快照。quantity_g 仍是精確字串，公田可能是分數，不能直接 parseFloat。所有輸出已遞迴檢查不含憑證／seed 欄位及此次 fixture 的 JWT 值。
