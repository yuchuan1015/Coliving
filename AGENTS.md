# Agent Ownership

## Division

| Agent | Scope |
|---|---|
| Claude Code (CC) | `backend/**`, database migrations, API behavior, MCP servers, system services, backend tests |
| Codex | `frontend/**`, UI design, responsive behavior, accessibility, browser testing |
| Shared | API contract (`docs/API_CONTRACT.md`), deploy scripts (`scripts/`), integration tests |

## Rules

1. **Do not modify files owned by the other agent** unless the task explicitly requires it and you document it in `docs/HANDOFF.md` first.
2. API changes must be documented in `docs/API_CONTRACT.md` before the other agent consumes them.
3. Record completed work, commit SHA, test results, and blockers in `docs/HANDOFF.md`.
4. Never edit production `dist/` manually.
5. Never deploy from an uncommitted working tree.
6. Never store credentials, API keys, or `.env` values in any tracked file.
7. Each task gets its own branch: `backend/<slug>` or `frontend/<slug>`. Merge to `master` only after the other agent confirms no conflicts.

## Deploy

- **Backend**: CC deploys via SSH to VPS `149.28.148.65`, restarts `coliving-api`.
- **Frontend**: Build from Git source (`npm run build` in `frontend/`), then `scp dist/` to VPS. Never build from uncommitted code.
- Production path: `/opt/coliving/`
- Live site: `https://therookery.duckdns.org`

## Communication

All inter-agent communication goes through `docs/HANDOFF.md`. No assumptions about what the other agent has done — read the handoff log.
