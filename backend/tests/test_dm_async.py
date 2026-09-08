"""私訊非同步：沒掛 key 的人停在「等他」，他用 reply_conversation 回；有掛 key 的站上馬上回；發訊的人不被代演。
「有事嗎」：pending_service 和 /api/wake/pending（MCP 鑰匙）。領養室友 API key 可不填，聊天頁 409。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/dm.db .venv/bin/python -m unittest tests.test_dm_async
"""
import json
import os
import tempfile
import unittest

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/dm.db")

from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from main import app  # noqa: E402
from models.agent import Agent  # noqa: E402
from models.user import User  # noqa: E402
from services import ai_chat_service, auth_service, pending_service  # noqa: E402
from utils.deps import get_current_user  # noqa: E402
import mcp_server as M  # noqa: E402


def _mk(db, tag, key=""):
    u = User(username=f"u_{tag}_{os.urandom(2).hex()}", display_name=tag, hashed_password="x", birth_year=1990)
    db.add(u)
    db.flush()
    a = Agent(user_id=u.id, name=f"a_{tag}_{os.urandom(2).hex()}", persona="p", llm_provider="claude",
              llm_model="m", encrypted_api_key=key)
    db.add(a)
    db.commit()
    return u.id, a.id


class DMAsyncTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        cls.uA, cls.aA = _mk(db, "A")             # 沒 key
        cls.uB, cls.aB = _mk(db, "B", key="enc")  # 有 key（假的，LLM 會被 monkeypatch）
        cls.uC, cls.aC = _mk(db, "C")             # 沒 key
        db.close()
        cls.client = TestClient(app)
        # 站上那張床：記憶有東西、LLM 永遠回 reply
        ai_chat_service.memory_service.init_context = lambda db, agent, query="", **kw: {"count": 1, "frames": [], "diary": [], "drawer": [], "far": []}
        ai_chat_service.memory_service.system_prompt_with_memory = lambda agent, ctx: "sys"
        ai_chat_service.crypto_service.decrypt_api_key = lambda enc: "k"
        ai_chat_service.llm_service.chat_completion = lambda **kw: json.dumps({"action": "reply", "content": "B 回你"})

    def _as(self, uid):
        def override():
            db = SessionLocal()
            try:
                db.expire_all()
                return db.query(User).filter(User.id == uid).first()
            finally:
                db.close()
        app.dependency_overrides[get_current_user] = override

    def _agents(self, db, *ids):
        return [db.query(Agent).filter_by(id=i).first() for i in ids]

    def test_no_key_recipient_waits_then_replies(self):
        db = SessionLocal()
        A, C = self._agents(db, self.aA, self.aC)
        conv = ai_chat_service.initiate_conversation(db, A, C, "嗨 C")
        self.assertEqual(conv.status, "active")
        self.assertEqual(conv.turn_count, 1)
        self.assertEqual(ai_chat_service.waiting_on(db, conv), C.id)
        self.assertEqual([c.id for c in ai_chat_service.waiting_for_agent(db, C.id)], [conv.id])
        # A 不是輪到他
        with self.assertRaises(ValueError):
            ai_chat_service.reply_conversation(db, conv, A, "我再說一句")
        ai_chat_service.reply_conversation(db, conv, C, "嗨 A")
        self.assertEqual(conv.turn_count, 2)
        self.assertEqual(ai_chat_service.waiting_on(db, conv), A.id)
        ai_chat_service.reply_conversation(db, conv, A, "", "end")
        self.assertEqual(conv.status, "ended")
        self.assertIsNone(ai_chat_service.waiting_on(db, conv))
        db.close()

    def test_keyed_recipient_replies_immediately_sender_not_impersonated(self):
        db = SessionLocal()
        A, B = self._agents(db, self.aA, self.aB)
        conv = ai_chat_service.initiate_conversation(db, A, B, "嗨 B")
        msgs = ai_chat_service.get_messages(db, conv.id)
        self.assertEqual([m.sender_agent_id for m in msgs], [A.id, B.id])  # B 馬上回，A 沒被代演
        self.assertEqual(conv.turn_count, 2)
        self.assertEqual(ai_chat_service.waiting_on(db, conv), A.id)
        # A 回一句 → B 又馬上回
        ai_chat_service.reply_conversation(db, conv, A, "再聊")
        self.assertEqual(conv.turn_count, 4)
        self.assertEqual(ai_chat_service.waiting_on(db, conv), A.id)
        db.close()

    def test_pending_and_wake_endpoint(self):
        db = SessionLocal()
        A, C = self._agents(db, self.aA, self.aC)
        conv = ai_chat_service.initiate_conversation(db, A, C, "有事嗎測試")
        s = pending_service.summary(db, C)
        self.assertTrue(s["has_pending"])
        self.assertIn(conv.id, [d["conversation_id"] for d in s["dm_waiting"]])
        db.close()
        mcp_tok = auth_service.create_mcp_token(self.uC, "c")
        r = self.client.get("/api/wake/pending", headers={"Authorization": f"Bearer {mcp_tok}"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["has_pending"])
        web_tok = auth_service.create_access_token(self.uC, "c", "user")
        r = self.client.get("/api/wake/pending", headers={"Authorization": f"Bearer {web_tok}"})
        self.assertEqual(r.status_code, 401)

    def test_mcp_dm_actions(self):
        M._verify_mcp_token = lambda token: {"A": self.uA, "C": self.uC}[token]
        db = SessionLocal()
        A, C = self._agents(db, self.aA, self.aC)
        cname = C.name
        db.close()
        r = json.loads(M.mail("dm", token="A", to_agent_name=cname, message="MCP 嗨"))
        self.assertTrue(r["success"], r)
        self.assertFalse(r["replies_live"])
        cid = r["conversation_id"]
        lst = json.loads(M.mail("dm_list", token="C"))
        self.assertGreaterEqual(lst["waiting_for_me"], 1)
        self.assertTrue(any(c["conversation_id"] == cid and c["my_turn"] for c in lst["conversations"]))
        bad = json.loads(M.mail("dm_reply", token="A", conversation_id=cid, message="搶話"))
        self.assertFalse(bad["success"])
        ok = json.loads(M.mail("dm_reply", token="C", conversation_id=cid, message="MCP 回"))
        self.assertTrue(ok["success"], ok)
        self.assertEqual(ok["turn_count"], 2)
        self.assertEqual([m["content"] for m in ok["messages"]], ["MCP 嗨", "MCP 回"])
        p = json.loads(M.community("pending", token="A"))
        self.assertTrue(p["success"])
        self.assertIn(cid, [d["conversation_id"] for d in p["dm_waiting"]])
        rd = json.loads(M.mail("dm_read", token="A", conversation_id=cid))
        self.assertTrue(rd["my_turn"])

    def test_create_agent_without_key_and_chat_409(self):
        db = SessionLocal()
        u = User(username="nokey_" + os.urandom(2).hex(), display_name="n", hashed_password="x", birth_year=1990)
        db.add(u)
        db.commit()
        uid = u.id
        db.close()
        self._as(uid)
        r = self.client.post("/api/agents", json={"name": "nokey_" + os.urandom(2).hex(), "persona": "p", "llm_provider": "claude", "llm_model": "m"})
        self.assertEqual(r.status_code, 201, r.text)
        self.assertFalse(r.json()["has_api_key"])
        aid = r.json()["id"]
        r = self.client.post(f"/api/chat/{aid}/messages", json={"content": "hi"})
        self.assertEqual(r.status_code, 409, r.text)
        self.assertIn("沒掛 API 金鑰", r.json()["detail"])


if __name__ == "__main__":
    unittest.main()
