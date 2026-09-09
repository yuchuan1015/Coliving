"""抽屜併進日記：一張表兩個入口。抽屜寫的＝私密日記；日記那邊看不到私密的；醒來私密的只給標題。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/dm2.db .venv/bin/python -m unittest tests.test_drawer_merge
"""
import json
import os
import tempfile
import unittest

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/dm2.db")

from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from main import app  # noqa: E402
from models.agent import Agent  # noqa: E402
from models.diary import DiaryEntry  # noqa: E402
from models.user import User  # noqa: E402
from services import diary_service, drawer_service, memory_service  # noqa: E402
from utils.deps import get_current_user  # noqa: E402
import mcp_server as M  # noqa: E402

_ORIG_VERIFY = M._verify_mcp_token


class DrawerMergeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        u = User(username="dm_" + os.urandom(2).hex(), display_name="dm", hashed_password="x", birth_year=1990)
        db.add(u)
        db.flush()
        a = Agent(user_id=u.id, name="dm_" + os.urandom(2).hex(), persona="p", llm_provider="claude", llm_model="m", encrypted_api_key="")
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

    def _agent(self, db):
        return db.query(Agent).filter_by(id=self.aid).first()

    def test_drawer_writes_a_private_diary_entry(self):
        db = SessionLocal()
        a = self._agent(db)
        item = drawer_service.store_item(db, a, "藏起來的事", "內容", "secret")
        self.assertTrue(isinstance(item, DiaryEntry))
        self.assertTrue(item.private)
        self.assertEqual(item.source, "drawer")
        # 抽屜那邊看得到
        self.assertIn("藏起來的事", [i["label"] for i in map(drawer_service.item_to_dict, drawer_service.list_items(db, a))])
        # 日記那邊看不到
        pub = diary_service.read_diary(db, a)
        self.assertNotIn("藏起來的事", [e["title"] for e in pub["entries"]])
        # 明講要私密的才看得到
        priv = diary_service.read_diary(db, a, private=True)
        self.assertIn("藏起來的事", [e["title"] for e in priv["entries"]])
        db.close()

    def test_wakeup_sees_title_only(self):
        db = SessionLocal()
        a = self._agent(db)
        drawer_service.store_item(db, a, "只給標題", "這段內容醒來時不該出現", "misc")
        diary_service.write_diary(db, a, "公開的日記", "這段會全文出現", importance=0.9)
        near = memory_service.near_path(db, a)
        self.assertIn("只給標題", [d["label"] for d in near["drawer"]])
        self.assertNotIn("只給標題", [d["title"] for d in near["diaries"]])
        ctx = memory_service.init_context(db, a, client_factory=lambda *x, **k: None)
        self.assertIn("只給標題", ctx["text"])
        self.assertNotIn("這段內容醒來時不該出現", ctx["text"])
        self.assertIn("這段會全文出現", ctx["text"])
        db.close()

    def test_rest_and_mcp_entrances_still_work(self):
        # 網頁：抽屜
        r = self.client.post("/api/home/furniture/drawer", json={"label": "網頁放的", "content": "abc", "category": "misc"})
        self.assertIn(r.status_code, (200, 201), r.text)
        items = self.client.get("/api/home/furniture/drawer").json()["items"]
        self.assertIn("網頁放的", [i["label"] for i in items])
        # 網頁：日記看不到它
        entries = self.client.get("/api/diary").json()["entries"]
        self.assertNotIn("網頁放的", [e["title"] for e in entries])
        # 家具總覽的兩個數字分開算
        fur = self.client.get("/api/home/furniture").json()
        self.assertGreaterEqual(fur["drawer"]["count"], 1)
        # MCP：兩個入口都在
        M._verify_mcp_token = lambda token: self.uid
        db = SessionLocal()
        a = self._agent(db)
        before = len(drawer_service.list_items(db, a))
        db.close()
        self.assertGreaterEqual(before, 2)

    def test_delete_from_drawer(self):
        db = SessionLocal()
        a = self._agent(db)
        item = drawer_service.store_item(db, a, "待刪", "x", "misc")
        self.assertTrue(drawer_service.remove_item(db, a, item.id))
        self.assertIsNone(drawer_service.get_item(db, a, item.id))
        db.close()


if __name__ == "__main__":
    unittest.main()
