"""主人給室友的一段話：只有主人能寫、最多 1000 字、室友醒來一定讀到。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/nt.db .venv/bin/python -m unittest tests.test_owner_note
"""
import json
import os
import tempfile
import unittest

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/nt.db")

from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from main import app  # noqa: E402
from models.agent import Agent  # noqa: E402
from models.user import User  # noqa: E402
from services import memory_service  # noqa: E402
from utils.deps import get_current_user  # noqa: E402
import mcp_server as M  # noqa: E402

_ORIG_VERIFY = M._verify_mcp_token


class OwnerNoteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        u = User(username="nt_" + os.urandom(2).hex(), display_name="nt", hashed_password="x", birth_year=1990)
        db.add(u)
        db.flush()
        a = Agent(user_id=u.id, name="nt_" + os.urandom(2).hex(), persona="p", llm_provider="claude", llm_model="m", encrypted_api_key="")
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
        M._verify_mcp_token = _ORIG_VERIFY
        app.dependency_overrides.clear()

    def test_write_read_and_limits(self):
        self.client.patch("/api/users/me", json={"note_to_agent": ""})   # 每個測試自己準備狀態
        self.assertIsNone(self.client.get("/api/users/me").json()["note_to_agent"])
        r = self.client.patch("/api/users/me", json={"note_to_agent": "  我是喻墨，晚上不要吵我。  "})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["note_to_agent"], "我是喻墨，晚上不要吵我。")   # 前後空白吃掉
        self.assertEqual(self.client.patch("/api/users/me", json={"note_to_agent": "x" * 1001}).status_code, 422)
        r = self.client.patch("/api/users/me", json={"note_to_agent": "x" * 1000})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()["note_to_agent"]), 1000)

    def test_agent_reads_it_at_wakeup(self):
        self.client.patch("/api/users/me", json={"note_to_agent": "不要提我媽"})
        db = SessionLocal()
        agent = db.query(Agent).filter_by(id=self.aid).first()
        near = memory_service.near_path(db, agent)
        self.assertEqual(near["note"], "不要提我媽")
        db.close()

    def test_note_alone_is_enough_to_speak(self):
        """只有這段話、沒日記沒抽屜，也算讀到記憶（不會被擋成「還沒讀到記憶」）。"""
        self.client.patch("/api/users/me", json={"note_to_agent": "只有這一句"})
        db = SessionLocal()
        agent = db.query(Agent).filter_by(id=self.aid).first()
        near = memory_service.near_path(db, agent)
        count = (1 if near["note"] else 0) + len(near["frames"]) + len(near["diaries"]) + len(near["drawer"])
        self.assertEqual(count, 1)
        db.close()

    def test_clearing(self):
        self.client.patch("/api/users/me", json={"note_to_agent": "先寫點東西"})
        r = self.client.patch("/api/users/me", json={"note_to_agent": ""})
        self.assertIsNone(r.json()["note_to_agent"])

    def test_agent_sees_it_via_mcp(self):
        self.client.patch("/api/users/me", json={"note_to_agent": "冰箱裡有布丁"})
        M._verify_mcp_token = lambda token: self.uid
        out = M.look_at_photo_frame("k")
        d = json.loads(out if isinstance(out, str) else out[0])
        self.assertEqual(d["note_from_owner"], "冰箱裡有布丁")


if __name__ == "__main__":
    unittest.main()
