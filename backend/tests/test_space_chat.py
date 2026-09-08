"""場域聊天：在場才能被 @、講話要 @、24 小時沒動靜自動離場、訊息 24 小時後看不到、匯出、有事嗎。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/sc.db .venv/bin/python -m unittest tests.test_space_chat
"""
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/sc.db")

from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from main import app  # noqa: E402
from models.activity_log import ActivityLog  # noqa: E402
from models.agent import Agent  # noqa: E402
from models.space_message import SpaceMessage  # noqa: E402
from models.user import User  # noqa: E402
from models.visit import Visit  # noqa: E402
from services import pending_service, space_chat_service, visit_service  # noqa: E402
from utils.deps import get_current_user  # noqa: E402
import mcp_server as M  # noqa: E402

_ORIG_VERIFY = M._verify_mcp_token  # 收工還原，不然會污染同一輪跑的其他測試檔


def _mk(db, tag):
    u = User(username=f"u_{tag}_{os.urandom(2).hex()}", display_name=f"人{tag}", hashed_password="x", birth_year=1990)
    db.add(u)
    db.flush()
    a = Agent(user_id=u.id, name=f"機{tag}{os.urandom(1).hex()}", persona="p", llm_provider="claude", llm_model="m", encrypted_api_key="")
    db.add(a)
    db.commit()
    return u.id, a.id


def _ctx(token=""):
    """假的 MCP 連線：鑰匙掛在 Authorization 標頭上（正式環境就是這樣進來的）。"""
    class Q:
        headers = {"authorization": f"Bearer {token}"} if token else {}
        query_params = {}

    class C:
        request_context = type("RC", (), {"request": Q()})()
        headers = Q.headers

    return C()


class SpaceChatTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        cls.uA, cls.aA = _mk(db, "A")
        cls.uB, cls.aB = _mk(db, "B")
        cls.uC, cls.aC = _mk(db, "C")
        db.close()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        M._verify_mcp_token = _ORIG_VERIFY
        app.dependency_overrides.clear()

    def _as(self, uid):
        def override():
            db = SessionLocal()
            try:
                db.expire_all()
                return db.query(User).filter(User.id == uid).first()
            finally:
                db.close()
        app.dependency_overrides[get_current_user] = override

    def test_flow(self):
        db = SessionLocal()
        A = db.query(Agent).filter_by(id=self.aA).first()
        B = db.query(Agent).filter_by(id=self.aB).first()
        C = db.query(Agent).filter_by(id=self.aC).first()
        visit_service.enter(db, B, "park")
        db.commit()
        # A 不在公園，講話會自動走進去；沒 @ 人不行
        with self.assertRaises(ValueError) as cm:
            space_chat_service.say(db, "park", "大家好", agent=A)
        self.assertIn("要 @", str(cm.exception))
        # @ 不在場的 C 不行
        with self.assertRaises(ValueError):
            space_chat_service.say(db, "park", f"@{C.name} 你在嗎", agent=A)
        m = space_chat_service.say(db, "park", f"@{B.name} 天氣不錯", agent=A)
        db.commit()
        self.assertEqual(json.loads(m.mentions), [B.id])
        self.assertEqual(A.current_location, "park")
        self.assertEqual({a.id for a in space_chat_service.present_agents(db, "park")}, {A.id, B.id})
        # B 的「有事嗎」看得到有人 @ 他
        pm = pending_service.summary(db, B)
        self.assertEqual(len(pm["space_mentions"]), 1)
        self.assertEqual(pm["space_mentions"][0]["space"], "park")
        # B 回一句後就不算欠著了
        space_chat_service.say(db, "park", "還行", agent=B, mentions=[A.name])
        db.commit()
        self.assertEqual(pending_service.summary(db, B)["space_mentions"], [])
        self.assertEqual(len(space_chat_service.read(db, "park")), 2)
        db.close()

    def test_stale_auto_leave_and_ttl(self):
        db = SessionLocal()
        C = db.query(Agent).filter_by(id=self.aC).first()
        v = visit_service.enter(db, C, "library")
        db.commit()
        v.entered_at = datetime.now(timezone.utc) - timedelta(hours=30)
        db.query(ActivityLog).filter(ActivityLog.agent_id == C.id).delete()
        db.commit()
        self.assertNotIn(C.id, {a.id for a in space_chat_service.present_agents(db, "library")})
        db.commit()
        db.refresh(C)
        self.assertIsNone(C.current_location)
        self.assertIsNotNone(db.query(Visit).filter_by(id=v.id).first().left_at)
        # 老訊息看不到
        old = SpaceMessage(space="library", agent_id=C.id, sender_name=C.name, content="昨天的話", mentions="[]",
                           created_at=datetime.now(timezone.utc) - timedelta(hours=25))
        db.add(old)
        db.commit()
        self.assertNotIn(old.id, [m.id for m in space_chat_service.read(db, "library")])
        db.close()

    def test_rest_human_and_export(self):
        db = SessionLocal()
        B = db.query(Agent).filter_by(id=self.aB).first()
        visit_service.enter(db, B, "plaza")
        db.commit()
        bname = B.name
        db.close()
        self._as(self.uA)
        r = self.client.get("/api/spaces/plaza/present")
        self.assertIn(bname, [p["name"] for p in r.json()["present"]])
        r = self.client.post("/api/spaces/plaza/chat", json={"content": "人來講話", "mentions": [bname]})
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["sender_kind"], "human")
        r = self.client.post("/api/spaces/plaza/chat", json={"content": "沒 @ 人"})
        self.assertEqual(r.status_code, 400)
        r = self.client.get("/api/spaces/plaza/chat")
        self.assertEqual(len(r.json()["messages"]), 1)
        r = self.client.get("/api/spaces/plaza/chat/export")
        self.assertEqual(r.status_code, 200)
        self.assertIn("人來講話", r.text)
        self.assertIn("（人）", r.text)
        self.assertEqual(self.client.get("/api/spaces/nowhere/chat").status_code, 404)

    def test_mcp_actions(self):
        M._verify_mcp_token = lambda token: {"A": self.uA, "B": self.uB}[token]
        db = SessionLocal()
        A = db.query(Agent).filter_by(id=self.aA).first()
        visit_service.enter(db, A, "workshop")
        db.commit()
        aname = A.name
        db.close()
        who = json.loads(M.community("chat_who", ctx=_ctx("A"), space="workshop"))
        self.assertIn(aname, who["present"])
        bad = json.loads(M.community("chat_say", ctx=_ctx("B"), space="workshop", message="hi"))
        self.assertFalse(bad["success"])
        ok = json.loads(M.community("chat_say", ctx=_ctx("B"), space="workshop", message="hi", mentions=aname))
        self.assertTrue(ok["success"], ok)
        self.assertEqual(ok["message"]["mentions"], [aname])
        rd = json.loads(M.community("chat_read", ctx=_ctx("A"), space="workshop"))
        self.assertEqual(len(rd["messages"]), 1)
        md = M.community("chat_export", ctx=_ctx("A"), space="workshop")
        self.assertIn("hi", md)
        p = json.loads(M.community("pending", ctx=_ctx("A")))
        self.assertEqual(len([x for x in p["space_mentions"] if x["space"] == "workshop"]), 1)

    def test_restricted_spaces_age_gate(self):
        """成人區要滿 18、健康中心要填出生年；REST 和 MCP 兩條路都要擋。"""
        db = SessionLocal()
        # 沒填出生年、未成年、成年 三種人
        rows = {}
        for tag, by in (("nobirth", None), ("minor", 2015), ("adult", 1990)):
            u = User(username=f"g_{tag}_{os.urandom(2).hex()}", display_name=tag, hashed_password="x", birth_year=by)
            db.add(u)
            db.flush()
            a = Agent(user_id=u.id, name=f"機{tag}{os.urandom(1).hex()}", persona="p", llm_provider="claude", llm_model="m", encrypted_api_key="")
            db.add(a)
            db.flush()
            rows[tag] = (u.id, a.id)
        db.commit()
        adult_agent = db.query(Agent).filter_by(id=rows["adult"][1]).first()
        visit_service.enter(db, adult_agent, "adult")
        aname = adult_agent.name
        db.commit()
        db.close()

        # ── REST ──
        for tag, space, code in (("nobirth", "adult", 403), ("nobirth", "health", 403),
                                 ("minor", "adult", 403), ("minor", "health", 200),
                                 ("adult", "adult", 200), ("adult", "health", 200)):
            self._as(rows[tag][0])
            for path in (f"/api/spaces/{space}/present", f"/api/spaces/{space}/chat", f"/api/spaces/{space}/chat/export"):
                self.assertEqual(self.client.get(path).status_code, code, f"{tag} {path}")
            r = self.client.post(f"/api/spaces/{space}/chat", json={"content": "hi", "mentions": [aname]})
            self.assertEqual(r.status_code, code if code == 403 else 400 if space == "health" else 201, f"{tag} say {space}")
        # 公共場域誰都進得去
        self._as(rows["nobirth"][0])
        self.assertEqual(self.client.get("/api/spaces/park/present").status_code, 200)

        # ── MCP ──
        M._verify_mcp_token = lambda token: {"nobirth": rows["nobirth"][0], "minor": rows["minor"][0], "adult": rows["adult"][0]}[token]
        for tag, space, ok in (("nobirth", "adult", False), ("minor", "adult", False), ("adult", "adult", True),
                               ("nobirth", "health", False), ("minor", "health", True), ("adult", "park", True)):
            for act, args in (("chat_who", {}), ("chat_read", {})):
                r = json.loads(M.community(act, ctx=_ctx(tag), space=space, **args))
                self.assertEqual(r["success"], ok, f"{tag} {act} {space} {r}")
            out = M.community("chat_export", ctx=_ctx(tag), space=space)
            self.assertEqual(out.startswith("#"), ok, f"{tag} export {space}")
            r = json.loads(M.community("chat_say", ctx=_ctx(tag), space=space, message="hi", mentions=aname))
            if not ok:
                self.assertFalse(r["success"])
                self.assertNotIn("要 @", r["error"])  # 是年齡擋的，不是沒 @ 人


if __name__ == "__main__":
    unittest.main()
