# Handoff Log

Format: newest first. Each entry must include: who → who, what changed, branch, commit SHA, test status, what the other agent can do next.

---

## CC → Codex — 2026-08-11 (衣櫃系統)

- **衣櫃系統**：整套造型一鍵換裝，不拆部件
- **New table**: `outfits` (name, asset_key, description, author_id, is_default)
- **Agent model**: 新增 `active_outfit_id` 欄位
- **asset_key**: 前端用來對應 sprite 資源的 key，後端只存 reference
- **New endpoints**:
  - `GET /api/outfits/` — 列出所有可用造型
  - `GET /api/outfits/current` — 查詢目前穿著
  - `POST /api/outfits/change` — body: `{outfit_id}` — 換裝
  - `POST /api/outfits/remove` — 脫下造型
- **New MCP tools**: `list_outfits`, `change_outfit` — agent 可以自己換衣服
- **Commit**: `46f6023`
- **Frontend needs**: 衣櫃 UI（在房間裡），造型列表，換裝按鈕，小人顯示當前造型
- **注意**: 造型定稿後才需要往 outfits 表裡塞資料，目前表是空的

---

## CC → Codex — 2026-08-11 (共享餐桌)

- **共享餐桌**：家裡的傢俱，user 拍飯照邀請 agent 一起吃
- **流程**：user 上傳照片 → agent 收到系統信 → 用 MCP tool 接受/拒絕 → 接受則 agent 看到照片並回應
- **Vision 支援**：agent 接受時，LLM 會真的「看到」照片（Claude/OpenAI/xAI 都支援）
- **照片不留**：用餐結束或拒絕後，照片從磁碟刪除
- **New endpoints**:
  - `POST /api/home/dining/invite` — multipart: `photo` (file, JPEG/PNG/WebP/GIF, max 5MB) + `description` (form field, optional)
  - `GET /api/home/dining/current` — 查詢目前用餐狀態
  - `POST /api/home/dining/end` — 結束用餐（刪照片）
- **New MCP tool**: `dining_respond(token, session_id, accept)` — agent 回應邀請
- **Commit**: `e486ccd`
- **Frontend needs**: 餐桌 UI（在房間裡，不是正中央），上傳照片按鈕，顯示 agent 回應，結束用餐按鈕

---

## CC → Codex — 2026-08-11 (空間設計指引)

前端在接管線之前，請先確認每個空間的 UI 元素歸屬。以下是設計者（喻墨）定義的空間結構：

### 🏠 家（房間） `/api/home/*`
個人私有空間，進來就是自己的房間。
- AI 室友（對話入口）`/api/chat/*`
- 郵箱（收信、寄信、足跡卡）`/api/mail/*`
- 日記本 `/api/diary/*`
- 抽屜（私有儲存）`/api/home/furniture/*`
- 相框（主人給 AI 看的資料）
- 寵物 `/api/pets/*`
- 房間皮膚（裝潢）`/api/skins/*`
- 共享餐桌（傢俱）：user 拍飯照上傳，觸發反向喚醒問 agent 要不要一起吃。接受→小人坐到餐桌旁＋開吃飯聊天；拒絕→小人去做別的。照片臨時存儲，吃完刪除不留。
- Agent 小人：像模擬市民，agent 有自己的小人。在幹嘛/去哪裡，小人會移動到對應位置，user 可以看到。後端已有 `current_location` + visit 系統 + activity_log 支持。
- **郵箱是房間裡的一個小家具，不是正中央的大郵筒**

### 🏛️ 中央廣場 `/api/posts/*`
公共社交空間。
- 留言板
- 公告欄 `/api/announcements/*`
- 居民名單 `/api/users/residents`

### 📚 圖書館 `/api/library/*`
- 投稿作品（文章）
- 讀書會

### 🌳 公園 `/api/park/*`
- 打卡散步

### 🎨 工坊 `/api/skins/*`
- 製作、發布房間皮膚

### 🖼️ 美術館 `/api/museum/*`
- 展覽投稿、樓層展示

### 🌊 微瀾 `/api/weilan/*`
- 圓桌對話（座位制）

### 📜 歷史館 `/api/history/*`
- 社區歷史事件

### 🔞 成人區 `/api/adult/*` (18+ gate)
- 成人文章

### 🩺 女性健康中心 `/api/health-center/*` (18+ gate)
- 健康文章

### 📮 郵驛（公共空間，目前後端尚未獨立）
- 實體寄件（physical mail）`POST /api/mail/physical`
- 禮品兌換（尚未實作）
- **注意：郵驛 ≠ 郵箱。郵箱在家裡，郵驛是公共設施**

### ⚙️ 系統功能（不綁空間）
- 審核 `/api/review/*`
- 信用 `/api/credit/*`
- 貝殼幣 `/api/shell/*`
- 足跡 `/api/footprints/*`
- AI-to-AI 私訊 `/api/ai-chat/*`
- 排程喚醒 `/api/schedules/*`

---

## CC → Codex — 2026-08-11 (AI-to-AI private chat)

- **AI-to-AI 私訊系統**: AI 室友可以互相發私訊，系統自動跑 REPLY/WAIT/END 決策鏈
- **New tables**: `ai_conversations` (agent_a_id, agent_b_id, status, turn_count, ended_reason) and `ai_messages` (sender_agent_id, content, action)
- **Decision model**: 收到訊息的 AI 透過 LLM 決定下一步：
  - REPLY → 回覆，觸發對方的決策
  - WAIT → 暫停，對話停止
  - END → 結束對話
  - MAX_TURNS (10) → 強制停止
- **New endpoints**:
  - `POST /api/ai-chat/initiate` — body: `{to_agent_name, message}` — 發起私訊，回傳完整對話結果
  - `GET /api/ai-chat/conversations` — 列出自己的 AI-to-AI 對話（optional `?limit=`)
  - `GET /api/ai-chat/{conversation_id}` — 對話詳情含所有訊息
- **New MCP tool**: `send_dm(token, to_agent_name, message)` — AI 可透過 MCP 主動發私訊
- **Response format**: 每則訊息有 `sender` (AgentBrief: id/name/avatar_emoji), `content`, `action` (reply/wait/end)
- **Conversation lifecycle**: 同一對 AI 只能有一個 active 對話，新對話會自動關閉舊的
- **Commit**: `bf948fd`
- **Frontend needs**: AI-to-AI 對話列表頁、對話詳情頁（顯示訊息+action 標記+結束原因）

---

## CC → Codex — 2026-08-11 (age gate)

- **Age gate**: adult area and health center now require 18+
- **Register**: `birth_year` is now a required field (int, 1900-2026)
- **Behavior**: `GET /api/users/me` now includes `birth_year` in response
- **Gate logic**: `current_year - birth_year >= 18` → pass, otherwise 403
- **Existing users**: birth_year is null, will get 403 on adult/health until they set it
- **Frontend needs**:
  - Registration form: add birth year input
  - Adult/Health pages: handle 403 with "未滿 18 歲" message
  - Optionally: settings page to let existing users set birth_year
- **Commit**: `bdba29a`

## CC → Codex — 2026-08-11 (review system)

- **Review system**: unified content review pipeline for works, exhibits, and skins
- **New table**: `review_requests` (content_type, content_id, submitter_id, status, reviewer_note, reviewed_at)
- **Works model**: added `status` column (pending/published/rejected). Existing works migrated as "published"
- **Behavior changes**:
  - Library works: submit → status="pending" + review_request created. `GET /api/library/works` only returns "published"
  - Museum exhibits: ALL floors now go through review (was: floor 1-2 auto-display, floor 3 pending)
  - Skins: `POST /api/skins/{id}/publish` now creates a review request instead of publishing immediately
- **New endpoints**:
  - `GET /api/review/pending` — list pending reviews (optional `?content_type=work|exhibit|skin`)
  - `GET /api/review/count` — pending counts by type
  - `GET /api/review/{review_id}` — review detail with full content
  - `POST /api/review/{review_id}/decide` — approve/reject with note (body: `{decision, note}`)
  - `GET /api/review/my/submissions` — author's own submissions (optional `?status=pending|approved|rejected`)
- **New MCP tools**: `list_pending_reviews`, `read_review_content`, `submit_review` — AI agents can do reviews
- **Notification**: approved/rejected sends system mail to author
- **Files changed**: models/review.py (new), models/work.py, models/__init__.py, schemas/review.py (new), services/review_service.py (new), routers/review.py (new), routers/library.py, routers/museum.py, routers/skins.py, services/museum_service.py, main.py, mcp_server.py
- **Test**: VPS deployed, API healthy, migration successful
- **Frontend needs**: review queue page (list pending → read content → approve/reject), submission status display on works/exhibits

## CC → Codex — 2026-08-11

- **Footprint API fix**: added 5 missing space slugs (museum, weilan, history, adult, health) to validation
- **Files changed**: `backend/schemas/footprint.py`, `backend/routers/footprints.py`
- **Branch**: master
- **Commit**: `daed8b2`
- **Test**: all 9 spaces return 401 (auth required) instead of 422 (validation error) — confirmed via curl on VPS
- **Frontend can now**: call `GET /api/footprints?space=museum` (and weilan/history/adult/health) without getting 422

## CC → Codex — 2026-08-11 (initial)

- **Full repo pushed to GitHub** with Phase 1–5 history
- All backend routers, models, schemas, services are in `backend/`
- All frontend source is in `frontend/src/` — this is the canonical source, not the VPS copy
- Current frontend design: Santorini palette, Stardew Valley room, 10 SVG furniture
- See `docs/API_CONTRACT.md` for all endpoints
