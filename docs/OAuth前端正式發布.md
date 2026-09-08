# OAuth 前端正式發布

2026-09-09。使用者批准「推送 部署」。

## 已發布

- 正式站：https://therookery.space/
- 連線／授權清單：https://therookery.space/agent/advanced
- 新同意頁：https://therookery.space/authorize （正式請求需附 request_id；沒有請求不會自動授權）。
- 程式來源：`ad92045`；發布時前端分支 `codex/ui-chrome` 的 `e651c34` 已推到 GitHub，和已驗證的程式相同，差別只有施工文件。
- 內容：紫黑色同意頁、登入返回、app 授權清單及確認撤銷、純 /mcp 主要連接器網址、CLI／進階固定鑰匙保留、領養成功頁同步、OAuth 後端路徑 PWA 排除。
- 詳細契約與前端防護見 [OAuth前端接線.md](OAuth前端接線.md)。

## 還有一個後端切換步驟（CC）

**新前端已正式可用，但 Codex 沒有修改後端 oauth_consent_url；不能將本次發布說成新版同意 UI 的真人 OAuth 全流程已驗收。**

請 CC 現在將 `oauth_consent_url` 指向 `https://therookery.space/authorize`（不要附 request_id，後端會附上），並確認服務端防嵌框、no-store、referrer 保護與登入→同意／拒絕→返回 app 的流程。原 `/oauth/consent` 備援頁保留。在 CC 切換前，連接器仍可能看到該備援頁。

這個接棒已隨發布留言推到 master，不要求使用者傳工程細節。不要從 master 的舊前端打包覆蓋目前 dist。

## 驗證結果

- 部署前再跑 TypeScript、101 項非瀏覽器測試及變更檔 oxlint，均通過。
- 沿用上一輪同程式碼已成功的 production build；未修改程式或重新生成素材。
- 正式 HTTPS **42 靜態檔＋20 頁面路由**皆 HTTP 200，內容 SHA256／MIME 與本地一致，包括 /authorize、/agent/advanced、/adopt、/login。
- providers 200 JSON；未登入 users/me、mcp-tokens、oauth/grants 皆 401 JSON。
- OAuth authorization-server／protected-resource discovery 都是 200 JSON；/mcp 無憑證回 401 並帶 resource_metadata challenge。
- 以上是部署、公開檔案與未登入邊界核驗；沒有讀真人鑰匙、產生／撤銷授權、修改居民資料，沒有 Safari 實機或真人 OAuth E2E。

## 部署邊界與回復資料

- 只寫 `/opt/coliving/frontend/dist`；沒有動 backend、nginx、DB、服務、後端設定，沒有重啟。
- 全量備份 **79 檔**，本地雜湊與遠端一致；rsync checksum 乾跑無差異。
- 先上資產，暫存 index／sw；**42 新檔、39 保留檔、原 index／sw** 全數 hash guard 通過後，才各自原子更換 index／sw，並 chmod -R 755。
- rsync 未用 --delete，39 個非本次 build 檔案保留（包含 8 份手機配色預覽與歷次雜湊資產）；艙室素材與登入視覺未改。
- JS：`assets/index-DP225gtU.js`；CSS：`assets/index-CcrVTEYg.css`。
- 新 index SHA256：`59717f43b6ee25499b75355845ad7fe17a54dc636654448352d38dac54559643`。
- 新 sw SHA256：`ec9fb496808e3ebeb094b2d54ccde32196617e09b94c23e167da5ce23501aa7d`。
- 原 index SHA256：`1be65aeaa842fbea819634baf0cd11f62877d5432f69575e907e140937f98ab3`。
- 原 sw SHA256：`32d60918ac6e640348d7a70915e18a738997505363426efcab33d48fae8a6908`。
- 完整備份：`/Users/linyuchuan/Documents/Codex/2026-09-04/hi/work/cenyu/ya-chao/deploy-backups/before-oauth-TvpPCW/`。
- 核驗報告：`/Users/linyuchuan/Documents/Codex/2026-09-04/hi/work/cenyu/ya-chao/deploy-backups/oauth-ad92045-verification.json`。
- 若需回復，先確認沒有更新的發布，再以備份恢復入口／資產；不要直接覆蓋他人後來的部署。備份與詳細 hash 報告僅本地保存，不提交 GitHub。

其他私訊碼／非同步／檢舉／座標／場域聊天待辦不屬於這次發布。

