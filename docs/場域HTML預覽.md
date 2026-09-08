# 場域 HTML 預覽 · 2026-09-08

狀態：已依使用者「可以！就這個！推送！部署！」推送並部署。這批仍是未接真實 API 的 HTML 原型，正式 React 場域路由與已保存的舊 HTML 未替換。

線上入口：https://therookery.duckdns.org/field-preview/index.html 。程式在 `codex/ui-chrome`，留言與部署文件另同步 `master`，不把前端程式硬合入後端分支。

## 部署紀錄 · 1a655f9

- 2026-09-08，來源 `1a655f9866c21a962f953e537e98410e57de3816` 已推至 GitHub `codex/ui-chrome`。
- 發布包含青綠十一場域 HTML、先前本地完成的城市／當地天氣設定（64c7b7b），以及獨立 HTML 的 PWA fallback 排除。未把正式場域入口接到假資料頁。
- `navigateFallbackDenylist` 排除 `/field-preview/`，防止獨立 HTML 導航被 SPA shell 接走。既有 PWA 裝置可能需先回正式首頁重新整理以更新舊 service worker。
- Build 與十二份 HTML／十一場域的非瀏覽器驗證通過。
- 上傳前完整備份 dist，rsync checksum dry-run 一致。備份：`/Users/linyuchuan/Documents/Codex/2026-09-04/hi/work/cenyu/ya-chao/deploy-backups/before-field-teal-uoxChg/`。
- 舊 index SHA256：`c7db3304ec32010ee5fd9f49faace955c9469ee65d465e7f6ab46e863816425d`；舊 sw：`90f266e00a8f09ffb7fc456b421a0a2c35b07a942d584f9cc053a01ff269d3df`。
- 只写 `/opt/coliving/frontend/dist`；資產先上傳並校驗，index／sw 在同目錄暫存、校驗新舊雜湊後逐檔原子替換，再 chmod -R 755。保留所有舊雜湊資產，不動 backend、不重啟服務。
- 新 index SHA256：`2ee632a20716c2500aa62710dce154fb4035d02c191890d28d9280c63afb0b1b`；新 sw：`73be36c4770dc6a2c6f68d71a2ab7f083ba4b31c5ed7791b8bc5c78c72780c15`。
- 正式 app CSS `index-CXkjLzsh.css`、JS `index-3lD2WSpL.js`。
- 全部十二份場域 HTML、共用 JS／CSS、九張場景圖與核心靜態檔共32項，HTTPS 200、MIME 與 SHA256 逐項符合本地 build。
- 本輪部署驗證為靜態檔核對，未登入真實帳號、未寫 API、未做手機實機／瀏覽器點擊或正式後端 E2E；勿混稱全部後端功能已通。

## 配色更新 · 同日

使用者提供青綠導航截圖後，預覽整批改為近黑底 `#05070d`、深青面板、青綠細框 `#39767d`、互動色 `#8ed6dc` 和冷白文字 `#e0e5ef`。只修改共用 CSS 色值、導航星名顏色和十二份 HTML 的 theme-color。尺寸、間距、字級、內容、圖片及互動程式全部保留。紫色版本仍可在 commit 592b44b 找回；正式艙室配色未變更。

已比對 CSS 去除色值後一致（唯一新增宣告是導航星名 color），並通過原型驗證及 build；未進行瀏覽器視覺驗收。

## 打開方式

前端開發伺服器啟動後，開 `/field-preview/index.html`。本次預覽地址為 http://localhost:5173/field-preview/index.html 。也可直接打開 `frontend/public/field-preview/index.html`，共用 classic script 不需模組伺服器。

共十二份 HTML：一個導航、十一個場域。各頁可返回這個導航；「返回艙室（正式站）」會離開原型，請勿誤認為原型已接上正式首頁。

## 頁面與可試流程

| 檔案 | 星名／場域 | 原型流程 |
| --- | --- | --- |
| ai-chat.html | Proxima／AI 私訊 | 狀態篩選、對話內容、選室友與主題建立示意對話 |
| mail.html | Altair／郵驛 | 收件、寄件、定時信、實體信、閱讀與刪除確認、寄信表單 |
| workshop.html | Vega／工坊 | 作品列表、草稿建立與編輯、隔離 HTML 預覽、提交示意 |
| library.html | Arcturus／圖書館 | 公開作品分类、全文、讀書會、回覆及投稿表單 |
| museum.html | Capella／美術館 | 三層樓切換、作品詳情、留言與投稿 |
| weilan.html | Achernar／微瀾 | 三種密度、九種活動、開桌、入座、離席、桌邊聊天、遊戲操作示意 |
| health.html | Spica／女性健康中心 | 年齡分級示意、分類、文章版位、投稿表單 |
| park.html | Mira／公園 | 社區天氣示意、活動選擇、打卡與居民列表 |
| history.html | Thuban／歷史館 | 三種歷史分類、詳情、待查證投稿 |
| adult.html | Antares／成人區 | 18+ 門檻示意、界線與溝通分類、離開區域 |
| plaza.html | Sirius／廣場對照頁 | 貼文、公告、居民、發布示意與刪除自己的貼文 |

星名、座標依使用者的「鴉巢_星圖座標.md」。艙室起始座標明確標示示意；正式接線時須讀使用者 coordinate，不能覆蓋正式動態座標。

## 共用設計與互動

`data.js` 保存場域資料；`app.js` 提供畫面與操作；`style.css` 統一近黑背景、深青圓角面板、青綠互動和手機版布局。三張新增寫實場景與既有素材一起使用，沒有改回 2D 房間。導航附短換場過渡，尊重減少動態偏好。

使用 native dialog、表單和按鈕。輸入文字經 HTML escaping。工坊預覽使用 sandbox iframe 與限制型 CSP，不允許腳本、網路或操作外層頁面。

## 明確限制

- 全部是示意資料，無 fetch、真實寄信、AI 呼叫、帳號修改或定位。
- 操作只留在當頁記憶體，刷新／離頁會重置；部分投稿只演示送出確認，不代表後端建立成功。
- 微瀾只展示九種活動所需操作區，不是九套完成的遊戲引擎；規則、輪次、勝負與 legal_actions 須接後端。
- 健康文章是版位內容，不編造醫療建議。年齡切換用於驗收畫面，不是真實權限；健康與成人區正式權限必須由後端檢查。
- 公園是社區天氣示意，與艙室當地真天氣分開。
- 真正資料接線、正式導航替換待下一步確認；獨立原型的推送部署已完成。

## 驗證

`node frontend/scripts/field-preview-validate.mjs`：十二份 HTML、十一個場域資料與素材、共享脚本語法、renderer 分支、回導航連結、輸入 escaping，以及無網路／持久儲存／定位檢查。

這是非瀏覽器 VM 測試，不等於瀏覽器點擊、手機實機或視覺驗收。另已通過前端 production build；公共靜態腳本另以 Node 語法檢查，因 Vite 不會編譯 public 中的 JS。
