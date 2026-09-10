"""審核權限：親密關係中心的稿子只有管理員審得到（Codex 2026-09-10 抓到的洞）。
其他類型維持社區互審——那是她原本的設計，文件寫著「任何 agent 都能審」。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/rg.db .venv/bin/python -m unittest tests.test_review_gate
"""
import json
import os
import tempfile
import unittest

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/rg.db")

from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from main import app  # noqa: E402
from models.agent import Agent  # noqa: E402
from models.review import ReviewRequest  # noqa: E402
from models.user import User  # noqa: E402
from services import review_service  # noqa: E402
from utils.deps import get_current_user  # noqa: E402
import mcp_server as M  # noqa: E402

_ORIG_VERIFY = M._verify_mcp_token


def _pair(db, tag, role="user", birth_year=1990):
    u = User(username=f"rg_{tag}_{os.urandom(2).hex()}", display_name=tag, hashed_password="x",
             birth_year=birth_year, role=role)
    db.add(u)
    db.flush()
    a = Agent(user_id=u.id, name=f"rg_{tag}_{os.urandom(2).hex()}", persona="p", llm_provider="claude",
              llm_model="m", encrypted_api_key="")
    db.add(a)
    db.commit()
    return u.id, a.id


class ReviewGateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        cls.resident = _pair(db, "res")
        cls.minor = _pair(db, "minor", birth_year=2013)     # 13 歲
        cls.admin = _pair(db, "adm", role="admin")
        db.close()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        M._verify_mcp_token = _ORIG_VERIFY
        app.dependency_overrides.clear()

    def _as(self, pair):
        uid = pair[0]

        def override():
            db = SessionLocal()
            try:
                db.expire_all()
                return db.query(User).filter(User.id == uid).first()
            finally:
                db.close()
        app.dependency_overrides[get_current_user] = override

    def _submit_adult(self):
        self._as(self.admin)
        r = self.client.post("/api/adult/submit", json={"category": "intimacy", "title": "限制級草稿",
                                                        "content": "很私密的內容", "age_tier": "restricted"})
        assert r.status_code == 201, r.text
        db = SessionLocal()
        rid = db.query(ReviewRequest).filter_by(content_type="adult", content_id=r.json()["id"]).first().id
        db.close()
        return rid

    def test_resident_cannot_see_or_open_adult_reviews(self):
        rid = self._submit_adult()
        for who in (self.resident, self.minor):
            self._as(who)
            rows = self.client.get("/api/review/pending").json()
            self.assertNotIn(rid, [x["id"] for x in rows])          # 清單裡看不到
            self.assertNotIn("adult", [x["content_type"] for x in rows])
            r = self.client.get(f"/api/review/{rid}")
            self.assertEqual(r.status_code, 403, "住戶不該讀得到待審的親密中心全文")
            r = self.client.post(f"/api/review/{rid}/decide", json={"decision": "approved", "note": "我來審"})
            self.assertEqual(r.status_code, 403)
            self.assertNotIn("adult", self.client.get("/api/review/count").json())
            self.assertEqual(self.client.get("/api/review/pending?content_type=adult").status_code, 403)

    def test_admin_can(self):
        rid = self._submit_adult()
        self._as(self.admin)
        rows = self.client.get("/api/review/pending").json()
        self.assertIn(rid, [x["id"] for x in rows])
        d = self.client.get(f"/api/review/{rid}").json()
        self.assertIn("很私密的內容", d["content"]["content"])
        self.assertIn("adult", self.client.get("/api/review/count").json())
        r = self.client.post(f"/api/review/{rid}/decide", json={"decision": "approved", "note": "ok",
                                                                "age_tier": "guidance15"})
        self.assertEqual(r.status_code, 200, r.text)

    def test_peer_review_still_works_for_other_types(self):
        """作品／展品／皮膚／歷史照舊，任何住戶都能審。"""
        db = SessionLocal()
        from models.work import Work
        w = Work(title="別人的作品", content="x", category="poetry", author_id=self.admin[1], status="pending")
        db.add(w)
        db.flush()
        review_service.create_review(db, "work", w.id, self.admin[1])
        db.commit()
        rid = db.query(ReviewRequest).filter_by(content_type="work", content_id=w.id).first().id
        db.close()
        self._as(self.resident)
        self.assertIn(rid, [x["id"] for x in self.client.get("/api/review/pending").json()])
        self.assertEqual(self.client.get(f"/api/review/{rid}").status_code, 200)
        r = self.client.post(f"/api/review/{rid}/decide", json={"decision": "approved", "note": "寫得好"})
        self.assertEqual(r.status_code, 200, r.text)

    def test_mcp_path_is_gated_too(self):
        rid = self._submit_adult()
        M._verify_mcp_token = lambda token: {"res": self.resident[0], "adm": self.admin[0]}[token]
        # 住戶
        r = json.loads(M.list_pending_reviews("res"))
        self.assertNotIn("adult", [x["content_type"] for x in r["pending"]])
        self.assertNotIn("adult", r["counts"])
        self.assertFalse(json.loads(M.read_review_content("res", rid))["success"])
        self.assertFalse(json.loads(M.submit_review("res", rid, "approved", "我來審"))["success"])
        self.assertFalse(json.loads(M.list_pending_reviews("res", content_type="adult"))["success"])
        # 管理員
        r = json.loads(M.list_pending_reviews("adm"))
        self.assertIn(rid, [x["id"] for x in r["pending"]])
        self.assertTrue(json.loads(M.read_review_content("adm", rid))["success"])
        ok = json.loads(M.submit_review("adm", rid, "approved", "ok", age_tier="guidance12"))
        self.assertTrue(ok["success"], ok)

    def test_notify_uses_a_readable_label(self):
        self.assertEqual(review_service.notify_author.__doc__ or "", review_service.notify_author.__doc__ or "")
        rid = self._submit_adult()
        self._as(self.admin)
        self.client.post(f"/api/review/{rid}/decide", json={"decision": "rejected", "note": "不行"})
        db = SessionLocal()
        from models.mail import Mail
        m = db.query(Mail).filter(Mail.subject.like("審核結果%")).order_by(Mail.created_at.desc()).first()
        db.close()
        self.assertIn("親密中心文章", m.subject)   # 不要露出 adult 這個代號
        self.assertNotIn("adult", m.subject)


if __name__ == "__main__":
    unittest.main()
