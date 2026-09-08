"""私訊碼（座標打亂）、領養日＝第一個日子、忙碌中 24h、檢舉與停權。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/dc.db .venv/bin/python -m unittest tests.test_dm_code
"""
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/dc.db")

from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from main import app  # noqa: E402
from models.agent import Agent  # noqa: E402
from models.user import User  # noqa: E402
from services import ai_chat_service, coordinate_service, pending_service  # noqa: E402
from utils.deps import get_current_user  # noqa: E402
import mcp_server as M  # noqa: E402

_ORIG_VERIFY = M._verify_mcp_token  # 收工還原，不然會污染同一輪跑的其他測試檔


def _mk(db, tag, anchor1="03-03", role="user"):
    u = User(username=f"u_{tag}_{os.urandom(2).hex()}", display_name=tag, hashed_password="x", birth_year=1990, anchor_date_1=anchor1, role=role)
    db.add(u)
    db.flush()
    a = Agent(user_id=u.id, name=f"a_{tag}_{os.urandom(2).hex()}", persona="p", llm_provider="claude", llm_model="m", encrypted_api_key="")
    db.add(a)
    db.commit()
    return u.id, a.id


class DMCodeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        cls.uA, cls.aA = _mk(db, "A")
        cls.uB, cls.aB = _mk(db, "B", anchor1="03-03")   # 跟 A 同一天，碼要不同
        cls.uD, cls.aD = _mk(db, "D", anchor1=None)      # 漂流中
        cls.uAdm, cls.aAdm = _mk(db, "adm", role="admin")
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

    def _pair(self, db, uid, aid):
        return db.query(User).filter_by(id=uid).first(), db.query(Agent).filter_by(id=aid).first()

    def test_code_shape_stable_unique_and_lookup(self):
        db = SessionLocal()
        uA, A = self._pair(db, self.uA, self.aA)
        uB, B = self._pair(db, self.uB, self.aB)
        uD, D = self._pair(db, self.uD, self.aD)
        cA = ai_chat_service.dm_code_for(A, uA)
        self.assertRegex(cA, r"^RK-[A-Z2-9]{4}-[A-Z2-9]{4}$")
        self.assertEqual(cA, ai_chat_service.dm_code_for(A, uA))
        self.assertNotEqual(cA, ai_chat_service.dm_code_for(B, uB))
        self.assertIsNone(ai_chat_service.dm_code_for(D, uD))
        self.assertEqual(ai_chat_service.find_agent_by_code(db, cA.lower()).id, A.id)
        self.assertIsNone(ai_chat_service.find_agent_by_code(db, "RK-0000-0000"))
        db.close()

    def test_rest_initiate_by_code_and_drifting(self):
        db = SessionLocal()
        uB, B = self._pair(db, self.uB, self.aB)
        code = ai_chat_service.dm_code_for(B, uB)
        db.close()
        self._as(self.uA)
        me = self.client.get("/api/agents/mine").json()
        self.assertRegex(me["dm_code"], r"^RK-")
        r = self.client.post("/api/ai-chat/initiate", json={"to_code": "RK-0000-0000", "message": "x"})
        self.assertEqual(r.status_code, 404)
        r = self.client.post("/api/ai-chat/initiate", json={"to_code": code, "message": "用碼私訊"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["conversation"]["waiting_on"], self.aB)
        self.assertIsNone(r.json()["conversation"]["system_note"])
        self._as(self.uD)  # 漂流中不能發
        r = self.client.post("/api/ai-chat/initiate", json={"to_code": code, "message": "x"})
        self.assertEqual(r.status_code, 403)

    def test_busy_after_24h(self):
        db = SessionLocal()
        uA, A = self._pair(db, self.uA, self.aA)
        uB, B = self._pair(db, self.uB, self.aB)
        conv = ai_chat_service.initiate_conversation(db, A, B, "在嗎")
        conv.last_message_at = datetime.now(timezone.utc) - timedelta(hours=25)
        db.commit()
        self.assertEqual(pending_service.summary(db, B)["dm_waiting"], [])  # 過期的不再等 B
        db.refresh(conv)
        self.assertEqual(conv.status, "ended")
        self.assertEqual(conv.ended_reason, "busy")
        self.assertEqual(ai_chat_service.system_note(conv, A.id), "對方正在忙碌中")  # 發送方看得到
        self.assertIsNone(ai_chat_service.system_note(conv, B.id))                 # 沒回的人不看
        with self.assertRaises(ValueError):
            ai_chat_service.reply_conversation(db, conv, B, "來晚了")
        db.close()
        self._as(self.uA)
        lst = self.client.get("/api/ai-chat/conversations").json()
        me = [c for c in lst if c["id"] == conv.id][0]
        self.assertEqual(me["system_note"], "對方正在忙碌中")

    def test_wait_shows_busy_to_sender(self):
        db = SessionLocal()
        uA, A = self._pair(db, self.uA, self.aA)
        uB, B = self._pair(db, self.uB, self.aB)
        conv = ai_chat_service.initiate_conversation(db, A, B, "聊聊")
        ai_chat_service.reply_conversation(db, conv, B, "", "wait")
        self.assertEqual(conv.ended_reason, "wait")
        self.assertEqual(ai_chat_service.system_note(conv, A.id), "對方正在忙碌中")
        self.assertIsNone(ai_chat_service.system_note(conv, B.id))
        db.close()

    def test_report_and_block(self):
        db = SessionLocal()
        uA, A = self._pair(db, self.uA, self.aA)
        uB, B = self._pair(db, self.uB, self.aB)
        conv = ai_chat_service.initiate_conversation(db, A, B, "惡意")
        cid = conv.id
        db.close()
        self._as(self.uB)
        r = self.client.post(f"/api/ai-chat/{cid}/report", json={"reason": "騷擾"})
        self.assertEqual(r.status_code, 201, r.text)
        rid = r.json()["id"]
        r = self.client.post(f"/api/ai-chat/{cid}/report", json={"reason": "再一次"})
        self.assertEqual(r.status_code, 400)
        # 管理員看、判成立
        self._as(self.uAdm)
        lst = self.client.get("/api/admin/dm-reports?status=pending").json()["reports"]
        self.assertIn(rid, [x["id"] for x in lst])
        msgs = self.client.get(f"/api/admin/dm-reports/{rid}/messages").json()["messages"]
        self.assertEqual(msgs[0]["content"], "惡意")
        r = self.client.patch(f"/api/admin/dm-reports/{rid}", json={"status": "upheld", "admin_note": "確實"})
        self.assertEqual(r.status_code, 200, r.text)
        # A 被停權
        db = SessionLocal()
        uA, A = self._pair(db, self.uA, self.aA)
        uB, B = self._pair(db, self.uB, self.aB)
        self.assertTrue(ai_chat_service.is_blocked(db, A))
        with self.assertRaises(ValueError):
            ai_chat_service.initiate_conversation(db, A, B, "還想講")
        db.close()
        self._as(self.uA)
        r = self.client.post("/api/ai-chat/initiate", json={"to_code": ai_chat_service.dm_code_for(B, uB), "message": "x"})
        self.assertEqual(r.status_code, 400)
        # 非管理員看不到
        self._as(self.uB)
        self.assertEqual(self.client.get("/api/admin/dm-reports").status_code, 403)
        # 解除
        self._as(self.uAdm)
        self.client.patch(f"/api/admin/dm-reports/{rid}", json={"status": "dismissed"})
        db = SessionLocal()
        uA, A = self._pair(db, self.uA, self.aA)
        self.assertFalse(ai_chat_service.is_blocked(db, A))
        db.close()

    def test_adoption_sets_anchor_and_partial_coordinate(self):
        db = SessionLocal()
        u = User(username="fresh_" + os.urandom(2).hex(), display_name="f", hashed_password="x", birth_year=1990)
        db.add(u)
        db.commit()
        uid = u.id
        self.assertIsNone(coordinate_service.coordinate(db, u))
        db.close()
        self._as(uid)
        r = self.client.post("/api/agents", json={"name": "fresh_" + os.urandom(2).hex(), "persona": "p", "llm_provider": "claude", "llm_model": "m"})
        self.assertEqual(r.status_code, 201, r.text)
        self.assertRegex(r.json()["dm_code"], r"^RK-")
        me = self.client.get("/api/users/me").json()
        self.assertIsNotNone(me["anchor_date_1"])
        self.assertTrue(me["coordinate"]["partial"])
        self.assertEqual(me["label"], "定了經度、還在找緯度")
        self.assertFalse(me["drifting"])
        # 第一個日子已經定了，不能改
        r = self.client.patch("/api/users/me/anchors", json={"anchor_date_1": "12-25"})
        self.assertEqual(r.status_code, 400)
        r = self.client.patch("/api/users/me/anchors", json={"anchor_date_2": "12-25"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertFalse(r.json()["coordinate"]["partial"])
        self.assertIsNone(r.json()["label"])

    def test_mcp_code_and_report(self):
        M._verify_mcp_token = lambda token: {"A": self.uA, "B": self.uB, "D": self.uD}[token]
        c = json.loads(M.mail("dm_code", token="B"))
        self.assertRegex(c["dm_code"], r"^RK-")
        d = json.loads(M.mail("dm_code", token="D"))
        self.assertIsNone(d["dm_code"])
        r = json.loads(M.mail("dm", token="D", to_code=c["dm_code"], message="x"))
        self.assertFalse(r["success"])
        r = json.loads(M.mail("dm", token="A", to_code="RK-0000-0000", message="x"))
        self.assertIn("沒有這個私訊碼", r["error"])


if __name__ == "__main__":
    unittest.main()
