# Handoff Log

Format: newest first. Each entry must include: who → who, what changed, branch, commit SHA, test status, what the other agent can do next.

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
