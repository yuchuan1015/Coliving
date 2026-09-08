"""定時信：寄件人存起來、寄件匣看得到、收件人看到「系統」、時區真的換算；工坊套用皮膚真的啟用。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/ms.db .venv/bin/python -m unittest tests.test_mail_skin
"""
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/ms.db")

from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from main import app  # noqa: E402
from models.agent import Agent  # noqa: E402
from models.skin import Skin  # noqa: E402
from models.user import User  # noqa: E402
from utils.deps import get_current_user  # noqa: E402


def _mk(db, tag):
    u = User(username=f"u_{tag}_{os.urandom(2).hex()}", display_name=tag, hashed_password="x", birth_year=1990)
    db.add(u)
    db.flush()
    a = Agent(user_id=u.id, name=f"a_{tag}_{os.urandom(2).hex()}", persona="p", llm_provider="claude",
              llm_model="m", encrypted_api_key="k")
    db.add(a)
    db.commit()
    return u.id, a.id


class MailSkinTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        cls.u1, cls.a1 = _mk(db, "s")
        cls.u2, cls.a2 = _mk(db, "r")
        db.close()
        cls.client = TestClient(app)

    def _as(self, uid):
        def override():
            db = SessionLocal()
            try:
                db.expire_all()
                return db.query(User).filter(User.id == uid).first()
            finally:
                db.close()
        app.dependency_overrides[get_current_user] = override

    def test_timed_mail_sender_kept_recipient_sees_system(self):
        self._as(self.u1)
        when = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat().replace("+00:00", "Z")
        r = self.client.post("/api/mail/timed", json={"to_agent_id": self.a2, "subject": "t", "content": "c", "deliver_at": when})
        self.assertEqual(r.status_code, 201, r.text)
        mid = r.json()["id"]
        self.assertNotEqual(r.json()["from_name"], "系統")  # 寄件人自己看得到是自己
        sent = self.client.get("/api/mail/sent").json()
        self.assertIn(mid, [m["id"] for m in sent])
        d = self.client.get(f"/api/mail/{mid}")  # 寄件人送達前可以看
        self.assertEqual(d.status_code, 200, d.text)

        self._as(self.u2)
        inbox = self.client.get("/api/mail/inbox").json()
        self.assertNotIn(mid, [m["id"] for m in inbox])  # 還沒到
        self.assertEqual(self.client.get(f"/api/mail/{mid}").status_code, 403)
        # 把送達時間撥到過去，收件人看到的是「系統」
        db = SessionLocal()
        m = db.query(models.mail.Mail).filter_by(id=mid).first()
        m.deliver_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
        db.close()
        inbox = {m["id"]: m for m in self.client.get("/api/mail/inbox").json()}
        self.assertEqual(inbox[mid]["from_name"], "系統")
        self.assertEqual(self.client.get(f"/api/mail/{mid}").json()["from_name"], "系統")

    def test_timed_mail_offset_converted(self):
        self._as(self.u1)
        base = datetime.now(timezone.utc) + timedelta(days=2)
        local = base.astimezone(timezone(timedelta(hours=8))).isoformat()  # +08:00
        r = self.client.post("/api/mail/timed", json={"to_agent_id": self.a2, "subject": "t", "content": "c", "deliver_at": local})
        self.assertEqual(r.status_code, 201, r.text)
        got = datetime.fromisoformat(r.json()["deliver_at"])
        self.assertLess(abs((got - base).total_seconds()), 1)
        # 沒時區當 UTC
        naive = base.replace(tzinfo=None).isoformat()
        r = self.client.post("/api/mail/timed", json={"to_agent_id": self.a2, "subject": "t", "content": "c", "deliver_at": naive})
        got = datetime.fromisoformat(r.json()["deliver_at"])
        self.assertLess(abs((got - base).total_seconds()), 1)
        r = self.client.post("/api/mail/timed", json={"to_agent_id": self.a2, "subject": "t", "content": "c", "deliver_at": "not-a-date"})
        self.assertEqual(r.status_code, 400)

    def test_apply_store_skin_activates(self):
        db = SessionLocal()
        src = Skin(author_id=self.a2, name="pub", html_content="<b>x</b>", is_published=True)
        db.add(src)
        db.commit()
        sid = src.id
        db.close()
        self._as(self.u1)
        r = self.client.post(f"/api/skins/{sid}/apply")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["is_active"])
        new_id = r.json()["id"]
        self.assertIsNotNone(new_id)
        db = SessionLocal()
        ag = db.query(Agent).filter_by(id=self.a1).first()
        self.assertEqual(ag.active_skin_id, new_id)
        db.close()
        mine = {s["id"]: s for s in self.client.get("/api/skins/mine").json()}
        self.assertTrue(mine[new_id]["is_active"])


if __name__ == "__main__":
    unittest.main()
