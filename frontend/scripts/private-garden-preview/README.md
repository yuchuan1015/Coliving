# 私人菜園隔離驗證

這是正式 `PrivateGardenPage` 的本機測試入口，不是另外一份設計或正式服務。
不讀登入資訊、不連正式 API、不使用 localStorage 保存遊戲資料、不啟動 PWA。

```sh
node node_modules/vite/bin/vite.js --config scripts/private-garden-preview/config.ts
```

僅監聽 `127.0.0.1:5194`，strictPort；沒有 API proxy。`client.ts` 取代所有正式 HTTP client，帳號 context 是獨立測試 context。重新整理即可回到初始資料。

- `/`：裝置框，320／390／1280px；case 選擇器是測試工具，不進正式程式。
- `/?frame=1&case=ready`：單頁。
- `growing`、`ready`、`harvested`：隔離後端的生長／成熟／採收快照。
- `own-proposal`：自己提出等室友，可撤回。
- `agent-proposal`：室友提出，使用者拒絕或勾選後同意。
- `cleared`：雙方同意後空地，已入倉保留。
- `four-plots`：明確合成的四地排版；第 4 地為可澆水的 production_complete 留株。
- `fractions`：明確合成的 `200/3`、極小份額與分頁。
- `unknown`：記憶體操作已成功後模擬回應遺失；原 ID 重試只回舊收據，不二次入倉。
- `stale`：逐筆 409。
- `no-agent`：巢狀 `error.code=agent_required` 的 403，引導返回艙室，不誤叫重新登入。
- `denied`／`unavailable`：無權限／讀取失敗。

## Fixture 來源與邊界

`fixtures.json` 取自後端 `docs/examples/garden-tier1` 與 `clear-proposals` 的隔離 SQLite REST 範例。只保留前端需要的作物展示欄位與精簡照顧紀錄，其餘快照欄位維持來源值。這些不是正式住戶資料。

原生長／成熟世界與後補共同挖除世界的 ID 不可混接；gateway 各 case 整組使用同一世界的身份／快照／倉庫。`four-plots` 和 `fractions` 只是排版及精確數量測試，不作為遊戲引擎或作物產量的驗證來源。

gateway 僅供互動測試，不取代後端引擎。生長、成熟判斷、產量、掉落、時間推進與 Agent 操作都由正式後端負責。

## 自動檢查

```sh
node node_modules/typescript/bin/tsc -b
node node_modules/typescript/bin/tsc -p scripts/private-garden-preview/tsconfig.json
node --test scripts/field-contract.test.mjs scripts/cabin-palette.test.mjs
node scripts/build-ui-catalog.mjs --check
node node_modules/vite/bin/vite.js build
```

Production App 只匯入正式私人頁，不匯入本目錄。禁止把 preview gateway 接到正式路由。
