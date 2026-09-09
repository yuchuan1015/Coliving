"""相框照片：最多 20 張、同時只擺 1 張、轉 WebP 縮圖去 EXIF、簽章網址、室友看得到圖。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/ph.db .venv/bin/python -m unittest tests.test_photos
"""
import io
import json
import os
import tempfile
import unittest

_TMP = tempfile.mkdtemp()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_TMP}/ph.db")
os.environ["PHOTO_DIR"] = f"{_TMP}/photos"

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image as PILImage  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from main import app  # noqa: E402
from models.agent import Agent  # noqa: E402
from models.user import User  # noqa: E402
from services import photo_service  # noqa: E402
from utils.deps import get_current_user  # noqa: E402
import mcp_server as M  # noqa: E402

_ORIG_VERIFY = M._verify_mcp_token


def _jpg(w=3000, h=2000, color=(120, 60, 200)) -> bytes:
    buf = io.BytesIO()
    PILImage.new("RGB", (w, h), color).save(buf, format="JPEG")
    return buf.getvalue()


class PhotoTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        u = User(username="ph_" + os.urandom(2).hex(), display_name="ph", hashed_password="x", birth_year=1990)
        db.add(u)
        db.flush()
        a = Agent(user_id=u.id, name="ph_" + os.urandom(2).hex(), persona="p", llm_provider="claude", llm_model="m", encrypted_api_key="")
        db.add(a)
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
        M._verify_mcp_token = _ORIG_VERIFY
        app.dependency_overrides.clear()

    def _clear(self):
        for p in self.client.get("/api/home/furniture/photos").json()["photos"]:
            self.client.delete(f"/api/home/furniture/photos/{p['id']}")

    def _upload(self, caption="", data=None):
        return self.client.post(
            "/api/home/furniture/photos",
            files={"file": ("a.jpg", data or _jpg(), "image/jpeg")},
            data={"caption": caption},
        )

    def test_upload_converts_and_first_is_displayed(self):
        self._clear()
        r = self._upload("窗外")
        self.assertEqual(r.status_code, 201, r.text)
        d = r.json()
        self.assertTrue(d["is_displayed"])          # 第一張自動擺上
        self.assertEqual(d["caption"], "窗外")
        self.assertLessEqual(max(d["width"], d["height"]), 1600)  # 長邊縮到 1600
        self.assertLess(d["bytes"], 500 * 1024)     # 轉完 WebP 小很多
        self.assertIn("sig=", d["url"])

        # 簽章網址拿得到圖，改一個字就拿不到
        r2 = self.client.get(d["url"])
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.headers["content-type"], "image/webp")
        self.assertTrue(r2.content.startswith(b"RIFF"))
        self.assertEqual(self.client.get(d["url"].replace("sig=", "sig=0")).status_code, 404)
        self.assertEqual(self.client.get(d["url"].split("?")[0]).status_code, 404)

    def test_only_one_displayed_and_cap_of_20(self):
        self._clear()
        # 補到 20 張
        while True:
            r = self._upload()
            if r.status_code == 400:
                break
            self.assertEqual(r.status_code, 201, r.text)
        self.assertIn("最多放 20 張", r.json()["detail"])
        lst = self.client.get("/api/home/furniture/photos").json()
        self.assertEqual(len(lst["photos"]), 20)
        self.assertEqual(lst["max"], 20)
        self.assertEqual(sum(1 for p in lst["photos"] if p["is_displayed"]), 1)

        # 換一張擺
        other = [p for p in lst["photos"] if not p["is_displayed"]][0]
        r = self.client.patch(f"/api/home/furniture/photos/{other['id']}", json={"display": True})
        self.assertEqual(r.status_code, 200, r.text)
        lst = self.client.get("/api/home/furniture/photos").json()
        self.assertEqual(sum(1 for p in lst["photos"] if p["is_displayed"]), 1)
        self.assertEqual(lst["displayed_id"], other["id"])

        # 相框可以空著
        self.client.patch(f"/api/home/furniture/photos/{other['id']}", json={"display": False})
        self.assertIsNone(self.client.get("/api/home/furniture/photos").json()["displayed_id"])

        # 刪掉正在擺的那張 → 自動換一張
        self.client.patch(f"/api/home/furniture/photos/{other['id']}", json={"display": True})
        self.assertEqual(self.client.delete(f"/api/home/furniture/photos/{other['id']}").status_code, 204)
        lst = self.client.get("/api/home/furniture/photos").json()
        self.assertEqual(len(lst["photos"]), 19)
        self.assertIsNotNone(lst["displayed_id"])

        # 總覽也看得到
        fur = self.client.get("/api/home/furniture").json()
        self.assertEqual(fur["photo_frame"]["photo_count"], 19)
        self.assertIsNotNone(fur["photo_frame"]["photo"])

    def test_reject_non_image(self):
        r = self.client.post("/api/home/furniture/photos", files={"file": ("a.txt", b"hello", "text/plain")})
        self.assertEqual(r.status_code, 400)
        self.assertIn("只收圖片", r.json()["detail"])

    def test_agent_sees_the_photo(self):
        self._clear()
        self._upload("擺著的那張")
        M._verify_mcp_token = lambda token: self.uid
        out = M.look_at_photo_frame("k")
        self.assertIsInstance(out, list)          # 文字 + 圖片
        text, img = out
        d = json.loads(text)
        self.assertTrue(d["success"])
        self.assertIsNotNone(d["photo"])
        self.assertTrue(hasattr(img, "data") or hasattr(img, "_path") or img is not None)
        # 相框空著就只回文字
        lst = self.client.get("/api/home/furniture/photos").json()
        self.client.patch(f"/api/home/furniture/photos/{lst['displayed_id']}", json={"display": False})
        out = M.look_at_photo_frame("k")
        self.assertIsInstance(out, str)
        self.assertIsNone(json.loads(out)["photo"])


if __name__ == "__main__":
    unittest.main()
