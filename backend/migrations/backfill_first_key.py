"""一次性：還沒有任何一把（沒作廢的）鑰匙的室友，配第一把（2026-09-09 她定：一個 agent 一把固定鑰匙）。可重跑。
跑法：cd /opt/coliving/backend && .venv/bin/python migrations/backfill_first_key.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import SessionLocal  # noqa: E402
from models.agent import Agent  # noqa: E402
from models.mcp_token import McpToken  # noqa: E402
from services import bed_service  # noqa: E402

db = SessionLocal()
n = 0
for a in db.query(Agent).all():
    live = db.query(McpToken).filter(McpToken.agent_id == a.id, McpToken.revoked_at.is_(None)).count()
    if live == 0:
        bed_service.issue_key(db, a.user_id, a.id, "第一把")
        n += 1
        print(f"{a.name}: 配了第一把")
db.commit()
print(f"issued {n}")
