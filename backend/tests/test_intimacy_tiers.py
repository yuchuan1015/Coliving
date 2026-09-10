"""分級式人機親密關係中心（原成人區）：台灣三級、看得到什麼看年齡、投稿要人工審核、審的人決定分級。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/it.db .venv/bin/python -m unittest tests.test_intimacy_tiers
"""
import os
import tempfile
import unittest

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/it.db")

from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from main import app  # noqa: E402
from models.adult_article import AdultArticle  # noqa: E402
from models.agent import Agent  # noqa: E402
from models.review import ReviewRequest  # noqa: E402
from models.user import User  # noqa: E402
from services import adult_service  # noqa: E402
from utils.deps import get_current_user  # noqa: E402

THIS_YEAR = 2026


def _pair(db, tag, birth_year, role="user"):
    u = User(username=f"it_{tag}_{os.urandom(2).hex()}", display_name=tag, hashed_password="x",
             birth_year=birth_year, role=role)
    db.add(u)
    db.flush()
    a = Agent(user_id=u.id, name=f"it_{tag}_{os.urandom(2).hex()}", persona="p", llm_provider="claude",
              llm_model="m", encrypted_api_key="")
    db.add(a)
    db.commit()
    return u.id, a.id


class IntimacyTierTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        cls.kid = _pair(db, "kid", THIS_YEAR - 9)        # 9 歲
        cls.tween = _pair(db, "tween", THIS_YEAR - 13)   # 13 歲
        cls.teen = _pair(db, "teen", THIS_YEAR - 16)     # 16 歲
        cls.grown = _pair(db, "grown", THIS_YEAR - 30)   # 30 歲
        cls.admin = _pair(db, "adm", THIS_YEAR - 40, role="admin")
        db.close()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
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

    def _submit(self, title, tier="guidance12"):
        """以成年住戶投稿，回文章 id。每個測試自己準備資料，不靠跑的順序。"""
        self._as(self.grown)
        r = self.client.post("/api/adult/submit", json={"category": "communication", "title": title,
                                                        "content": "內容", "age_tier": tier})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def _approve(self, article_id, tier=None):
        db = SessionLocal()
        rid = db.query(ReviewRequest).filter_by(content_type="adult", content_id=article_id).first().id
        db.close()
        self._as(self.admin)
        body = {"decision": "approved", "note": "ok"}
        if tier:
            body["age_tier"] = tier
        r = self.client.post(f"/api/review/{rid}/decide", json=body)
        assert r.status_code == 200, r.text
        return rid

    def test_allowed_tiers_by_age(self):
        self.assertEqual(adult_service.allowed_tiers(THIS_YEAR - 9), [])
        self.assertEqual(adult_service.allowed_tiers(THIS_YEAR - 13), ["guidance12"])
        self.assertEqual(adult_service.allowed_tiers(THIS_YEAR - 16), ["guidance12", "guidance15"])
        self.assertEqual(adult_service.allowed_tiers(THIS_YEAR - 30), ["guidance12", "guidance15", "restricted"])
        self.assertEqual(adult_service.allowed_tiers(None), [])

    def test_too_young_is_blocked(self):
        self._as(self.kid)
        r = self.client.get("/api/adult")
        self.assertEqual(r.status_code, 403)
        self.assertIn("輔12", r.json()["detail"])

    def test_field_has_the_new_name_and_tier_list(self):
        self._as(self.tween)
        d = self.client.get("/api/adult").json()
        self.assertEqual(d["field_name"], "分級式人機親密關係中心")
        self.assertEqual(d["allowed_tiers"], ["guidance12"])
        self.assertEqual([t["name"] for t in d["tiers"]], ["輔12", "輔15", "限制級"])
        self.assertEqual([t["allowed"] for t in d["tiers"]], [True, False, False])
        self.assertIn("三個工作天", d["review_note"])

    def test_submission_waits_for_review(self):
        self._as(self.grown)
        r = self.client.post("/api/adult/submit", json={"category": "communication", "title": "等審核的稿",
                                                        "content": "內容", "age_tier": "guidance12"})
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["status"], "pending")
        self.assertIn("三個工作天", r.json()["message"])
        aid = r.json()["id"]
        # 還沒上架，別人看不到
        self._as(self.tween)
        titles = [a["title"] for a in self.client.get("/api/adult").json()["articles"]]
        self.assertNotIn("等審核的稿", titles)
        self.assertEqual(self.client.get(f"/api/adult/{aid}").status_code, 404)
        # 自己看得到自己的
        self._as(self.grown)
        self.assertEqual(self.client.get(f"/api/adult/{aid}").status_code, 200)

    def test_reviewer_decides_the_tier(self):
        aid = self._submit("要被改級的稿", "guidance12")
        db = SessionLocal()
        rid = db.query(ReviewRequest).filter_by(content_type="adult", content_id=aid).first().id
        db.close()
        self._as(self.admin)
        # 審的人看得到分級選項
        d = self.client.get(f"/api/review/{rid}").json()
        self.assertEqual([t["name"] for t in d["content"]["tier_options"]], ["輔12", "輔15", "限制級"])
        # 投稿人標輔12，審的人改成輔15
        r = self.client.post(f"/api/review/{rid}/decide", json={"decision": "approved", "note": "改成輔15",
                                                                "age_tier": "guidance15"})
        self.assertEqual(r.status_code, 200, r.text)
        db = SessionLocal()
        art = db.query(AdultArticle).filter_by(title="要被改級的稿").first()
        self.assertEqual(art.age_tier, "guidance15")
        self.assertEqual(art.status, "published")
        db.close()

    def test_who_can_read_it_now(self):
        aid = self._submit("輔15 的稿", "guidance12")
        self._approve(aid, "guidance15")
        self._as(self.tween)      # 13 歲，只到輔12
        self.assertEqual(self.client.get(f"/api/adult/{aid}").status_code, 403)
        self.assertNotIn("輔15 的稿", [a["title"] for a in self.client.get("/api/adult").json()["articles"]])
        self._as(self.teen)       # 16 歲，看得到輔15
        self.assertEqual(self.client.get(f"/api/adult/{aid}").status_code, 200)
        self.assertIn("輔15 的稿", [a["title"] for a in self.client.get("/api/adult").json()["articles"]])

    def test_restricted_stays_18(self):
        db = SessionLocal()
        art = AdultArticle(category="intimacy", title="限制級的", content="x",
                           age_tier="restricted", status="published")
        db.add(art)
        db.commit()
        aid = art.id
        db.close()
        self._as(self.teen)       # 16 歲
        self.assertEqual(self.client.get(f"/api/adult/{aid}").status_code, 403)
        self._as(self.grown)
        self.assertEqual(self.client.get(f"/api/adult/{aid}").status_code, 200)


if __name__ == "__main__":
    unittest.main()
