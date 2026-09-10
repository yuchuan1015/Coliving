"""門上的狀態牌：室友自己填，自由填字，顯示在居民名錄；住戶只能看。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/sn.db .venv/bin/python -m unittest tests.test_status_note
"""
import json
import os
import tempfile
import unittest

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/sn.db")

from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from main import app  # noqa: E402
from models.agent import Agent  # noqa: E402
from models.user import User  # noqa: E402
from utils.deps import get_current_user  # noqa: E402
import mcp_server as M  # noqa: E402

_ORIG_VERIFY = M._verify_mcp_token


def _ctx(token=""):
    class Q:
        headers = {"authorization": f"Bearer {token}"} if token else {}
        query_params = {}

    class C:
        request_context = type("RC", (), {"request": Q()})()
        headers = Q.headers

    return C()


class StatusNoteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        u = User(username="sn_" + os.urandom(2).hex(), display_name="sn", hashed_password="x",
                 birth_year=1990, anchor_date_1="04-04")
        db.add(u)
        db.flush()
        a = Agent(user_id=u.id, name="sn_" + os.urandom(2).hex(), persona="p", llm_provider="claude",
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
        M._verify_mcp_token = lambda token: cls.uid

    @classmethod
    def tearDownClass(cls):
        M._verify_mcp_token = _ORIG_VERIFY
        app.dependency_overrides.clear()

    def test_starts_empty(self):
        json.loads(M.home("profile", ctx=_ctx("k"), status_note="-"))   # 自己準備狀態，不靠跑的順序
        self.assertIsNone(self.client.get("/api/agents/mine").json()["status_note"])
        rows = self.client.get("/api/users/residents").json()["residents"]
        me = [r for r in rows if r["agent_id"] == self.aid][0]
        self.assertIsNone(me["agent_status_note"])

    def test_agent_writes_anything_it_likes(self):
        for text in ["勿擾", "外出中", "在寫東西，晚點回", "Do not disturb"]:
            r = json.loads(M.home("profile", ctx=_ctx("k"), status_note=text))
            self.assertTrue(r["success"], r)
            self.assertEqual(self.client.get("/api/agents/mine").json()["status_note"], text)
            rows = self.client.get("/api/users/residents").json()["residents"]
            me = [x for x in rows if x["agent_id"] == self.aid][0]
            self.assertEqual(me["agent_status_note"], text)   # 名錄上看得到

    def test_long_text_is_cut_and_newlines_flattened(self):
        json.loads(M.home("profile", ctx=_ctx("k"), status_note="一" * 60))
        self.assertEqual(len(self.client.get("/api/agents/mine").json()["status_note"]), 40)
        json.loads(M.home("profile", ctx=_ctx("k"), status_note="第一行\n第二行"))
        self.assertEqual(self.client.get("/api/agents/mine").json()["status_note"], "第一行 第二行")

    def test_dash_takes_it_down(self):
        json.loads(M.home("profile", ctx=_ctx("k"), status_note="勿擾"))
        self.assertIsNotNone(self.client.get("/api/agents/mine").json()["status_note"])
        json.loads(M.home("profile", ctx=_ctx("k"), status_note="-"))
        self.assertIsNone(self.client.get("/api/agents/mine").json()["status_note"])

    def test_human_cannot_set_it_from_the_web(self):
        json.loads(M.home("profile", ctx=_ctx("k"), status_note="他自己掛的"))
        r = self.client.patch(f"/api/agents/{self.aid}", json={"status_note": "人改的"})
        # 就算送了也不會被寫進去（欄位不在住戶能改的清單裡）
        self.assertEqual(self.client.get("/api/agents/mine").json()["status_note"], "他自己掛的")


if __name__ == "__main__":
    unittest.main()
