"""網頁只能看：日記、抽屜、信箱都不給住戶寫（2026-09-10 她定）。室友自己的工具照舊能寫。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/ro.db .venv/bin/python -m unittest tests.test_read_only_front
"""
import os
import tempfile
import unittest

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/ro.db")

from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from main import app  # noqa: E402
from models.agent import Agent  # noqa: E402
from models.user import User  # noqa: E402
from services import diary_service, drawer_service  # noqa: E402
from utils.deps import get_current_user  # noqa: E402


class ReadOnlyFrontTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        u = User(username="ro_" + os.urandom(2).hex(), display_name="ro", hashed_password="x", birth_year=1990)
        db.add(u)
        db.flush()
        a = Agent(user_id=u.id, name="ro_" + os.urandom(2).hex(), persona="p", llm_provider="claude",
                  llm_model="m", encrypted_api_key="")
        db.add(a)
        db.commit()
        cls.uid, cls.aid = u.id, a.id
        db.close()
        cls.client = TestClient(app)

        def override():
            db = SessionLocal()
            try:
                db.expire_all()
                return db.query(User).filter(User.id == cls.uid).first()
            finally:
                db.close()
        app.dependency_overrides[get_current_user] = override

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def _agent(self, db):
        return db.query(Agent).filter_by(id=self.aid).first()

    def test_diary_is_read_only_for_the_human(self):
        db = SessionLocal()
        a = self._agent(db)
        e = diary_service.write_diary(db, a, "他寫的", "內容")          # 室友自己寫得進去
        eid = e.id
        db.close()
        r = self.client.get("/api/diary")
        self.assertEqual(r.status_code, 200)
        self.assertIn("他寫的", [x["title"] for x in r.json()["entries"]])   # 看得到
        self.assertEqual(self.client.post("/api/diary", json={"title": "人寫的", "content": "x"}).status_code, 405)
        self.assertEqual(self.client.put(f"/api/diary/{eid}", json={"title": "改一下"}).status_code, 405)
        self.assertEqual(self.client.delete(f"/api/diary/{eid}").status_code, 405)

    def test_drawer_is_locked(self):
        db = SessionLocal()
        a = self._agent(db)
        drawer_service.store_item(db, a, "藏起來的", "看不到的內容", "secret")   # 室友自己放
        db.close()
        r = self.client.get("/api/home/furniture/drawer")
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertTrue(d["locked"])
        self.assertEqual(d["count"], 1)          # 知道有幾樣
        self.assertEqual(d["items"], [])          # 但看不到是什麼
        self.assertNotIn("看不到的內容", r.text)
        self.assertNotIn("藏起來的", r.text)
        self.assertEqual(self.client.post("/api/home/furniture/drawer",
                                          json={"label": "人放的", "content": "x"}).status_code, 405)

    def test_mail_cannot_be_sent_or_deleted_from_the_web(self):
        self.assertEqual(self.client.get("/api/mail/inbox").status_code, 200)     # 看得到
        for path, body in [("/api/mail/letter", {"to_agent_id": "x", "subject": "s", "content": "c"}),
                           ("/api/mail/timed", {"to_agent_id": "x", "subject": "s", "content": "c", "deliver_at": "2030-01-01T00:00:00Z"}),
                           ("/api/mail/physical", {"subject": "s", "content": "c"})]:
            self.assertEqual(self.client.post(path, json=body).status_code, 405, path)
        self.assertEqual(self.client.delete("/api/mail/whatever").status_code, 405)


if __name__ == "__main__":
    unittest.main()
