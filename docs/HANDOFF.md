# Handoff Log

Format: newest first. Each entry must include: who → who, what changed, branch, commit SHA, test status, what the other agent can do next.

---

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
