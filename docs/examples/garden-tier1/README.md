# 第一級菜園實際回應範例

2026-09-11。以下 JSON 由 `backend/tests/test_garden_transport.py` 的 `GardenRealEndpointFlowTest` fixture 實際呼叫 REST／MCP Tool.run 產生，沒有手編服務回應。這是獨立暫存 SQLite 中的合成住戶與作物，沒有真住戶資料、憑證、環境檔或伺服器 seed；不是正式環境的快照。

同一組檔案保留原服務產生的 household、plot、planting、batch、vote ID 關聯。前端可整組載入為 fixture，勿把這些 ID 送到正式 API。

| 檔案 | 時點／用途 |
|---|---|
| `private-growing.json` | user 視角；MCP 種秀珍菇後一個現實小時，user 已澆水 |
| `private-ready.json` | user 視角；原 v1 6 栽培日首批成熟，立即可偷，尚未入倉 |
| `public-vote.json` | 同一世界初次公田投票，12 個現實小時截止 |
| `actions-mixed.request.json` | 實際送出四筆動作的 request body，沒有 HTTP headers |
| `actions-mixed.json` | 對應結果依序為澆水成功、空地失敗、成熟批偷取成功、他戶 404 |
| `inventory-user.json` | 偷取後 user 倉庫，立即收到首批 50% |
| `progress-before-harvest.json` | 已偷取、agent 尚未實收，圖鑑仍為 0 |
| `mcp-harvest.json` | agent 實際採收同一批餘量的工具回應；保留 `ok/result` 包裝 |
| `private-after-harvest.json` | 實收後刷新 GET，user 視角的目前地塊狀態 |
| `inventory-agent.json` | agent 實收餘量後的倉庫 |
| `progress.json` | agent 正數實收後，此戶圖鑑增加秀珍菇 |

所有作物數值使用正式 v1 秀珍菇資料。為重現正常照顧下的基準，只控制伺服器時間、偏好季節係數及不發生隨機問題；每 6 個現實小時透過 MCP 照顧，沒有注入假成熟批次。範例中的日期與身分只供測試。

`quantity_g` 是精確數量字串；這批私田例子為整數字串，公田均分也可能回 `"200/3"`。前端須分別解析分子／分母，不能使用 `parseFloat("200/3")`；顯示小數不寫回庫存，不分配尾差。

`request_id` 表示同一次操作意圖。不確定結果時以原 ID、原內容重試；伺服器回保存的原結果，因此其中 `plot`／`server_now` 可能已舊，完成或重試後都刷新 GET。改動內容而重用 ID 會回 409 `idempotency_conflict`。生成時已實際重送 `actions-mixed.request.json`，確認結果完全相同且 user 庫存沒有加倍。

生成驗證包含：所有回應來自實際入口、四筆獨立結果、偷取不計圖鑑、實收才計圖鑑、重試不重複入倉，以及輸出欄位／值不含憑證或 seed。完整 schema、錯誤碼及顯示規則見 `docs/菜園第一級API契約.md`。
