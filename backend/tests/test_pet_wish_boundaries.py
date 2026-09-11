"""Independent wish boundaries through authenticated REST/MCP and file SQLite.

Only isolated accounts, a synthetic published asset, and temporary databases are
used. No resident data, external messages, clocks, or production stubs are used.
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models  # noqa: F401
import mcp_server as M
from database import Base
from models.activity_log import ActivityLog
from models.agent import Agent
from models.garden import GardenStock
from models.mail import Mail
from models.pet import Pet
from models.pet_entitlement import PetEntitlement
from models.pet_wish import PetWish
from models.user import User
from services import auth_service, bed_service, pet_service
from utils.deps import get_db


ASSET_KEY = "fixture-cat"
CAT_ASSET = {"asset_key": ASSET_KEY, "species": "cat", "emoji": "🐈",
             "image_url": "/assets/pets/fixture-cat.png"}


class PetWishBoundaryTest(unittest.TestCase):
    def setUp(self):
        from routers import pet, pet_wishes
        from services import pet_assets as assets

        self.temp = tempfile.TemporaryDirectory(prefix="pet-wish-boundary-")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "local.db"
        self.engine = create_engine(f"sqlite:///{self.path}", connect_args={
            "check_same_thread": False, "timeout": 10})
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.sessions()
        self.addCleanup(self.db.close)
        self.users, self.agents, self.tokens, self.keys = [], [], [], []
        for index in range(2):
            user = self.new_user(f"resident-{index}")
            agent = Agent(user_id=user.id, name=f"boundary-agent-{index}", persona="local",
                          llm_provider="claude", llm_model="unused", encrypted_api_key="",
                          credit_total=500, credit_spent=0, shell_balance=50)
            self.db.add(agent)
            self.db.flush()
            key = bed_service.issue_key(self.db, user.id, agent.id)
            self.db.commit()
            self.users.append(user)
            self.agents.append(agent)
            self.tokens.append(self.token(user))
            self.keys.append(bed_service.token_string(key, user.username))
        self.admins = [self.new_user(f"admin-{index}", role="admin") for index in range(2)]
        self.admin_tokens = [self.token(user) for user in self.admins]
        self.real_get_assets = assets.get_assets
        self.asset_patch = self.enterContext(patch.object(assets, "get_assets", return_value={
            ASSET_KEY: dict(CAT_ASSET)}))
        self.enterContext(patch.object(M, "SessionLocal", self.sessions))
        self.app = FastAPI()
        for router in (pet.router, pet.asset_router, pet_wishes.router, pet_wishes.admin_router):
            self.app.include_router(router)

        def session():
            with self.sessions() as db:
                yield db
        self.app.dependency_overrides[get_db] = session
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def new_user(self, name, role="resident"):
        user = User(username=f"wish-boundary-{name}", display_name="isolated fixture",
                    hashed_password="unused", role=role)
        self.db.add(user)
        self.db.commit()
        return user

    def token(self, user):
        return auth_service.create_access_token(user.id, user.username, user.role,
                                                auth_version=user.auth_version)

    def request(self, method, path, *, household=0, admin=None, client=None, **kwargs):
        token = self.tokens[household] if admin is None else self.admin_tokens[admin]
        return (client or self.client).request(method, path,
            headers={"Authorization": f"Bearer {token}"}, **kwargs)

    def payload(self, key="original-submission"):
        return {"client_request_id": key, "requested_name": "白襪",
                "requested_species": "cat", "appearance_description": "四隻腳掌有白襪"}

    def create(self, *, key="original-submission", household=0):
        result = self.request("POST", "/api/pet-wishes", household=household,
                              json=self.payload(key))
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def prepare(self, created, *, asset_key=ASSET_KEY):
        wish = created["wish"]
        result = self.request("PATCH", f"/api/admin/pet-wishes/{wish['id']}/preparation",
            admin=0, json={"expected_version": wish["version"], "asset_key": asset_key,
                           "preparation_note": "local preparation fixture"})
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def arrive(self, prepared, *, key="arrival-original", admin=0):
        wish = prepared["wish"]
        return self.request("POST", f"/api/admin/pet-wishes/{wish['id']}/arrive", admin=admin,
            json={"client_request_id": key, "expected_version": wish["version"]})

    def error(self, result, code, status=409):
        self.assertEqual(result.status_code, status, result.text)
        self.assertEqual(result.json()["detail"]["code"], code, result.text)

    def capacity(self, value, *, maximum=1, active=0, reserved=1):
        expected = dict(max_pets=maximum, active_pets=active, reserved_pets=reserved,
                        occupied_pets=active + reserved,
                        available_slots=max(0, maximum - active - reserved))
        expected.update(can_adopt=expected["available_slots"] > 0,
                        can_wish=expected["available_slots"] > 0)
        self.assertEqual(value, expected)

    def mcp(self, action, *, household=0, **kwargs):
        context = SimpleNamespace(headers={"authorization": f"Bearer {self.keys[household]}"})
        tool = M.mcp._tool_manager.get_tool("pet")
        return json.loads(asyncio.run(tool.run({"action": action, **kwargs}, context=context)))

    def ordinary_adopt(self, *, client=None):
        return self.request("POST", "/api/pets/adopt", client=client,
                            json={"name": "普通領養", "asset_key": ASSET_KEY})

    def assert_stored_occupancy(self, total=1):
        self.db.expire_all()
        active = self.db.query(Pet).filter_by(agent_id=self.agents[0].id, is_alive=True).count()
        reserved = self.db.query(PetWish).filter(PetWish.agent_id == self.agents[0].id,
                                                PetWish.status.in_(("pending", "preparing"))).count()
        self.assertEqual(active + reserved, total)
        return active, reserved

    def test_pending_and_preparing_hold_slot_for_both_ordinary_entrypoints(self):
        created = self.create()
        for status in ("pending", "preparing"):
            stage = created if status == "pending" else self.prepare(created)
            with self.subTest(status=stage["wish"]["status"]):
                self.assertEqual(stage["wish"]["status"], status)
                self.capacity(stage["capacity"])
                self.assertEqual(self.db.query(Pet).count(), 0)
                self.assertEqual(self.ordinary_adopt().status_code, 400)
                result = self.mcp("adopt", name="mcp-reservation-contender", asset_key=ASSET_KEY)
                self.assertFalse(result["success"], result)
                other_wish = self.request("POST", "/api/pet-wishes", json=self.payload("second"))
                self.error(other_wish, "pet_capacity_unavailable")
                self.assert_stored_occupancy()
        self.assertEqual(self.db.query(Mail).count(), 0)

    def test_concurrent_same_submission_key_returns_one_immutable_receipt(self):
        start = threading.Barrier(2, timeout=10)

        def submit(_):
            with TestClient(self.app) as client:
                start.wait()
                return self.request("POST", "/api/pet-wishes", client=client, json=self.payload())
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(submit, (0, 1)))
        self.assertEqual(sorted(response.status_code for response in responses), [200, 201],
                         [response.text for response in responses])
        self.assertEqual(responses[0].json()["receipt"], responses[1].json()["receipt"])
        self.assertEqual(responses[0].json()["wish"]["id"], responses[1].json()["wish"]["id"])
        self.assertEqual(self.db.query(PetWish).count(), 1)
        self.assertEqual(self.db.query(Pet).count(), 0)
        self.assert_stored_occupancy()

    def _three_entrypoint_race(self):
        start = threading.Barrier(3, timeout=10)

        def wish():
            with TestClient(self.app) as client:
                start.wait()
                result = self.request("POST", "/api/pet-wishes", client=client,
                                      json=self.payload("concurrent-wish"))
                self.assertIn(result.status_code, (201, 409), result.text)
                if result.status_code == 409:
                    self.error(result, "pet_capacity_unavailable")
                return result.status_code == 201

        def rest():
            with TestClient(self.app) as client:
                start.wait()
                result = self.ordinary_adopt(client=client)
                self.assertIn(result.status_code, (201, 400), result.text)
                return result.status_code == 201

        def mcp():
            start.wait()
            result = self.mcp("adopt", name="mcp-concurrent", asset_key=ASSET_KEY)
            return result["success"]

        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = [pool.submit(callback) for callback in (wish, rest, mcp)]
            outcomes = [future.result(timeout=20) for future in futures]
        self.assertEqual(sum(outcomes), 1, outcomes)
        self.assert_stored_occupancy()
        listed = self.request("GET", "/api/pet-wishes")
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(listed.json()["capacity"]["occupied_pets"], 1)
        self.assertEqual(listed.json()["capacity"]["available_slots"], 0)

    def test_wish_rest_and_mcp_compete_for_original_500_credit_slot(self):
        self._three_entrypoint_race()
        self.db.refresh(self.agents[0])
        self.assertEqual((self.agents[0].credit_total, self.agents[0].shell_balance), (500, 50))

    def test_wish_rest_and_mcp_compete_for_low_credit_exception_slot(self):
        self.agents[0].credit_total = 2
        self.db.add(PetEntitlement(agent_id=self.agents[0].id, minimum_slots=1,
                                   reason="isolated boundary fixture"))
        self.db.commit()
        self._three_entrypoint_race()
        self.db.refresh(self.agents[0])
        self.assertEqual((self.agents[0].credit_total, self.agents[0].shell_balance), (2, 50))

    def test_arrival_replaces_reservation_even_after_credit_falls_to_zero(self):
        prepared = self.prepare(self.create())
        self.capacity(prepared["capacity"])
        self.agents[0].credit_total = 0
        self.db.commit()
        before = datetime.now(timezone.utc)
        arrived = self.arrive(prepared)
        self.assertEqual(arrived.status_code, 200, arrived.text)
        body = arrived.json()
        self.capacity(body["capacity"], maximum=0, active=1, reserved=0)
        self.assertEqual(body["wish"]["status"], "arrived")
        self.assert_stored_occupancy()
        pet = self.db.get(Pet, body["wish"]["pet_id"])
        self.assertEqual((pet.agent_id, pet.name, pet.asset_key),
                         (self.agents[0].id, "白襪", ASSET_KEY))
        born = pet.born_at.replace(tzinfo=timezone.utc) if pet.born_at.tzinfo is None else pet.born_at
        self.assertGreaterEqual(born, before)
        self.assertLessEqual(born, datetime.now(timezone.utc))
        self.assertEqual(self.db.query(Mail).filter_by(to_agent_id=self.agents[0].id,
                                                     mail_type="system").count(), 1)
        self.db.refresh(self.agents[0])
        self.assertEqual((self.agents[0].credit_total, self.agents[0].shell_balance), (0, 50))

    def test_parallel_different_administrators_and_keys_create_one_pet_and_one_mail(self):
        prepared = self.prepare(self.create())
        start = threading.Barrier(2, timeout=10)

        def confirm(index):
            with TestClient(self.app) as client:
                start.wait()
                return self.request("POST", f"/api/admin/pet-wishes/{prepared['wish']['id']}/arrive",
                    client=client, admin=index, json={"client_request_id": f"parallel-admin-{index}",
                                                     "expected_version": prepared["wish"]["version"]})
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(confirm, (0, 1)))
        for response in results:
            self.assertEqual(response.status_code, 200, response.text)
            self.capacity(response.json()["capacity"], active=1, reserved=0)
        self.assertEqual(results[0].json()["wish"]["pet_id"], results[1].json()["wish"]["pet_id"])
        self.assertEqual(self.db.query(Pet).count(), 1)
        self.assertEqual(self.db.query(Mail).count(), 1)
        self.assert_stored_occupancy()

    def test_original_create_receipt_remains_immutable_after_arrival(self):
        created = self.create()
        prepared = self.prepare(created)
        arrived = self.arrive(prepared)
        self.assertEqual(arrived.status_code, 200, arrived.text)
        lookup = self.request("GET", "/api/pet-wishes/by-request/original-submission")
        retry = self.request("POST", "/api/pet-wishes", json=self.payload())
        for response in (lookup, retry):
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["receipt"], created["receipt"])
            self.assertIsNone(response.json()["receipt"]["pet_id"])
            self.assertEqual(response.json()["wish"]["status"], "arrived")
            self.assertEqual(response.json()["wish"]["pet_id"], arrived.json()["wish"]["pet_id"])
        changed = self.payload()
        changed["appearance_description"] = "changed after accepted"
        self.error(self.request("POST", "/api/pet-wishes", json=changed), "idempotency_conflict")
        self.assertEqual(self.db.query(Pet).count(), 1)
        self.assertEqual(self.db.query(Mail).count(), 1)

    def test_dead_arrived_pet_does_not_reopen_wish_or_allow_terminal_patch(self):
        prepared = self.prepare(self.create())
        first = self.arrive(prepared)
        self.assertEqual(first.status_code, 200, first.text)
        wish = first.json()["wish"]
        pet = self.db.get(Pet, wish["pet_id"])
        pet.is_alive, pet.died_at = False, datetime.now(timezone.utc)
        self.db.commit()
        for key, admin in (("arrival-original", 0), ("new-key-after-death", 1)):
            retry = self.arrive(prepared, key=key, admin=admin)
            self.assertEqual(retry.status_code, 200, retry.text)
            self.assertEqual(retry.json()["wish"]["pet_id"], pet.id)
            self.capacity(retry.json()["capacity"], active=0, reserved=0)
        changed = self.request("PATCH", f"/api/admin/pet-wishes/{wish['id']}/preparation", admin=0,
            json={"expected_version": wish["version"], "asset_key": None, "preparation_note": "reopen"})
        self.error(changed, "invalid_transition")
        self.db.refresh(pet)
        self.assertFalse(pet.is_alive)
        self.assertEqual(self.db.query(Pet).count(), 1)
        self.assertEqual(self.db.query(Mail).count(), 1)

    def _assert_fulfillment_review_keeps_reservation(self, prepared):
        response = self.arrive(prepared)
        self.error(response, "fulfillment_review_required")
        self.db.expire_all()
        wish = self.db.get(PetWish, prepared["wish"]["id"])
        self.assertEqual(wish.status, "preparing")
        self.assertIsNone(wish.pet_id)
        self.assertEqual(wish.agent_id, self.agents[0].id)
        self.assertEqual(wish.user_id, self.users[0].id)
        self.assertEqual(self.db.query(Pet).count(), 0)
        self.assertEqual(self.db.query(Mail).count(), 0)
        self.assert_stored_occupancy()
        shown = self.request("GET", f"/api/admin/pet-wishes/{wish.id}", admin=0)
        self.assertEqual(shown.status_code, 200, shown.text)
        self.assertTrue(shown.json()["wish"]["fulfillment_issue"])

    def test_disabled_resident_holds_reservation_without_fulfilling(self):
        prepared = self.prepare(self.create())
        self.users[0].is_active = False
        self.db.commit()
        self._assert_fulfillment_review_keeps_reservation(prepared)

    def test_rebound_agent_cannot_transfer_original_residents_reservation(self):
        prepared = self.prepare(self.create())
        replacement_owner = self.new_user("replacement-owner")
        self.agents[0].user_id = replacement_owner.id
        self.db.commit()
        self._assert_fulfillment_review_keeps_reservation(prepared)

    def test_original_submission_can_be_acknowledged_after_agent_binding_changes(self):
        created = self.create()
        replacement_owner = self.new_user("receipt-replacement-owner")
        self.agents[0].user_id = replacement_owner.id
        self.db.commit()
        for response in (self.request("GET", "/api/pet-wishes/by-request/original-submission"),
                         self.request("POST", "/api/pet-wishes", json=self.payload())):
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["receipt"], created["receipt"])
            self.assertEqual(response.json()["wish"]["status"], "pending")
            self.assertEqual(response.json()["wish"]["fulfillment_issue"], "fulfillment_review_required")
        self.assertEqual(self.db.query(PetWish).count(), 1)
        self.assertEqual(self.db.query(Pet).count(), 0)

    def test_new_get_routes_do_not_tick_neglected_pet_or_write_any_data(self):
        self.agents[0].credit_total = 1000
        old = datetime.now(timezone.utc) - timedelta(days=20)
        pet = Pet(agent_id=self.agents[0].id, name="old untouched pet", species="legacy",
                  emoji="🐾", born_at=old, last_tick_at=old, lifespan_days=100,
                  hunger=3, cleanliness=4, happiness=5, health=4)
        self.db.add(pet)
        self.db.commit()
        created = self.create()
        wish_id = created["wish"]["id"]
        with sqlite3.connect(self.path) as conn:
            before = list(conn.iterdump())
        routes = [("/api/pet-assets", None), ("/api/pet-wishes", None),
                  (f"/api/pet-wishes/{wish_id}", None),
                  ("/api/pet-wishes/by-request/original-submission", None),
                  ("/api/admin/pet-wishes", 0), (f"/api/admin/pet-wishes/{wish_id}", 0)]
        with patch.object(pet_service, "tick", side_effect=AssertionError("GET must be read-only")):
            for path, admin in routes:
                with self.subTest(path=path):
                    response = self.request("GET", path, admin=admin)
                    self.assertEqual(response.status_code, 200, response.text)
        with sqlite3.connect(self.path) as conn:
            self.assertEqual(list(conn.iterdump()), before)
        self.db.refresh(pet)
        self.assertTrue(pet.is_alive)
        self.assertEqual((pet.hunger, pet.cleanliness, pet.happiness), (3, 4, 5))
        self.assertEqual(self.db.query(Mail).count(), 0)

    def test_request_lookup_is_scoped_to_original_user_and_not_public_resource_id(self):
        created = self.create()
        self.error(self.request("GET", f"/api/pet-wishes/{created['wish']['id']}", household=1),
                   "wish_not_found", 404)
        self.error(self.request("GET", "/api/pet-wishes/by-request/original-submission", household=1),
                   "submission_not_found", 404)
        own = self.create(household=1)
        self.assertNotEqual(own["wish"]["id"], created["wish"]["id"])
        looked_up = self.request("GET", "/api/pet-wishes/by-request/original-submission", household=1)
        self.assertEqual(looked_up.json()["wish"]["id"], own["wish"]["id"])
        self.assertNotIn("preparation_note", looked_up.json()["wish"])

    def test_default_empty_catalog_does_not_allow_arbitrary_ordinary_species(self):
        self.asset_patch.return_value = {}
        catalog = self.request("GET", "/api/pet-assets")
        self.assertEqual(catalog.status_code, 200, catalog.text)
        self.assertEqual(catalog.json()["items"], [])
        response = self.request("POST", "/api/pets/adopt",
            json={"name": "unpublished", "species": "unpublished-dragon", "emoji": "🐉"})
        self.assertEqual(response.status_code, 400, response.text)
        result = self.mcp("adopt", name="unpublished", species="unpublished-dragon", emoji="🐉")
        self.assertFalse(result["success"], result)
        self.assertEqual(self.ordinary_adopt().status_code, 400)
        self.assertEqual(self.db.query(Pet).count(), 0)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_false_asset_keys_and_untrusted_urls_cannot_be_published_via_apis(self):
        created = self.create()
        wish = created["wish"]
        for value in (False, "https://invalid.example/pet.png", "/tmp/fixture.png"):
            with self.subTest(asset_key=value):
                result = self.request("PATCH", f"/api/admin/pet-wishes/{wish['id']}/preparation", admin=0,
                    json={"expected_version": wish["version"], "asset_key": value, "preparation_note": ""})
                self.assertIn(result.status_code, (409, 422), result.text)
                if result.status_code == 409:
                    self.error(result, "asset_unavailable")
        result = self.request("PATCH", f"/api/admin/pet-wishes/{wish['id']}/preparation", admin=0,
            json={"expected_version": wish["version"], "asset_key": ASSET_KEY,
                  "preparation_note": "", "image_url": "https://invalid.example/pet.png"})
        self.assertEqual(result.status_code, 422, result.text)
        for body in ({"name": "invalid", "asset_key": False},
                     {"name": "invalid", "asset_key": "https://invalid.example/pet.png"}):
            response = self.request("POST", "/api/pets/adopt", household=1, json=body)
            self.assertIn(response.status_code, (400, 422), response.text)
        self.db.expire_all()
        self.assertEqual(self.db.get(PetWish, wish["id"]).status, "pending")
        self.assertEqual(self.db.query(Pet).count(), 0)

    def test_real_registry_unpublished_flag_and_untrusted_paths_cannot_authorize_arrival(self):
        from services import pet_assets
        created = self.create()
        fixture_path = Path(self.temp.name) / "registry.json"
        self.asset_patch.side_effect = self.real_get_assets

        def registry(published, image_url):
            fixture_path.write_text(json.dumps({"schema_version": 1, "catalog_version": "fixture",
                "assets": [{**CAT_ASSET, "published": published, "image_url": image_url}]}), encoding="utf-8")

        with patch.object(pet_assets, "REGISTRY_PATH", fixture_path):
            for published in (False, 1, "true"):
                with self.subTest(published=published):
                    registry(published, CAT_ASSET["image_url"])
                    self.assertEqual(pet_assets.get_assets(), {})
                    self.assertEqual(self.request("GET", "/api/pet-assets").json()["items"], [])
                    result = self.request("PATCH", f"/api/admin/pet-wishes/{created['wish']['id']}/preparation",
                        admin=0, json={"expected_version": 1, "asset_key": ASSET_KEY, "preparation_note": ""})
                    self.error(result, "asset_unavailable")
            registry(True, CAT_ASSET["image_url"])
            prepared = self.prepare(created)
            for path in ("https://invalid.example/cat.png", "/tmp/cat.png", "/assets/pets/../cat.png",
                         "/assets/pets/cat.svg", "//invalid.example/cat.png"):
                with self.subTest(path=path):
                    registry(True, path)
                    with self.assertRaises(ValueError):
                        pet_assets.get_assets()
                    self.error(self.arrive(prepared, key="invalid-registry-arrival"), "asset_unavailable")
            registry(True, CAT_ASSET["image_url"])
            arrived = self.arrive(prepared, key="invalid-registry-arrival")
            self.assertEqual(arrived.status_code, 200, arrived.text)
        self.assertEqual(self.db.query(Pet).count(), 1)
        self.assertEqual(self.db.query(Mail).count(), 1)

    def _migration(self, path):
        migration = Path(__file__).resolve().parents[1] / "migrations/026_pet_wishes.py"
        spec = importlib.util.spec_from_file_location("boundary_pet_migration_026", migration)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.main(str(path))

    def test_migration_from_previous_schema_preserves_pet_credit_and_fractional_stock(self):
        self.agents[0].credit_total = 499
        self.agents[0].credit_spent = 17
        self.db.add(Pet(agent_id=self.agents[0].id, name="legacy pet", species="legacy species",
                        emoji="🐾", hunger=37, cleanliness=42, happiness=61, health=47,
                        lifespan_days=150))
        self.db.add(GardenStock(owner_key=f"agent:{self.agents[0].id}", crop_id="cucumber",
                                 household_id=self.users[0].id, quantity_numerator="100000000000000000001",
                                 quantity_denominator="3"))
        self.db.commit()
        old_path = Path(self.temp.name) / "previous-schema.db"
        with sqlite3.connect(self.path) as source, sqlite3.connect(old_path) as conn:
            source.backup(conn)
            conn.execute("DROP TABLE pet_wish_receipts")
            conn.execute("DROP TABLE pet_wishes")
            conn.execute("ALTER TABLE pets DROP COLUMN asset_key")
            conn.commit()
            old_pet_columns = [r[1] for r in conn.execute("PRAGMA table_info(pets)")]
            projection = ",".join(old_pet_columns)
            old_pets = conn.execute(f"SELECT {projection} FROM pets ORDER BY id").fetchall()
            old_agents = conn.execute("SELECT * FROM agents ORDER BY id").fetchall()
            old_stock = conn.execute("SELECT * FROM garden_stock ORDER BY owner_key,crop_id").fetchall()
        self._migration(old_path)
        self._migration(old_path)
        with sqlite3.connect(old_path) as conn:
            self.assertEqual(conn.execute(f"SELECT {projection} FROM pets ORDER BY id").fetchall(), old_pets)
            self.assertEqual(conn.execute("SELECT * FROM agents ORDER BY id").fetchall(), old_agents)
            self.assertEqual(conn.execute("SELECT * FROM garden_stock ORDER BY owner_key,crop_id").fetchall(), old_stock)
            self.assertEqual(conn.execute("SELECT asset_key FROM pets").fetchall(), [(None,)])
            self.assertEqual(conn.execute("SELECT count(*) FROM pet_wishes").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT count(*) FROM pet_wish_receipts").fetchone()[0], 0)
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_migration_rerun_preserves_fulfilled_wish_receipts_and_notification(self):
        prepared = self.prepare(self.create())
        response = self.arrive(prepared)
        self.assertEqual(response.status_code, 200, response.text)
        copy_path = Path(self.temp.name) / "fulfilled-copy.db"
        with sqlite3.connect(self.path) as source, sqlite3.connect(copy_path) as conn:
            source.backup(conn)
            before = list(conn.iterdump())
        self._migration(copy_path)
        self._migration(copy_path)
        with sqlite3.connect(copy_path) as conn:
            self.assertEqual(list(conn.iterdump()), before)
            self.assertEqual(conn.execute("SELECT status,pet_id FROM pet_wishes").fetchone(),
                             ("arrived", response.json()["wish"]["pet_id"]))
            self.assertEqual(conn.execute("SELECT count(*) FROM mails").fetchone()[0], 1)
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main()
