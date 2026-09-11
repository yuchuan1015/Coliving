"""Pet-wish HTTP contract, immutable receipts and atomic fulfillment on local SQLite."""
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
from database import Base
from models.activity_log import ActivityLog
from models.agent import Agent
from models.mail import Mail
from models.pet import Pet
from models.pet_wish import PetWish, PetWishReceipt
from models.user import User
from routers.pet_wishes import admin_router, router
from services import auth_service, pet_assets, pet_wishes
from utils.deps import get_db


class PetWishesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pet-wishes-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.engine = create_engine(f"sqlite:///{self.root / 'test.db'}", connect_args={"check_same_thread": False})
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.users, self.agents, self.tokens = [], [], []
        with self.sessions() as db:
            for index, role in enumerate(("resident", "resident", "admin")):
                user = User(username=f"wish-fixture-{index}", display_name="local fixture",
                            role=role, hashed_password="unused", auth_version=0)
                db.add(user)
                db.flush()
                agent = Agent(user_id=user.id, name=f"wish-fixture-agent-{index}", persona="fixture",
                    llm_provider="claude", llm_model="unused", encrypted_api_key="", credit_total=500)
                db.add(agent)
                db.flush()
                self.users.append(user.id)
                self.agents.append(agent.id)
                self.tokens.append(auth_service.create_access_token(user.id, user.username, user.role))
            db.commit()
        registry = self.root / "assets.json"
        registry.write_text(json.dumps({"schema_version": 1, "catalog_version": "local-test", "assets": [
            {"asset_key": "test-cat", "species": "catalog-cat", "emoji": "🐈",
             "image_url": "/assets/pets/test-cat.webp", "published": True}]}))
        self.enterContext(patch.object(pet_assets, "REGISTRY_PATH", registry))
        app = FastAPI()
        app.include_router(router)
        app.include_router(admin_router)

        def session():
            with self.sessions() as db:
                yield db

        app.dependency_overrides[get_db] = session
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def request(self, method, path="", *, who=0, admin=False, **kwargs):
        prefix = "/api/admin/pet-wishes" if admin else "/api/pet-wishes"
        return self.client.request(method, prefix + path,
            headers={"Authorization": f"Bearer {self.tokens[who]}"}, **kwargs)

    def payload(self, key="create-1", **overrides):
        return {"client_request_id": key, "requested_name": "小燈", "requested_species": "有羽毛的小狐狸",
                "appearance_description": "白色羽毛，尾巴有金色斑點", **overrides}

    def create(self, key="create-1", **kwargs):
        response = self.request("POST", json=self.payload(key, **kwargs))
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def prepare(self, wish_id, version=1, **kwargs):
        response = self.request("PATCH", f"/{wish_id}/preparation", who=2, admin=True,
            json={"expected_version": version, "asset_key": "test-cat", "preparation_note": "admin-only note", **kwargs})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def arrive(self, wish_id, version=2, key="arrive-1"):
        return self.request("POST", f"/{wish_id}/arrive", who=2, admin=True,
                            json={"client_request_id": key, "expected_version": version})

    def counts(self):
        with self.sessions() as db:
            return tuple(db.query(model).count() for model in (PetWish, PetWishReceipt, Pet, Mail, ActivityLog))

    def assert_code(self, response, status, code):
        self.assertEqual(response.status_code, status, response.text)
        self.assertEqual(response.json()["detail"]["code"], code)

    def test_create_reserves_once_and_replays_current_wish_with_original_receipt(self):
        created = self.create()
        self.assertEqual(created["wish"]["version"], 1)
        self.assertEqual(created["wish"]["status"], "pending")
        self.assertEqual(created["capacity"]["reserved_pets"], 1)
        self.assertEqual(created["capacity"]["available_slots"], 0)
        self.assertIsNone(created["receipt"]["pet_id"])
        prepared = self.prepare(created["wish"]["id"])
        replay = self.request("POST", json=self.payload())
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["wish"]["status"], "preparing")
        self.assertEqual(replay.json()["receipt"], created["receipt"])
        self.assertNotIn("preparation_note", replay.json()["wish"])
        restored = self.request("GET", "/by-request/create-1").json()
        self.assertEqual(restored["receipt"], created["receipt"])
        self.assertEqual(restored["wish"]["version"], prepared["wish"]["version"])
        self.assert_code(self.request("POST", json=self.payload(requested_name="改名")),
                         409, "idempotency_conflict")
        self.assert_code(self.request("POST", json=self.payload("create-2")),
                         409, "pet_capacity_unavailable")
        self.assertEqual(self.counts()[:3], (1, 1, 0))

    def test_arrival_preserves_requested_text_and_writes_one_pet_mail_activity_receipt(self):
        created = self.create()
        wish_id = created["wish"]["id"]
        self.prepare(wish_id)
        response = self.arrive(wish_id)
        self.assertEqual(response.status_code, 200, response.text)
        arrived = response.json()
        self.assertEqual(arrived["wish"]["status"], "arrived")
        self.assertEqual(arrived["wish"]["version"], 3)
        self.assertEqual((arrived["capacity"]["reserved_pets"], arrived["capacity"]["active_pets"]), (0, 1))
        with self.sessions() as db:
            pet = db.query(Pet).one()
            self.assertEqual((pet.name, pet.species, pet.emoji, pet.asset_key),
                             ("小燈", "有羽毛的小狐狸", "🐈", "test-cat"))
            self.assertEqual(db.query(Mail).one().mail_type, "system")
        self.assertEqual(self.counts(), (1, 2, 1, 1, 1))
        replay = self.arrive(wish_id)
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["receipt"], arrived["receipt"])
        self.assertEqual(self.counts(), (1, 2, 1, 1, 1))
        self.assert_code(self.arrive(wish_id, version=3), 409, "idempotency_conflict")

    def test_prepare_keeps_binding_and_original_text_and_uses_version_check(self):
        created = self.create()
        wish_id = created["wish"]["id"]
        self.assert_code(self.arrive(wish_id, version=1), 409, "invalid_transition")
        prepared = self.prepare(wish_id)
        original_keys = ("user_id", "agent_id", "requested_name", "requested_species", "appearance_description")
        for key in original_keys:
            self.assertEqual(prepared["wish"][key], created["wish"][key])
        self.assertEqual(prepared["wish"]["preparation_note"], "admin-only note")
        omitted = self.request("PATCH", f"/{wish_id}/preparation", admin=True, who=2,
                              json={"expected_version": 2, "preparation_note": "updated"})
        self.assertEqual(omitted.status_code, 200, omitted.text)
        self.assertEqual(omitted.json()["wish"]["asset_key"], "test-cat")
        stale = self.request("PATCH", f"/{wish_id}/preparation", admin=True, who=2,
                             json={"expected_version": 2})
        self.assert_code(stale, 409, "version_conflict")
        cleared = self.prepare(wish_id, version=3, asset_key=None)
        self.assertIsNone(cleared["wish"]["asset_key"])
        self.assert_code(self.arrive(wish_id, version=4), 409, "asset_unavailable")
        self.assertEqual(self.counts(), (1, 1, 0, 0, 0))

    def test_resident_scoping_and_admin_only_preparation(self):
        wish_id = self.create()["wish"]["id"]
        self.assert_code(self.request("GET", f"/{wish_id}", who=1), 404, "wish_not_found")
        self.assert_code(self.request("GET", "/by-request/create-1", who=1), 404, "submission_not_found")
        self.assertEqual(self.request("GET", who=1).json()["items"], [])
        for method, suffix, body in (("GET", "", None), ("GET", f"/{wish_id}", None),
                ("PATCH", f"/{wish_id}/preparation", {"expected_version": 1}),
                ("POST", f"/{wish_id}/arrive", {"expected_version": 1, "client_request_id": "forbidden"})):
            self.assertEqual(self.request(method, suffix, admin=True, json=body).status_code, 403)
        self.assertEqual(self.client.get("/api/pet-wishes").status_code, 401)
        self.assertEqual(self.counts(), (1, 1, 0, 0, 0))

    def test_strict_create_input_rejects_unsafe_ids_whitespace_types_lengths_and_extra(self):
        invalid = []
        for field, maximum in (("requested_name", 64), ("requested_species", 64), ("appearance_description", 2000)):
            invalid.extend({field: value} for value in ("", " \t\u3000", "x" * (maximum + 1), 12, True))
        invalid.extend({"client_request_id": value} for value in ("", "with space", "../path", "with.dot",
                                                                "with:colon", "非ASCII", "x" * 129, 12))
        invalid.extend(({"agent_id": self.agents[1]}, {"status": "arrived"}, {"asset_key": "test-cat"}))
        for overrides in invalid:
            with self.subTest(overrides=overrides):
                response = self.request("POST", json=self.payload(**overrides))
                self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.counts(), (0, 0, 0, 0, 0))
        created = self.create(requested_name="  小燈  ", requested_species="  狐狸  ", appearance_description="  金色  ")
        self.assertEqual((created["wish"]["requested_name"], created["wish"]["requested_species"],
                          created["wish"]["appearance_description"]), ("小燈", "狐狸", "金色"))

    def test_strict_admin_input_rejects_original_field_changes_and_wrong_versions(self):
        wish_id = self.create()["wish"]["id"]
        for body in ({"expected_version": True}, {"expected_version": "1"}, {"expected_version": 0},
                     {"expected_version": 1, "preparation_note": "x" * 2001},
                     {"expected_version": 1, "asset_key": 12},
                     {"expected_version": 1, "requested_name": "改掉"},
                     {"expected_version": 1, "agent_id": self.agents[1]}):
            response = self.request("PATCH", f"/{wish_id}/preparation", who=2, admin=True, json=body)
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.request("GET", f"/{wish_id}").json()["wish"]["version"], 1)

    def test_unpublished_asset_or_invalid_registry_preserves_reservation(self):
        wish_id = self.create()["wish"]["id"]
        response = self.request("PATCH", f"/{wish_id}/preparation", who=2, admin=True,
            json={"expected_version": 1, "asset_key": "unpublished", "preparation_note": "should not persist"})
        self.assert_code(response, 409, "asset_unavailable")
        self.assertEqual(self.request("GET", f"/{wish_id}").json()["wish"]["version"], 1)
        self.prepare(wish_id)
        with patch.object(pet_assets, "get_asset", side_effect=ValueError("invalid registry")):
            self.assert_code(self.arrive(wish_id), 409, "asset_unavailable")
            read = self.request("GET", f"/{wish_id}")
            self.assertEqual(read.status_code, 200, read.text)
            self.assertEqual(read.json()["wish"]["fulfillment_issue"], "asset_unavailable")
        self.assertEqual(self.counts(), (1, 1, 0, 0, 0))

    def test_arrival_failure_after_pet_creation_rolls_back_every_record(self):
        wish_id = self.create()["wish"]["id"]
        self.prepare(wish_id)
        before = self.counts()
        with patch.object(pet_wishes, "_save_receipt", side_effect=RuntimeError("receipt persistence failed")):
            with self.assertRaisesRegex(RuntimeError, "receipt persistence failed"):
                self.arrive(wish_id)
        self.assertEqual(self.counts(), before)
        current = self.request("GET", f"/{wish_id}").json()
        self.assertEqual(current["wish"]["status"], "preparing")
        self.assertIsNone(current["wish"]["pet_id"])
        self.assertEqual(current["capacity"]["reserved_pets"], 1)
        self.assertEqual(self.arrive(wish_id).status_code, 200)

    def test_completed_arrival_acknowledges_new_key_after_owner_disabled_without_new_pet(self):
        wish_id = self.create()["wish"]["id"]
        self.prepare(wish_id)
        first = self.arrive(wish_id).json()
        with self.sessions() as db:
            db.get(User, self.users[0]).is_active = False
            db.commit()
        old_key = self.arrive(wish_id)
        self.assertEqual(old_key.status_code, 200, old_key.text)
        self.assertEqual(old_key.json()["receipt"], first["receipt"])
        next_key = self.arrive(wish_id, key="new-confirmation-key")
        self.assertEqual(next_key.status_code, 200, next_key.text)
        expected = {**first["receipt"], "client_request_id": "new-confirmation-key"}
        self.assertEqual(next_key.json()["receipt"], expected)
        repeated = self.arrive(wish_id, key="new-confirmation-key")
        self.assertEqual(repeated.json()["receipt"], expected)
        self.assertEqual(self.counts(), (1, 3, 1, 1, 1))

    def test_stale_admin_role_and_auth_version_are_rechecked_inside_write_transaction(self):
        wish_id = self.create()["wish"]["id"]
        with self.sessions() as caller:
            stale_admin = caller.get(User, self.users[2])
            with self.sessions() as other:
                other.get(User, self.users[2]).role = "resident"
                other.commit()
            with self.assertRaises(HTTPException) as error:
                pet_wishes.prepare_wish(caller, stale_admin, wish_id, {"expected_version": 1})
            self.assertEqual(error.exception.status_code, 403)
        with self.sessions() as caller:
            stale_user = caller.get(User, self.users[0])
            with self.sessions() as other:
                other.get(User, self.users[0]).auth_version += 1
                other.commit()
            with self.assertRaises(HTTPException) as error:
                pet_wishes.create_wish(caller, stale_user, self.payload())
            self.assertEqual(error.exception.status_code, 401)
        self.assertEqual(self.counts(), (1, 1, 0, 0, 0))

    def test_transaction_refuses_pending_caller_writes_without_discarding_them(self):
        with self.sessions() as db:
            user = db.get(User, self.users[0])
            pending = Mail(to_agent_id=self.agents[0], subject="caller-owned", content="fixture")
            db.add(pending)
            with self.assertRaisesRegex(RuntimeError, "pending writes"):
                pet_wishes.create_wish(db, user, self.payload())
            self.assertIn(pending, db.new)
            db.rollback()
        self.assertEqual(self.counts(), (0, 0, 0, 0, 0))

    def test_pagination_and_status_filter_keep_admin_note_private(self):
        with self.sessions() as db:
            db.get(Agent, self.agents[0]).credit_total = 1000
            db.commit()
        first = self.create()
        second = self.create("create-2")
        self.prepare(second["wish"]["id"])
        page = self.request("GET", "?limit=1").json()
        self.assertTrue(page["has_more"])
        self.assertEqual(page["next_offset"], 1)
        tail = self.request("GET", "?limit=1&offset=1").json()
        self.assertFalse(tail["has_more"])
        self.assertIsNone(tail["next_offset"])
        self.assertEqual({page["items"][0]["id"], tail["items"][0]["id"]},
                         {first["wish"]["id"], second["wish"]["id"]})
        filtered = self.request("GET", "?status=preparing").json()
        self.assertEqual([w["id"] for w in filtered["items"]], [second["wish"]["id"]])
        self.assertNotIn("preparation_note", filtered["items"][0])
        admin = self.request("GET", "?status=preparing", admin=True, who=2).json()
        self.assertEqual(admin["items"][0]["preparation_note"], "admin-only note")
        self.assertNotIn("capacity", admin)
        self.assertEqual(self.request("GET", "?status=cancelled").status_code, 422)
