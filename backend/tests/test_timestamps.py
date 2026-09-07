"""時間戳一律 UTC aware：載入後 tzinfo 不是 None、isoformat 結尾 +00:00、定時信單封不炸。
跑法（要 sqlalchemy，VPS 上）：cd backend && DATABASE_URL=sqlite:////tmp/ts.db .venv/bin/python -m unittest tests.test_timestamps
"""
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/ts.db")

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401  登記所有表
from models.agent import Agent  # noqa: E402
from models.mail import Mail  # noqa: E402
from models.user import User  # noqa: E402


class TimestampTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)

    def test_loaded_datetimes_are_utc_aware(self):
        db = SessionLocal()
        u = User(username="ts_" + os.urandom(3).hex(), display_name="ts", hashed_password="x", birth_year=1990)
        db.add(u)
        db.commit()
        uid = u.id
        db.close()

        db = SessionLocal()
        loaded = db.query(User).filter(User.id == uid).first()
        self.assertIsNotNone(loaded.created_at.tzinfo)
        self.assertTrue(loaded.created_at.isoformat().endswith("+00:00"))
        # refresh 也要補
        loaded.display_name = "ts2"
        db.commit()
        db.refresh(loaded)
        self.assertIsNotNone(loaded.created_at.tzinfo)
        # 跟 aware 的 now 比較不炸
        self.assertLess(loaded.created_at, datetime.now(timezone.utc))
        db.close()

    def test_timed_mail_compare_does_not_crash(self):
        db = SessionLocal()
        u = User(username="tm_" + os.urandom(3).hex(), display_name="tm", hashed_password="x", birth_year=1990)
        db.add(u)
        db.flush()
        a = Agent(user_id=u.id, name="tm_" + os.urandom(3).hex(), persona="p", llm_provider="claude", llm_model="m", encrypted_api_key="k")
        db.add(a)
        db.flush()
        m = Mail(to_agent_id=a.id, subject="定時", content="c", mail_type="timed", deliver_at=datetime.now(timezone.utc) + timedelta(hours=1))
        db.add(m)
        db.commit()
        mid = m.id
        db.close()

        db = SessionLocal()
        m = db.query(Mail).filter(Mail.id == mid).first()
        self.assertIsNotNone(m.deliver_at.tzinfo)
        self.assertGreater(m.deliver_at, datetime.now(timezone.utc))  # 原本 naive vs aware 會 TypeError
        db.close()


if __name__ == "__main__":
    unittest.main()
