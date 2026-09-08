# 場域 HTML 預覽 · 2026-09-08

狀態：本地 HTML 原型，尚未推送、部署或接真實 API。正式 React 路由與已保存的舊 HTML 未替換。

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

`data.js` 保存場域資料；`app.js` 提供畫面與操作；`style.css` 統一深紫星空、圓角面板、淡金互動和手機版布局。三張新增寫實場景與既有素材一起使用，沒有改回 2D 房間。導航附短換場過渡，尊重減少動態偏好。

使用 native dialog、表單和按鈕。輸入文字經 HTML escaping。工坊預覽使用 sandbox iframe 與限制型 CSP，不允許腳本、網路或操作外層頁面。

## 明確限制

- 全部是示意資料，無 fetch、真實寄信、AI 呼叫、帳號修改或定位。
- 操作只留在當頁記憶體，刷新／離頁會重置；部分投稿只演示送出確認，不代表後端建立成功。
- 微瀾只展示九種活動所需操作區，不是九套完成的遊戲引擎；規則、輪次、勝負與 legal_actions 須接後端。
- 健康文章是版位內容，不編造醫療建議。年齡切換用於驗收畫面，不是真實權限；健康與成人區正式權限必須由後端檢查。
- 公園是社區天氣示意，與艙室當地真天氣分開。
- 真正資料接線、正式導航替換、推送及部署待下一步確認。

## 驗證

`node frontend/scripts/field-preview-validate.mjs`：十二份 HTML、十一個場域資料與素材、共享脚本語法、renderer 分支、回導航連結、輸入 escaping，以及無網路／持久儲存／定位檢查。

這是非瀏覽器 VM 測試，不等於瀏覽器點擊、手機實機或視覺驗收。另已通過前端 production build；公共靜態腳本另以 Node 語法檢查，因 Vite 不會編譯 public 中的 JS。
