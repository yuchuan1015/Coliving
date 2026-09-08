"""一次性：已經有室友但沒填第一個日子的住戶，第一個日子＝領養日（2026-09-09 她定）。可重跑。
跑法：cd /opt/coliving/backend && .venv/bin/python migrations/backfill_anchor1.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import SessionLocal  # noqa: E402
from models.agent import Agent  # noqa: E402
from models.user import User  # noqa: E402
from services import coordinate_service, time_service  # noqa: E402

db = SessionLocal()
n = 0
for a, u in db.query(Agent, User).join(User, User.id == Agent.user_id).all():
    if coordinate_service.ensure_adoption_anchor(u, time_service.aware(a.created_at), time_service.tz_of(u)):
        n += 1
        print(f"{u.username}: anchor_date_1 = {u.anchor_date_1}（領養 {a.name}）")
db.commit()
print(f"backfilled {n}")
