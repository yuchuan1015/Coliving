"""交接修正的權限、資料一致性與模型工具往返回歸。請用 run_tests.py 執行。"""
import asyncio
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from database import Base, SessionLocal, engine
from main import app
import models
import mcp_server as M
from mcp_token_verifier import ColiveTokenVerifier
from models.agent import Agent
from models.user import User
from models.diary import DiaryEntry
from models.skin import Skin
from models.dm_report import DMReport
from models.oauth import OAuthClient, OAuthGrant
from services import auth_service, bed_service, diary_service, drawer_service, adult_service, review_service
from services import ai_chat_service, llm_service as L, mem0_service, oauth_service


def resident(db, label="test", **fields):
    import uuid
    tag = uuid.uuid4().hex[:12]
    user = User(username=tag, display_name=label, birth_year=1990,
                hashed_password=auth_service.hash_password("old-password"), **fields)
    db.add(user)
    db.flush()
    agent = Agent(user_id=user.id, name=tag, persona="p", llm_provider="claude",
                  llm_model="test-model", encrypted_api_key="")
    db.add(agent)
    db.commit()
    return user, agent


class HandoffEndpointsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(engine)

    def setUp(self):
        app.dependency_overrides.clear()
        self.db = SessionLocal()
        self.addCleanup(self.db.close)
        self.user, self.agent = resident(self.db)
        token = auth_service.create_access_token(self.user.id, self.user.username, self.user.role)
        self.client = TestClient(app, headers={"Authorization": f"Bearer {token}"})
        self.addCleanup(self.client.close)

    def mcp_key(self):
        key = bed_service.issue_key(self.db, self.user.id, self.agent.id)
        self.db.commit()
        return bed_service.token_string(key, self.user.username)

    def test_diary_detail_hides_drawer_but_owner_agent_can_open_it(self):
        public = diary_service.write_diary(self.db, self.agent, "public", "readable")
        private = drawer_service.store_item(self.db, self.agent, "secret", "private text")
        self.assertEqual(self.client.get(f"/api/diary/{public.id}").status_code, 200)
        denied = self.client.get(f"/api/diary/{private.id}")
        self.assertEqual(denied.status_code, 404)
        self.assertNotIn("private text", denied.text)
        own = json.loads(M.open_drawer(self.mcp_key()))
        self.assertIn("private text", [x["content"] for x in own["items"]])
        other, other_agent = resident(self.db)
        entry = diary_service.write_diary(self.db, other_agent, "other", "other text")
        self.assertEqual(self.client.get(f"/api/diary/{entry.id}").status_code, 404)

    def test_drawer_mcp_stores_one_entry_and_returns_it(self):
        out = json.loads(M.store_in_drawer(self.mcp_key(), "label", "body", "misc"))
        self.assertTrue(out["success"], out)
        rows = self.db.query(DiaryEntry).filter_by(agent_id=self.agent.id).all()
        self.assertEqual(len(rows), 1)
        self.assertEqual(out["item"]["id"], rows[0].id)
        self.assertTrue(rows[0].private)

    def test_adult_rejection_updates_review_and_article_via_endpoint(self):
        self.user.role = "admin"
        article = adult_service.submit_article(self.db, self.agent, "faq", "test", "content")
        self.db.commit()
        review = self.db.query(models.review.ReviewRequest).filter_by(content_id=article.id).one()
        result = self.client.post(f"/api/review/{review.id}/decide", json={"decision": "rejected", "note": "test"})
        self.assertEqual(result.status_code, 200, result.text)
        self.db.refresh(article)
        self.db.refresh(review)
        self.assertEqual((article.status, review.status), ("rejected", "rejected"))

    def test_mcp_skin_apply_activates_and_obeys_credit_limit(self):
        other, author = resident(self.db)
        source = Skin(author_id=author.id, name="published", html_content="<b>x</b>", is_published=True)
        self.db.add(source)
        self.db.commit()
        token = self.mcp_key()
        for _ in range(3):
            result = json.loads(M.apply_skin(token, source.id))
            self.assertTrue(result["success"], result)
            self.db.refresh(self.agent)
            active = self.db.get(Skin, self.agent.active_skin_id)
            self.assertIsNotNone(active)
            self.assertEqual(active.author_id, self.agent.id)
        self.assertFalse(json.loads(M.apply_skin(token, source.id))["success"])
        self.assertEqual(self.db.query(Skin).filter_by(author_id=self.agent.id).count(), 3)

    def test_inactive_accounts_rejected_by_public_private_wake_and_oauth(self):
        token = self.mcp_key()
        legacy = auth_service.create_mcp_token(self.user.id, self.user.username)
        client = OAuthClient(client_name="test", redirect_uris='["https://example.com/callback"]')
        self.db.add(client)
        self.db.flush()
        grant = OAuthGrant(user_id=self.user.id, agent_id=self.agent.id, client_id=client.id, scope="mcp")
        self.db.add(grant)
        self.db.flush()
        issued = oauth_service._issue(self.db, grant)
        self.db.commit()
        self.assertEqual(M._verify_mcp_token(token), self.user.id)
        self.user.is_active = False
        self.db.commit()
        for fixed in (token, legacy):
            self.assertIsNone(M._verify_mcp_token(fixed))
            self.assertIsNone(asyncio.run(ColiveTokenVerifier().verify_token(fixed)))
            self.assertEqual(self.client.get("/api/wake/pending", headers={"Authorization": f"Bearer {fixed}"}).status_code, 401)
        self.assertIsNone(M._verify_mcp_token(issued["access_token"]))
        with self.assertRaises(oauth_service.OAuthError):
            oauth_service.refresh(self.db, client, issued["refresh_token"])

    def test_mcp_token_cannot_use_another_users_key_id(self):
        other, agent = resident(self.db)
        row = bed_service.issue_key(self.db, other.id, agent.id)
        self.db.commit()
        mismatched = auth_service.create_mcp_token(self.user.id, self.user.username, token_id=row.id)
        self.assertIsNone(M._verify_mcp_token(mismatched))

    def test_blocked_responder_never_calls_model(self):
        other, blocked = resident(self.db)
        blocked.encrypted_api_key = "test-key"
        self.db.add(DMReport(reporter_agent_id=self.agent.id, reported_agent_id=blocked.id,
                            conversation_id="test-conversation", reason="test", status="upheld"))
        self.db.commit()
        with patch.object(ai_chat_service.memory_service, "require_context"), \
             patch.object(ai_chat_service, "_call_agent_decision") as call:
            conv = ai_chat_service.initiate_conversation(self.db, self.agent, blocked, "hello")
        call.assert_not_called()
        self.assertEqual(conv.status, "ended")
        self.assertEqual(conv.ended_reason, "blocked")

    def test_display_name_changes_only_own_name(self):
        r = self.client.patch("/api/users/me", json={"display_name": "  新名字  "})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["display_name"], "新名字")
        self.assertEqual(r.json()["username"], self.user.username)
        for name in (None, "   ", "x" * 65):
            self.assertEqual(self.client.patch("/api/users/me", json={"display_name": name}).status_code, 422)
        self.assertEqual(self.client.patch("/api/users/me", json={"note_to_agent": "hello"}).status_code, 200)

    def test_password_checks_old_password_and_revokes_web_sessions(self):
        refresh = auth_service.create_refresh_token(self.user.id)
        key = self.mcp_key()
        path = "/api/users/me/password"
        self.assertEqual(self.client.post(path, json={"old_password": "wrong", "new_password": "new-password"}).status_code, 400)
        self.assertEqual(self.client.post(path, json={"old_password": "old-password", "new_password": "old-password"}).status_code, 400)
        for password in ("short", "密" * 25):
            self.assertEqual(self.client.post(path, json={"old_password": "old-password", "new_password": password}).status_code, 422)
        r = self.client.post(path, json={"old_password": "old-password", "new_password": "new-password"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn("new-password", r.text)
        self.assertEqual(self.client.get("/api/users/me").status_code, 401)
        self.assertEqual(self.client.post("/api/auth/refresh", json={"refresh_token": refresh}).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json={"username": self.user.username, "password": "old-password"}).status_code, 401)
        login = self.client.post("/api/auth/login", json={"username": self.user.username, "password": "new-password"})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(self.client.get("/api/users/me", headers={"Authorization": f'Bearer {login.json()["access_token"]}'}).status_code, 200)
        self.assertEqual(M._verify_mcp_token(key), self.user.id)

    def test_password_migration_is_idempotent_and_keeps_existing_data(self):
        path = Path(__file__).resolve().parents[1] / "migrations/022_auth_version.py"
        spec = importlib.util.spec_from_file_location("migration022", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "old.db")
            with sqlite3.connect(db_path) as db:
                db.execute("CREATE TABLE users (id TEXT, hashed_password TEXT)")
                db.execute("INSERT INTO users VALUES ('u', 'unchanged')")
            migration.main(db_path)
            migration.main(db_path)
            with sqlite3.connect(db_path) as db:
                self.assertEqual(db.execute("SELECT * FROM users").fetchone(), ("u", "unchanged", 0))

    def test_adult_pagination_filters_before_slicing_and_enforces_age(self):
        ids = set()
        for i in range(23):
            article = adult_service.create_article(self.db, "communication", f"page {i}", "body", self.agent,
                                                    age_tier="guidance12", status="published")
            self.db.flush()
            ids.add(article.id)
        for i in range(23):
            adult_service.create_article(self.db, "communication", f"restricted {i}", "body", self.agent,
                                         age_tier="restricted", status="published")
        self.db.commit()
        url = "/api/adult?category=communication&age_tier=guidance12&limit=20"
        first = self.client.get(url).json()
        self.assertEqual(len(first["articles"]), 20)
        self.assertTrue(first["has_more"])
        second = self.client.get(url + f'&offset={first["next_offset"]}').json()
        self.assertFalse(second["has_more"])
        self.assertIsNone(second["next_offset"])
        got = [a["id"] for a in first["articles"] + second["articles"]]
        self.assertEqual(set(got), ids)
        self.assertEqual(len(got), len(ids))
        from datetime import datetime
        self.user.birth_year = datetime.now().year - 13
        self.db.commit()
        self.assertEqual(self.client.get("/api/adult?age_tier=restricted").status_code, 403)


class MemoryIsolationTest(unittest.TestCase):
    def setUp(self):
        self.agent = SimpleNamespace(id="one", name="test", llm_provider="openai", llm_model="model",
                                     encrypted_api_key="encrypted", memory_mcp=None)
        self.addCleanup(patch.stopall)
        patch.object(mem0_service, "_EMBED_KEY", "dummy-embedding-key").start()

    def test_native_memory_delete_checks_owner_in_shared_collection(self):
        from mem0 import Memory
        from qdrant_client import QdrantClient
        with tempfile.TemporaryDirectory() as tmp:
            qdrant = QdrantClient(":memory:")
            try:
                memory = Memory.from_config({
                    "llm": {"provider": "openai", "config": {"api_key": "dummy", "model": "model"}},
                    "embedder": {"provider": "openai", "config": {"api_key": "dummy", "embedding_dims": 3}},
                    "vector_store": {"provider": "qdrant", "config": {"client": qdrant, "collection_name": "test", "embedding_model_dims": 3}},
                    "history_db_path": f"{tmp}/history.db",
                })
                with patch.object(memory.embedding_model, "embed", return_value=[0.1, 0.2, 0.3]), \
                     patch.object(mem0_service, "_get_instance", return_value=memory):
                    one = memory.add("one's memory", user_id="one", infer=False)["results"][0]["id"]
                    two = memory.add("two's memory", user_id="two", infer=False)["results"][0]["id"]
                    self.assertEqual([m["id"] for m in mem0_service.get_all(self.agent)], [one])
                    self.assertEqual([m["id"] for m in mem0_service.search(self.agent, "memory", limit=1)], [one])
                    self.assertFalse(mem0_service.delete_one(self.agent, two))
                    self.assertIsNotNone(memory.get(two))
                    self.assertTrue(mem0_service.delete_one(self.agent, one))
                    self.assertIsNone(memory.get(one))
                    for i in range(24):
                        memory.add(f"memory {i}", user_id="one", infer=False)
                    self.assertEqual(len(mem0_service.get_all(self.agent)), 24)
                    found = mem0_service.search(self.agent, "memory", limit=3)
                    self.assertEqual(len(found), 3)
                    self.assertNotIn(two, [m["id"] for m in found])
                    # Use the real add signature; only the model/storage work is replaced here.
                    with patch.object(memory, "_add_to_vector_store", return_value=[]) as store, \
                         patch.object(mem0_service.threading, "Thread", side_effect=lambda target, daemon: SimpleNamespace(start=target)):
                        self.assertTrue(mem0_service.add_direct(self.agent, "remember this"))
                        mem0_service.add_background(self.agent, [{"role": "user", "content": "background memory"}])
                        self.assertEqual(store.call_count, 2)
                        self.assertEqual(store.call_args.args[1]["user_id"], "one")
                memory.close()
            finally:
                qdrant.close()

    def test_memory_cache_rebuilds_after_key_model_or_provider_changes(self):
        from mem0 import Memory
        with patch.object(mem0_service, "_instances", {}), \
             patch.object(mem0_service, "_decrypt_key", return_value="dummy"), \
             patch.object(mem0_service, "_get_qdrant_client", return_value=Mock()), \
             patch.object(Memory, "from_config", side_effect=lambda config: object()) as factory:
            first = mem0_service._get_instance(self.agent)
            self.assertIs(mem0_service._get_instance(self.agent), first)
            self.agent.encrypted_api_key = "changed-key"
            second = mem0_service._get_instance(self.agent)
            self.assertIsNot(first, second)
            self.agent.llm_model = "changed-model"
            self.assertIsNot(second, mem0_service._get_instance(self.agent))
            for provider in ("claude", "gemini", "deepseek", "xai"):
                self.agent.llm_provider = provider
                mem0_service._get_instance(self.agent)
                config = factory.call_args.args[0]["llm"]
                self.assertEqual(config["provider"], "anthropic" if provider == "claude" else provider)
                self.assertEqual(config["config"]["api_key"], "dummy")

    def test_all_five_memory_providers_initialize_with_resident_key(self):
        from qdrant_client import QdrantClient
        qdrant = QdrantClient(":memory:")
        instances = []
        with tempfile.TemporaryDirectory() as tmp, patch.object(mem0_service, "_instances", {}), \
             patch.object(mem0_service, "_HISTORY_DB", f"{tmp}/history.db"), \
             patch.object(mem0_service, "_EMBED_DIMS", 3), \
             patch.object(mem0_service, "_get_qdrant_client", return_value=qdrant), \
             patch.object(mem0_service, "_decrypt_key", return_value="dummy-resident-key"):
            try:
                for provider in ("openai", "claude", "gemini", "deepseek", "xai"):
                    self.agent.llm_provider = provider
                    m = mem0_service._get_instance(self.agent)
                    self.assertIsNotNone(m, provider)
                    instances.append(m)
                    self.assertEqual(m.llm.config.api_key, "dummy-resident-key")
                    if provider in ("xai", "deepseek"):
                        self.assertIn("api.x.ai" if provider == "xai" else "api.deepseek.com", str(m.llm.client.base_url))
            finally:
                for m in instances:
                    m.close()
                qdrant.close()


class ProviderRoundTripTest(unittest.TestCase):
    def response(self, payload):
        return SimpleNamespace(status_code=200, json=lambda: payload)

    def test_gemini_parallel_same_name_calls_preserve_ids_and_signatures(self):
        original = {"role": "model", "parts": [
            {"thought": True, "text": "private reasoning", "thoughtSignature": "sig-text"},
            {"functionCall": {"id": "call-1", "name": "lookup", "args": {"x": 1}}, "thoughtSignature": "sig-1"},
            {"functionCall": {"id": "call-2", "name": "lookup", "args": {"x": 2}}, "thoughtSignature": "sig-2"},
        ]}
        data = {"candidates": [{"content": deepcopy(original)}], "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5}}
        final = {"candidates": [{"content": {"role": "model", "parts": [{"text": "answer"}]}}]}
        history = [{"role": "user", "content": "lookup both"}]
        with patch.object(L.httpx, "post", side_effect=[self.response(data), self.response(final)]) as post, L.collect() as usage:
            first = L.chat_completion_with_tools("gemini", "test", "dummy", "system", history, [L.ToolDef("lookup", "test", {})])
            self.assertNotIn("private reasoning", first.text)
            history += L.build_tool_result_messages("gemini", first, [L.ToolResult("call-1", "one"), L.ToolResult("call-2", "two")])
            result = L.chat_completion_with_tools("gemini", "test", "dummy", "system", history, [])
        sent = post.call_args_list[1].kwargs["json"]
        self.assertEqual(sent["contents"][1], original)
        self.assertEqual([p["functionResponse"]["id"] for p in sent["contents"][2]["parts"]], ["call-1", "call-2"])
        self.assertNotIn("tools", sent)
        self.assertEqual(result.text, "answer")
        self.assertEqual(len(usage), 2)

    def test_gemini_old_calls_without_ids_remain_distinct(self):
        data = {"candidates": [{"content": {"role": "model", "parts": [
            {"functionCall": {"name": "lookup", "args": {"x": n}}} for n in (1, 2)
        ]}}]}
        with patch.object(L.httpx, "post", return_value=self.response(data)):
            r = L.chat_completion_with_tools("gemini", "test", "dummy", "system", [], [])
        self.assertEqual(len({c.id for c in r.tool_calls}), 2)
        messages = L.build_tool_result_messages("gemini", r, [L.ToolResult(c.id, str(i)) for i, c in enumerate(r.tool_calls)])
        self.assertTrue(all("id" not in p["functionResponse"] for p in messages[1]["parts"]))

    def test_simple_gemini_vision_and_deepseek_use_correct_endpoints(self):
        data = {"candidates": [{"content": {"parts": [{"text": "meal"}]}}], "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 2}}
        with patch.object(L.httpx, "post", return_value=self.response(data)) as post, L.collect() as usage:
            text = L.chat_completion("gemini", "test", "dummy", "sys", [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,aGVsbG8="}}, {"type": "text", "text": "food"}
            ]}])
        self.assertEqual(text, "meal")
        self.assertEqual(post.call_args.kwargs["json"]["contents"][0]["parts"][0]["inlineData"]["mimeType"], "image/png")
        self.assertEqual(usage[0]["input_tokens"], 10)
        with patch.object(L, "_call_openai_compat", return_value="reply") as call:
            self.assertEqual(L.chat_completion("deepseek", "test", "dummy", "sys", []), "reply")
        self.assertEqual(call.call_args.args[-2:], ("https://api.deepseek.com/v1/chat/completions", "deepseek"))
