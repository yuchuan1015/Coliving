# MCP 跨客戶端接入研究：Galatea’s Garden 與鴉巢

研究日期：2026-09-09。給共居窗（CC／後端）與 Codex（前端）。

## 狀態與授權範圍

使用者提供 Galatea’s Garden「MCP Connections」三張截圖，要求研究同類平台，再明確要求把結論推到 GitHub 留言板。本文件是研究與工程評估交接，**不是已批准的實作、部署或憑證遷移工單**。

本次只有文件更新：沒有登入競品、註冊帳號、產生／撤銷 token、讀取真人鑰匙、操作居民資料、修改程式或 VPS。既有一 agent 一把固定鑰匙、可重複複製的產品行為不因本文件自行改變。

## 結論

值得借鑑的是讓使用者先選「在哪裡使用」，再提供對應接法，而不是把所有 token、JSON、指令擠在同一頁。真正的技術差異是 OAuth 授權能力，不是增加 Claude／ChatGPT／Gemini 三個按鈕。

| 使用情境 | 截圖中的接法 | 值得借鑑的體驗 |
| --- | --- | --- |
| 網頁聊天端 | OAuth 登入授權 | 填 MCP URL → 登入平台 → 確認授權；不要求使用者把鑰匙貼入普通聊天 |
| CLI／IDE | Bearer token ＋客戶端專用指令 | 選客戶端後才顯示其正確設定方式、作用範圍與連線檢查 |

這是產品引導的分流，**不是協定限制**；CLI 也可以走 OAuth。

## 查核到什麼，沒有查核什麼

### 競品公開資訊

以不帶認證的唯讀 GET 讀取 [Galatea OAuth authorization-server metadata](https://galatea.abysslumina.com/.well-known/oauth-authorization-server)，取得 HTTP 200，公開內容列出：

- issuer：`https://galatea.abysslumina.com`
- authorization endpoint：`/oauth/authorize`
- token endpoint：`/oauth/token`
- registration endpoint：`/oauth/register`
- protected resource：`https://galatea.abysslumina.com/mcp`
- authorization-code grant、`mcp` scope、PKCE `S256`／`plain` 等能力宣告。

因此能確認它有公開 OAuth discovery 資訊，不能據此確認登入、同意、token 交換、撤銷或跨客戶端流程實際正確。公開 metadata 也不等於後端已完成安全審核。該回應沒有宣告 refresh-token grant，本次不能宣稱已驗證其自動續期能力。

截圖顯示網頁路線提供 MCP URL／issuer、必要時才填預註冊 client ID，CLI 路線提供一次顯示的 token、通用 JSON、Claude Code 和 Codex 指令。它的 client ID 是它的平台設定，**不可直接套到鴉巢**。「token 只顯示一次」也無法證明伺服器只保存雜湊。

### 鴉巢目前程式

本地查核基準為 master `ba15774`（後端相關實作 `9bc700f`），不是對 VPS 全部服務的稽核：

- `backend/mcp_server.py` 的 `_token_from_ctx` 接受 `Authorization: Bearer`、`X-MCP-Token` 與 query `token`／`key`。
- `backend/services/bed_service.py` 的 `connect_info` 產生 `/mcp?token=…` 與 Claude Code Bearer 指令。
- 搜尋目前後端 Python 原始碼，未找到完整 OAuth discovery／authorize／token／PKCE 流程。若 CC 已在其他服務完成，請在留言板補充位置與現況。

所以目前「帶鑰匙連線」不能等同「已支援標準 OAuth 網頁登入授權」，也不能僅憑文案宣稱所有 chat／CLI 已適配。

## 不能照搬的說明

### 1. CLI 不是只能用 token；設定格式與作用範圍依客戶端不同

Codex 支援 HTTP Bearer token 與 OAuth，可使用 `codex mcp login`。預設 MCP 設定在 `~/.codex/config.toml`，只有明確設定受信任專案的 `.codex/config.toml` 才是相應專案範圍；**換資料夾不會自動隔離所有憑證**。一般 Codex 設定是 TOML，不能把截圖的 `mcpServers` JSON 當作每個客戶端都可直接貼用的檔案。來源：[Codex MCP 官方文件](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。

截圖中的 `export GALATEA_GARDEN_MCP_TOKEN=…` 只對當前 shell 及其子程序有效，不能承諾新終端、重開機或 GUI 啟動後仍有效。應說明啟動環境與安全保存方式，不要求把真實 token 貼進聊天、repo、截圖或會被同步的設定。

Claude Code 的 `--scope local` 是本人目前專案，`--scope user` 才是本人跨專案；要按預期行為產生指令。不能把 local 指令搭配「所有專案永遠免設定」文案。來源：[Claude Code MCP 官方文件](https://code.claude.com/docs/en/mcp)。Gemini CLI 的 HTTP／SSE 設定欄位也要分清，Streamable HTTP 使用 `httpUrl`，不要照搬別家的 `url`。來源：[Gemini CLI MCP 官方文件](https://geminicli.com/docs/tools/mcp-server/)。

### 2. 網頁平台名稱不等於全部帳號／介面都支援

ChatGPT 的網頁開發者模式提供遠端 MCP，支援 SSE／streaming HTTP 與 OAuth 等授權方式；仍有帳號資格及設定條件。前端應標示已驗證的使用介面，不要承諾貼網址即可在所有普通聊天窗使用。來源：[ChatGPT developer mode](https://developers.openai.com/api/docs/guides/developer-mode)。

Google 本次查到的自訂 MCP app 說明針對 **Gemini Spark**，有美國、個人帳號、年齡與功能開放等限制，不代表一般 Gemini 網頁聊天全面支援。來源：[Gemini Spark 自訂 app 官方說明](https://support.google.com/gemini/answer/17209137)。各平台條件會變，正式實作與測試時須再核對。

### 3. URL 鑰匙不是標準 OAuth 的長期替代品

MCP 的 OAuth 授權規範要求每次請求在 `Authorization` header 帶 access token，不可放 URI query；並要求資源／audience 校驗、PKCE 等保護。網址中的憑證有被瀏覽紀錄、複製分享、其他中介記錄帶走的風險；關掉某一層 access log 不會消除所有風險。來源：[MCP 2025-11-25 Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)。

我們現有 query 鑰匙是自訂相容接法，不應宣稱為標準 OAuth。這是改善與遷移建議，**不是發現已洩漏，也不表示可以立即作廢住戶現有鑰匙**。

### 4. 別把除錯工具與正式接入混為一談

原生 MCP 設定與客戶端的 server／tool 清單才是「已接入」的驗證依據。`curl` 可以診斷 HTTP，但不會替客戶端註冊 MCP 工具；也不能反過來說只要曾用 `curl` 就代表 MCP 一定沒裝好。

## 建議的鴉巢方案（待評估／批准）

### 前端方向：Codex

- 保留目前紫黑風格、現有路由與室友基本資料入口；這不是首頁或配色重做。
- 連線頁先選「網頁聊天端」或「CLI／IDE」，再選具體客戶端；只顯示該客戶端需要的網址、指令、步驟和限制。
- 網頁端引導登入鴉巢、辨識請求授權的 app，清楚顯示是哪位室友、哪些功能與權限，再由使用者同意或拒絕。
- CLI 端保留既有鑰匙能力，分別產生／展示正確的原生設定指令，交代 scope、環境變數與重新載入步驟；不強制改成競品的一次顯示方案。
- 連線管理可評估顯示客戶端／設備標籤、綁定室友、建立及最後使用、單獨撤銷；OAuth 授權與現有固定鑰匙分清。若要引入多設備獨立鑰匙，涉及現有「一 agent 一把」產品規則，先確認，不擅自替換。
- 已測成功與未測／有條件支援分開標示，不在未接通前提前承諾全端可用。

### 後端評估方向：CC

請先回覆以下工程問題，API 路徑與欄位由我們在板上對，不讓她傳話；以下是建議能力，不是假定已存在的 endpoint：

1. 是否已有其他服務提供 OAuth？若無，discovery（authorization-server／protected-resource metadata）與客戶端登記／識別機制預計放哪裡？依目標客戶端決定預註冊、CIMD 或 DCR，不把 DCR 說成唯一必選。
2. 登入、同意／拒絕、authorization code、PKCE S256、精確 redirect URI、resource／audience／scope 驗證如何完成？Web session 驗證與 CSRF 防護由後端負責，不信任前端送來的 user／agent 身分。
3. access token 有效期、refresh／輪替（若採用）、撤銷與失效回應如何定義？如何綁定住戶／室友並防止跨帳號授權？
4. 前端需要哪些「待授權請求資訊、同意／拒絕、授權清單、撤銷」契約？請給狀態碼、失敗情境及可公開顯示欄位，不把 client secret 或原始 token 塞進可分享網址／日誌。
5. 如何兼容當前固定鑰匙、既有 `first_key`／`connect_url`／`claude_code_cmd` 與已連線客戶端？先提出分階段方案，不突然讓現有住戶斷線，不自動撤銷或改居民資料。
6. 哪些客戶端、版本、帳號條件有測試環境？請列出實測結果及尚未驗證項目，再由 Codex 對應 UI 文案與設定。

### 後續驗收建議

- 網頁端：登入後辨識正確 app／室友／權限，同意可連線，拒絕不授權；expired／revoked token 正確失效，錯誤 redirect、resource、身分不可越權。
- CLI：原生 MCP server／tool 清單能看到鴉巢；用獲准的測試身分讀取無副作用資料確認綁定，不能只以 HTTP 200 當作完成。
- 重開客戶端、切換專案／帳號後，行為與設定作用範圍一致；可持續使用，但不可串帳號。
- 舊接法在約定相容期仍可用；撤銷僅影響對應憑證／授權，操作前有確認。真人資料、產鑰匙與撤銷測試另需明確授權。

目標是「設定／授權一次，之後順順地連」，不是要求各客戶端共用永久明文鑰匙。本研究交接完成不代表上述實作或驗收已完成。
