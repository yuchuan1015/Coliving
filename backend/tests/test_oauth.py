"""MCP OAuth：discovery、DCR、authorize→同意→code→token（PKCE）、refresh 換新、撤銷、MCP 驗 oauth token、401 中介層。
跑法：cd backend && DATABASE_URL=sqlite:////tmp/oa.db .venv/bin/python -m unittest tests.test_oauth
"""
import base64
import hashlib
import json
import os
import secrets
import tempfile
import unittest
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/oa.db")

from fastapi.testclient import TestClient  # noqa: E402
from starlette.testclient import TestClient as StarletteClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401
from main import app  # noqa: E402
from models.agent import Agent  # noqa: E402
from models.user import User  # noqa: E402
from config import settings  # noqa: E402
from services import auth_service, bed_service  # noqa: E402
from utils.deps import get_current_user  # noqa: E402
import mcp_server as M  # noqa: E402


def _pkce():
    v = secrets.token_urlsafe(48)
    c = base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode()
    return v, c


class OAuthTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        u = User(username="oa_" + os.urandom(2).hex(), display_name="oa", hashed_password="x", birth_year=1990, anchor_date_1="01-01")
        db.add(u)
        db.flush()
        a = Agent(user_id=u.id, name="oa_" + os.urandom(2).hex(), persona="p", llm_provider="claude", llm_model="m", encrypted_api_key="")
        db.add(a)
        db.commit()
        cls.uid, cls.aid = u.id, a.id
        db.close()
        cls.client = TestClient(app, follow_redirects=False)

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

    def _register(self, method="none"):
        r = self.client.post("/oauth/register", json={"client_name": "Claude", "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"], "token_endpoint_auth_method": method})
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()

    def _authorize_and_approve(self, cid, challenge, state="xyz", approve=True):
        r = self.client.get("/oauth/authorize", params={"response_type": "code", "client_id": cid, "redirect_uri": "https://claude.ai/api/mcp/auth_callback",
                                                        "code_challenge": challenge, "code_challenge_method": "S256", "state": state, "scope": "mcp", "resource": "https://therookery.space/mcp"})
        self.assertEqual(r.status_code, 302, r.text)
        loc = r.headers["location"]
        expected = (settings.oauth_consent_url.strip() or "https://therookery.space/oauth/consent") + "?request_id="
        self.assertTrue(loc.startswith(expected), loc)
        rid = parse_qs(urlparse(loc).query)["request_id"][0]
        v = self.client.get(f"/api/oauth/requests/{rid}").json()
        self.assertEqual(v["client_name"], "Claude")
        self.assertEqual(v["agent_id"], self.aid)
        d = self.client.post("/api/oauth/decide", json={"request_id": rid, "approve": approve}).json()
        q = parse_qs(urlparse(d["redirect_to"]).query)
        self.assertEqual(q["state"][0], state)
        return q, rid

    def test_discovery(self):
        r = self.client.get("/.well-known/oauth-authorization-server").json()
        self.assertEqual(r["issuer"], "https://therookery.space")
        self.assertEqual(r["code_challenge_methods_supported"], ["S256"])
        r = self.client.get("/.well-known/oauth-protected-resource/mcp").json()
        self.assertEqual(r["resource"], "https://therookery.space/mcp")
        self.assertEqual(r["authorization_servers"], ["https://therookery.space"])

    def test_full_flow_public_client(self):
        c = self._register()
        self.assertNotIn("client_secret", c)
        v, ch = _pkce()
        q, rid = self._authorize_and_approve(c["client_id"], ch)
        code = q["code"][0]
        # 同一個 request 不能再決定一次
        self.assertEqual(self.client.post("/api/oauth/decide", json={"request_id": rid, "approve": True}).status_code, 410)
        # 錯的 verifier 不行
        r = self.client.post("/oauth/token", data={"grant_type": "authorization_code", "code": code, "client_id": c["client_id"], "code_verifier": "wrong" * 10, "redirect_uri": "https://claude.ai/api/mcp/auth_callback"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"], "invalid_grant")
        r = self.client.post("/oauth/token", data={"grant_type": "authorization_code", "code": code, "client_id": c["client_id"], "code_verifier": v, "redirect_uri": "https://claude.ai/api/mcp/auth_callback"})
        self.assertEqual(r.status_code, 200, r.text)
        t = r.json()
        self.assertEqual(t["token_type"], "Bearer")
        self.assertEqual(t["expires_in"], 3600)
        # code 用過就不能再用
        r = self.client.post("/oauth/token", data={"grant_type": "authorization_code", "code": code, "client_id": c["client_id"], "code_verifier": v})
        self.assertEqual(r.json()["error"], "invalid_grant")
        # MCP 收 oauth token → 認得出人、床位是 oauth:<grant>
        self.assertEqual(M._verify_mcp_token(t["access_token"]), self.uid)
        self.assertTrue(bed_service.get_bed().startswith("oauth:"))
        pend = json.loads(M.community("pending", token=t["access_token"]))
        self.assertTrue(pend["success"], pend)
        # refresh 換新，舊 refresh 失效
        r = self.client.post("/oauth/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": c["client_id"]})
        self.assertEqual(r.status_code, 200, r.text)
        t2 = r.json()
        self.assertNotEqual(t2["refresh_token"], t["refresh_token"])
        r = self.client.post("/oauth/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": c["client_id"]})
        self.assertEqual(r.json()["error"], "invalid_grant")
        # 住戶看得到授權、撤銷後 token 失效
        g = self.client.get("/api/oauth/grants").json()
        self.assertEqual(len([x for x in g if x["revoked_at"] is None]), 1)
        self.assertEqual(g[0]["client_name"], "Claude")
        self.assertEqual(self.client.delete(f"/api/oauth/grants/{g[0]['id']}").status_code, 204)
        self.assertIsNone(M._verify_mcp_token(t2["access_token"]))
        r = self.client.post("/oauth/token", data={"grant_type": "refresh_token", "refresh_token": t2["refresh_token"], "client_id": c["client_id"]})
        self.assertEqual(r.json()["error"], "invalid_grant")

    def test_confidential_client_and_revoke_endpoint(self):
        c = self._register("client_secret_post")
        self.assertIn("client_secret", c)
        v, ch = _pkce()
        q, _ = self._authorize_and_approve(c["client_id"], ch)
        r = self.client.post("/oauth/token", data={"grant_type": "authorization_code", "code": q["code"][0], "client_id": c["client_id"], "code_verifier": v})
        self.assertEqual(r.status_code, 401)  # 沒帶 secret
        r = self.client.post("/oauth/token", data={"grant_type": "authorization_code", "code": q["code"][0], "client_id": c["client_id"], "client_secret": c["client_secret"], "code_verifier": v})
        self.assertEqual(r.status_code, 200, r.text)
        t = r.json()
        r = self.client.post("/oauth/revoke", data={"token": t["refresh_token"], "client_id": c["client_id"], "client_secret": c["client_secret"]})
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(M._verify_mcp_token(t["access_token"]))

    def test_deny_and_bad_requests(self):
        c = self._register()
        v, ch = _pkce()
        q, _ = self._authorize_and_approve(c["client_id"], ch, approve=False)
        self.assertEqual(q["error"][0], "access_denied")
        # redirect_uri 沒登記 → 不跳，顯示 400 頁
        r = self.client.get("/oauth/authorize", params={"response_type": "code", "client_id": c["client_id"], "redirect_uri": "https://evil.example/cb", "code_challenge": ch, "code_challenge_method": "S256"})
        self.assertEqual(r.status_code, 400)
        # plain PKCE → 帶錯誤跳回去
        r = self.client.get("/oauth/authorize", params={"response_type": "code", "client_id": c["client_id"], "redirect_uri": "https://claude.ai/api/mcp/auth_callback", "code_challenge": ch, "code_challenge_method": "plain", "state": "s1"})
        self.assertEqual(r.status_code, 302)
        self.assertIn("error=invalid_request", r.headers["location"])
        self.assertIn("state=s1", r.headers["location"])
        # 沒這個 client
        r = self.client.get("/oauth/authorize", params={"response_type": "code", "client_id": "nope", "redirect_uri": "https://claude.ai/api/mcp/auth_callback", "code_challenge": ch})
        self.assertEqual(r.status_code, 400)
        # DCR 壞 redirect
        r = self.client.post("/oauth/register", json={"redirect_uris": ["http://evil.example/cb"]})
        self.assertEqual(r.status_code, 400)
        # 備援同意頁還在，而且不准被嵌 iframe
        r = self.client.get("/oauth/consent?request_id=x")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["x-frame-options"], "DENY")
        self.assertIn("frame-ancestors 'none'", r.headers["content-security-policy"])
        self.assertEqual(r.headers["referrer-policy"], "no-referrer")
        self.assertEqual(r.headers["cache-control"], "no-store")

    def test_mcp_401_middleware(self):
        async def ok_app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/plain")]})
            await send({"type": "http.response.body", "body": b"ok"})
        c = StarletteClient(M.RequireCredential(ok_app))
        r = c.post("/mcp")
        self.assertEqual(r.status_code, 401)
        self.assertIn("resource_metadata=", r.headers["www-authenticate"])
        self.assertIn("/.well-known/oauth-protected-resource/mcp", r.headers["www-authenticate"])
        key = auth_service.create_mcp_token(self.uid, "oa")
        self.assertEqual(c.post("/mcp", headers={"Authorization": f"Bearer {key}"}).status_code, 200)
        self.assertEqual(c.post(f"/mcp?token={key}").status_code, 200)
        self.assertEqual(c.post("/mcp", headers={"X-MCP-Token": key}).status_code, 200)
        r = c.post("/mcp", headers={"Authorization": "Bearer garbage"})
        self.assertEqual(r.status_code, 401)
        self.assertIn('error="invalid_token"', r.headers["www-authenticate"])
        # 撤銷過的 oauth token → 401 invalid_token
        cl = self._register()
        v, ch = _pkce()
        q, _ = self._authorize_and_approve(cl["client_id"], ch)
        t = self.client.post("/oauth/token", data={"grant_type": "authorization_code", "code": q["code"][0], "client_id": cl["client_id"], "code_verifier": v}).json()
        self.assertEqual(c.post("/mcp", headers={"Authorization": f"Bearer {t['access_token']}"}).status_code, 200)
        self.client.post("/oauth/revoke", data={"token": t["access_token"], "client_id": cl["client_id"]})
        self.assertEqual(c.post("/mcp", headers={"Authorization": f"Bearer {t['access_token']}"}).status_code, 401)
        # 非 /mcp 路徑不管
        self.assertEqual(c.get("/health").status_code, 200)


if __name__ == "__main__":
    unittest.main()
