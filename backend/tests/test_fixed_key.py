"""固定鑰匙：領養配第一把、清單隨時看得到同一把、連線帶鑰匙時 tool 不用填 token。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/fk.db .venv/bin/python -m unittest tests.test_fixed_key
"""
import json
import os
import tempfile
import unittest

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/fk.db")

from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from main import app  # noqa: E402
from models.user import User  # noqa: E402
from utils.deps import get_current_user  # noqa: E402
import mcp_server as M  # noqa: E402


class _Req:
    def __init__(self, headers=None, query=None):
        self.headers = headers or {}
        self.query_params = query or {}


class _RC:
    def __init__(self, req):
        self.request = req


class _Ctx:
    def __init__(self, headers=None, query=None):
        self.request_context = _RC(_Req(headers, query))
        self.headers = headers


class FixedKeyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        u = User(username="fk_" + os.urandom(2).hex(), display_name="fk", hashed_password="x", birth_year=1990)
        db.add(u)
        db.commit()
        cls.uid = u.id
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

    def test_adopt_issues_first_key_and_list_shows_same_key(self):
        r = self.client.post("/api/agents", json={"name": "fk_" + os.urandom(2).hex(), "persona": "p", "llm_provider": "claude", "llm_model": "m"})
        self.assertEqual(r.status_code, 201, r.text)
        fk = r.json()["first_key"]
        self.assertEqual(fk["label"], "第一把")
        self.assertTrue(fk["connect_url"].startswith("https://therookery.space/mcp?token="))
        self.assertIn("claude mcp add", fk["claude_code_cmd"])
        tok = fk["mcp_token"]
        lst = self.client.get("/api/agents/mine/mcp-tokens").json()
        self.assertEqual(len(lst), 1)
        self.assertEqual(lst[0]["mcp_token"], tok)  # 同一把，重新算出來一模一樣
        # 這把鑰匙真的能用（有 jti、在表裡）
        self.assertEqual(M._verify_mcp_token(tok), self.uid)
        # 作廢後清單不再給鑰匙、驗也過不了
        self.client.delete(f"/api/agents/mine/mcp-tokens/{fk['token_id']}")
        lst = self.client.get("/api/agents/mine/mcp-tokens").json()
        self.assertNotIn("mcp_token", lst[0])
        self.assertIsNone(M._verify_mcp_token(tok))
        # 再產一把，清單兩筆
        r = self.client.post("/api/agents/mine/mcp-token", json={"label": "CC 主窗"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn("connect_url", r.json())
        self.__class__.token = r.json()["mcp_token"]

    def test_token_from_connection(self):
        tok = getattr(self.__class__, "token", None)
        if not tok:
            r = self.client.post("/api/agents/mine/mcp-token", json={"label": "x"})
            tok = r.json()["mcp_token"]
        self.assertEqual(M._token_from_ctx(_Ctx(headers={"authorization": f"Bearer {tok}"})), tok)
        self.assertEqual(M._token_from_ctx(_Ctx(headers={}, query={"token": tok})), tok)
        self.assertEqual(M._token_from_ctx(_Ctx(headers={"x-mcp-token": tok})), tok)
        self.assertEqual(M._token_from_ctx(_Ctx()), "")
        # 沒填 token、連線帶鑰匙 → 通
        r = json.loads(M.community("pending", ctx=_Ctx(query={"token": tok})))
        self.assertTrue(r["success"], r)
        # 沒填也沒帶 → 無效
        r = json.loads(M.community("pending", ctx=_Ctx()))
        self.assertFalse(r["success"])
        # 有填就用填的
        r = json.loads(M.mail("dm_code", ctx=_Ctx(headers={"authorization": f"Bearer {tok}"})))
        self.assertTrue(r["success"], r)


if __name__ == "__main__":
    unittest.main()
