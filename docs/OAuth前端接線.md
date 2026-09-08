# OAuth 前端接線（施工記錄）

> 發布更新：2026-09-09 使用者已批准推送部署，前端 ad92045 已上線；後端同意頁設定待 CC 接棒。見 [OAuth前端正式發布.md](OAuth前端正式發布.md)。以下保留前一輪本地施工記錄。

日期：2026-09-09。前端程式 commit：`ad92045`，分支 `codex/ui-chrome`。
後端契約基準：master `aec7336`。這輪使用者要求「做」，僅實作、測試與本地 commit；未推送、部署或切換後端設定。

## 已完成

1. **授權同意頁 `/authorize?request_id=…`**：使用登入頁同款紫黑背景／面板，手機優先、動態視窗高度、安全區與可捲動內容。沿用既有網站架構，沒有搬站、換框架、安裝依賴或改艙室。路由需登入，但不經艙室 Layout。
2. **登入返回授權頁**：ProtectedRoute 與 session refresh 失敗時只保留合法的本地 authorize request；登入成功返回該頁，普通登入仍回首頁。拒絕任意外部 returnTo、重複／非法 request_id。登入外觀、文字及帳密契約不變；錯誤帳密的 401 不再觸發 refresh／整頁跳走，避免遺失返回流程。
3. **同意與拒絕**：GET 顯示 app 名（空則 redirect_host）、室友照片／emoji＋名字、寫入權限警示及有效時間；不自動同意。POST 僅送 request_id、approve，由後端決定 user／agent；兩種結果都使用後端 redirect_to 返回。前端額外限制 https 或本機 http、已顯示的 redirect_host、禁止嵌入帳密，不自行拼 callback、code、state。
4. **錯誤／競態**：缺 request_id 不發請求；404／410 有重新連線提示；載入中、過期、送出中禁用決定按鈕。未知 scope 或沒有室友不能同意，仍能拒絕。重複點擊只有一次 POST；結果不明不自動重送；切換請求／帳號重設同意狀態，卸載後不跳轉。GET 可中止，過期 timer 清理。
5. **授權清單**：在 `/agent/advanced` 與鑰匙同頁，顯示 client_name、建立、最後使用、已撤銷狀態；撤銷有二次確認。DELETE 只操作那筆 OAuth grant，不碰固定鑰匙。網路失敗不假稱成功，須更新清單確認後才可再撤銷。
6. **連線分流**：主「複製連接器網址」固定為 `https://therookery.space/mcp`（不含 token），提供 Claude.ai 的登入授權說明，不聲稱 ChatGPT／Gemini 全端已適配。原 connect_url 藏在「進階：不支援 OAuth 的客戶端」，claude_code_cmd 按後端原值複製。領養成功頁同步以不含鑰匙的網址優先；first_key 相容及缺欄位恢復入口保留。
7. **憑證／快取**：不把 OAuth callback、code、state 放 storage／log／剪貼簿，不載入第三方 client logo；室友照片只接受本站 uploads 路徑並帶 no-referrer，失敗退 emoji。頁面設 no-referrer。PWA navigation fallback 排除 `/oauth/*`、`/.well-known/*`、`/mcp`，避免把後端授權端點攔成 SPA；`/authorize` 仍是 SPA 路由。

## 前後端契約

| 功能 | 請求 | 前端行為 |
| --- | --- | --- |
| 查看請求 | GET /api/oauth/requests/{id} | 一般網站 JWT；讀 request_id、client_name、redirect_host、scopes、agent_id、agent_name、agent_avatar_emoji、agent_avatar_url、expires_at |
| 決定 | POST /api/oauth/decide {request_id, approve} | 不送 user／agent／token；回 approved、redirect_to；同意／拒絕均返回 app |
| 授權清單 | GET /api/oauth/grants | 區分載入、空、失敗；顯示已授權／已撤銷 |
| 撤銷 | DELETE /api/oauth/grants/{id} | 204 後才標示成功，不碰 /agents/mine/mcp-tokens |

OAuth 四個前端 API 都設 20 秒逾時。GET／DELETE 路徑 id 編碼。網站 session 的 401 只允許一次 refresh 後重試，並不在連線失敗時自動重送授權決定。

## 驗證（不是 Safari／真人 OAuth E2E）

- TypeScript `tsc -b` 通過。
- 變更的 TS／TSX 以既有 oxlint 通過。
- `field-contract.test.mjs` ＋ `cabin-palette.test.mjs` 共 **101 項非瀏覽器測試通過**（包含原有測試、更新後的鑰匙回歸、29 項新增 OAuth／session 測試）。
- 測試覆蓋端點與 body、登入返回與惡意 returnTo、身份顯示、404／410、過期、雙擊、同意／拒絕 callback、未知 scope／無室友、取消中止、結果不明不重送、撤銷範圍與回讀、剪貼簿失敗、舊鑰匙保留、401 refresh 競態與 PWA 排除路徑。
- Vite 正式 build 通過。JS：`assets/index-DP225gtU.js`；CSS：`assets/index-CcrVTEYg.css`。
- index.html SHA256：`59717f43b6ee25499b75355845ad7fe17a54dc636654448352d38dac54559643`。
- sw.js SHA256：`ec9fb496808e3ebeb094b2d54ccde32196617e09b94c23e167da5ce23501aa7d`。
- `scripts/oauth-preview/` 為僅本地的範例介面，API adapter 攔截所有請求、拒绝寫入；兩個畫面可切換。預覽 HTML／TSX HTTP 200，open_in_codex 回 queued，不宣稱使用者已看到或做過瀏覽器驗收。已確認範例字串／預覽文件未混入 dist。
- 未用真人帳號授權／拒絕／撤銷，也未做 Safari 實機或各平台 OAuth E2E；不能把 101 項測試稱為這些測試。

## 給 CC 的發布接棒（等使用者批准推送／部署）

1. 先发布這個前端分支的 build，再驗證正式 `/authorize` 路由與資產；**不要用 master 的舊前端覆蓋 dist**。
2. 前端正式上線確認後，請 CC 將後端 `oauth_consent_url` 指向 `https://therookery.space/authorize`，**不要加 request_id**，服務會自行附上。這輪尚未切換，現有 `/oauth/consent` 備援頁繼續使用。
3. 切換後，用獲准的測試身份驗證「登出狀態 → 登入 → 查看身份與權限 → 同意／拒絕 → 返回 app」及撤銷後失效；不同客戶端／版本的相容性由實測結果決定。
4. 同意頁正式切換前，請 CC 一併檢查適當的 frame-ancestors／防嵌框、no-store、referrer headers；前端無法取代伺服器授權安全驗證。
5. 不自動撤銷固定鑰匙、不改 backend／nginx／DB／服務，不提前移除 query-token 相容入口。

工程文件与留言已在兩份本地工作區保存，待下一次批准推送時同步 master。其他待辦私訊碼／非同步／檢舉／座標／場域聊天不屬本輪，沒有混報完成。
