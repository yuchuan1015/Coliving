"""One active-pet exception: real service/REST/MCP, SQLite contention and migration.

Fixtures are unrelated local accounts. No real resident, external message, SSH
connection, or credit/shell issuance is involved.
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

import models
import mcp_server as M
from database import Base
from models.activity_log import ActivityLog
from models.agent import Agent
from models.credit_log import CreditLog
from models.pet import Pet
from models.pet_entitlement import PetEntitlement
from models.shell_log import ShellLog
from models.user import User
from routers import pet as pet_routes
from services import auth_service, bed_service, pet_service
from utils.deps import get_db


class PetEntitlementTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pet-entitlement-")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "pets.db"
        self.engine = create_engine(f"sqlite:///{self.path}", connect_args={"check_same_thread": False, "timeout": 10})
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.sessions()
        self.addCleanup(self.db.close)
        self.users, self.agents = [], []
        self.access, self.keys = [], []
        for index in range(2):
            user = User(username=f"pet-fixture-{index}", display_name="local fixture", hashed_password="unused")
            self.db.add(user)
            self.db.flush()
            agent = Agent(user_id=user.id, name=f"pet-fixture-agent-{index}", persona="fixture",
                          llm_provider="claude", llm_model="unused", encrypted_api_key="",
                          credit_total=2, credit_spent=0, shell_balance=50)
            self.db.add(agent)
            self.db.flush()
            key = bed_service.issue_key(self.db, user.id, agent.id)
            self.db.commit()
            self.users.append(user)
            self.agents.append(agent)
            self.access.append(auth_service.create_access_token(user.id, user.username, user.role))
            self.keys.append(bed_service.token_string(key, user.username))
        self.enterContext(patch.object(M, "SessionLocal", self.sessions))
        self.app = FastAPI()
        self.app.include_router(pet_routes.router)
        def session():
            with self.sessions() as db:
                yield db
        self.app.dependency_overrides[get_db] = session
        self.client = TestClient(self.app, headers={"Authorization": f"Bearer {self.access[0]}"})
        self.addCleanup(self.client.close)

    def grant(self, agent=None):
        agent = agent or self.agents[0]
        self.db.add(PetEntitlement(agent_id=agent.id, minimum_slots=1,
                                   reason="isolated fixture: one active pet", granted_at=datetime.now(timezone.utc)))
        self.db.commit()

    def adopt(self, name="fixture-pet", agent=None, db=None):
        return pet_service.adopt(db or self.db, agent or self.agents[0], name, "cat", "🐈")

    def mcp(self, action, household=0, **kwargs):
        context = SimpleNamespace(headers={"authorization": f"Bearer {self.keys[household]}"})
        tool = M.mcp._tool_manager.get_tool("pet")
        return json.loads(asyncio.run(tool.run({"action": action, **kwargs}, context=context)))

    def alive_count(self, agent=None):
        return self.db.query(Pet).filter_by(agent_id=(agent or self.agents[0]).id, is_alive=True).count()

    def test_without_exception_zero_and_499_credit_still_cannot_adopt(self):
        for amount in (0, 499):
            self.agents[0].credit_total = amount
            self.db.commit()
            self.assertEqual(pet_service.get_max_pets(self.agents[0]), 0)
            self.assertIsInstance(self.adopt(), str)
            self.db.commit()
            self.assertEqual(self.alive_count(), 0)
        self.assertEqual(self.db.query(PetEntitlement).count(), 0)

    def test_exception_at_two_credit_allows_exactly_one_without_reward_or_automatic_pet(self):
        self.grant()
        self.assertEqual(self.alive_count(), 0)
        self.assertEqual(pet_service.get_max_pets(self.agents[0]), 1)
        first = self.adopt()
        self.assertIsInstance(first, Pet)
        self.db.commit()
        self.assertIsInstance(self.adopt("second"), str)
        self.db.commit()
        self.assertEqual(self.alive_count(), 1)
        self.db.refresh(self.agents[0])
        self.assertEqual((self.agents[0].credit_total, self.agents[0].credit_spent, self.agents[0].shell_balance), (2, 0, 50))
        self.assertEqual(self.db.query(CreditLog).count(), 0)
        self.assertEqual(self.db.query(ShellLog).count(), 0)

    def test_exception_is_minimum_not_additive_at_500_and_1000_credit(self):
        self.grant()
        self.agents[0].credit_total = 500
        self.db.commit()
        self.assertEqual(pet_service.get_max_pets(self.agents[0]), 1)
        self.assertIsInstance(self.adopt("first"), Pet)
        self.db.commit()
        self.assertIsInstance(self.adopt("not-second-at-500"), str)
        self.db.commit()
        self.agents[0].credit_total = 1000
        self.db.commit()
        self.assertEqual(pet_service.get_max_pets(self.agents[0]), 2)
        self.assertIsInstance(self.adopt("second-at-1000"), Pet)
        self.db.commit()
        self.assertIsInstance(self.adopt("not-third"), str)
        self.db.commit()
        self.assertEqual(self.alive_count(), 2)

    def test_ordinary_agents_keep_original_500_and_1000_thresholds(self):
        self.grant()
        ordinary = self.agents[1]
        self.assertEqual(pet_service.get_max_pets(ordinary), 0)
        self.assertIsInstance(self.adopt(agent=ordinary), str)
        self.db.commit()
        ordinary.credit_total = 500
        self.db.commit()
        self.assertEqual(pet_service.get_max_pets(ordinary), 1)
        self.assertIsInstance(self.adopt("ordinary-first", ordinary), Pet)
        self.db.commit()
        self.assertIsInstance(self.adopt("ordinary-second-denied", ordinary), str)
        self.db.commit()
        ordinary.credit_total = 1000
        self.db.commit()
        self.assertEqual(pet_service.get_max_pets(ordinary), 2)
        self.assertIsInstance(self.adopt("ordinary-second", ordinary), Pet)
        self.db.commit()
        self.assertEqual(self.alive_count(ordinary), 2)
        self.assertEqual(self.alive_count(), 0)

    def test_entitlement_follows_agent_id_not_reused_display_name(self):
        self.grant()
        old_name = self.agents[0].name
        self.agents[0].name = "fixture-renamed-original"
        self.db.flush()  # Release the unique name before assigning it to a different ID.
        self.agents[1].name = old_name
        self.db.commit()
        self.assertEqual(pet_service.get_max_pets(self.agents[0]), 1)
        self.assertEqual(pet_service.get_max_pets(self.agents[1]), 0)
        self.assertIsInstance(self.adopt(agent=self.agents[1]), str)
        self.db.commit()
        self.assertEqual(self.db.query(PetEntitlement).one().agent_id, self.agents[0].id)

    def test_exception_is_one_active_slot_and_dead_pet_does_not_consume_it(self):
        self.grant()
        old = self.adopt("first-life")
        self.db.commit()
        old.is_alive = False
        old.died_at = datetime.now(timezone.utc)
        self.db.commit()
        self.assertIsInstance(self.adopt("later-pet"), Pet)
        self.db.commit()
        self.assertEqual(self.alive_count(), 1)
        self.assertEqual(self.db.query(Pet).filter_by(agent_id=self.agents[0].id).count(), 2)

    def test_entitlement_constraint_does_not_allow_extra_two_slot_grant(self):
        self.db.add(PetEntitlement(agent_id=self.agents[0].id, minimum_slots=2,
                                   reason="invalid fixture", granted_at=datetime.now(timezone.utc)))
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()
        self.assertEqual(pet_service.get_max_pets(self.agents[0]), 0)
        self.assertEqual(self.db.query(PetEntitlement).count(), 0)

    def test_rest_list_and_mcp_adopt_share_one_slot_and_second_rest_adoption_is_denied(self):
        self.grant()
        listed = self.client.get("/api/pets")
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(listed.json()["max_pets"], 1)
        self.assertEqual(listed.json()["pets"], [])
        adopted = self.mcp("adopt", name="mcp-first", species="cat", emoji="🐈")
        self.assertTrue(adopted["success"], adopted)
        second = self.client.post("/api/pets/adopt", json={"name": "rest-second", "species": "dog", "emoji": "🐕"})
        self.assertEqual(second.status_code, 400, second.text)
        self.assertEqual(self.alive_count(), 1)
        self.assertEqual(self.client.get("/api/pets").json()["max_pets"], 1)

    def test_rest_adopt_and_mcp_adopt_share_same_quota_in_reverse_order(self):
        self.grant()
        first = self.client.post("/api/pets/adopt", json={"name": "rest-first", "species": "cat", "emoji": "🐈"})
        self.assertEqual(first.status_code, 201, first.text)
        second = self.mcp("adopt", name="mcp-second", species="cat", emoji="🐈")
        self.assertFalse(second["success"], second)
        self.assertEqual(self.alive_count(), 1)
        other = self.mcp("adopt", household=1, name="unentitled", species="cat", emoji="🐈")
        self.assertFalse(other["success"], other)
        other_list = self.client.get("/api/pets", headers={"Authorization": f"Bearer {self.access[1]}"})
        self.assertEqual(other_list.json()["max_pets"], 0)
        self.assertEqual(other_list.json()["pets"], [])

    def test_mcp_empty_status_recognizes_exception_and_revoked_key_cannot_use_it(self):
        from models.mcp_token import McpToken
        self.grant()
        status = self.mcp("my_pets")
        self.assertTrue(status["success"], status)
        self.assertNotIn("信用不足", status.get("message", ""))
        key = self.db.query(McpToken).filter_by(agent_id=self.agents[0].id).one()
        key.revoked_at = datetime.now(timezone.utc)
        self.db.commit()
        result = self.mcp("adopt", name="revoked", species="cat", emoji="🐈")
        self.assertFalse(result["success"], result)
        self.assertEqual(self.alive_count(), 0)

    def _concurrent_adoptions(self):
        start = threading.Barrier(2, timeout=10)
        both_returned = threading.Event()
        count_lock = threading.Lock()
        returned = 0
        target_id = self.agents[0].id
        def worker(index):
            nonlocal returned
            with self.sessions() as db:
                agent = db.get(Agent, target_id)
                start.wait()
                result = self.adopt(f"parallel-{index}", agent, db)
                with count_lock:
                    returned += 1
                    if returned == 2:
                        both_returned.set()
                # If adopt had only counted before acquiring a write lock, both
                # calls could return a new Pet before either caller committed.
                # With the lock, the first transaction commits after this brief
                # wait and the second sees the already occupied slot.
                both_returned.wait(0.2)
                success = isinstance(result, Pet)
                db.commit()
                return success
        with ThreadPoolExecutor(max_workers=2) as executor:
            result = list(executor.map(worker, (0, 1)))
        self.assertEqual(sorted(result), [False, True])
        self.assertEqual(self.alive_count(), 1)

    def test_two_exception_adoptions_cannot_claim_the_same_live_slot(self):
        self.grant()
        self._concurrent_adoptions()
        self.db.refresh(self.agents[0])
        self.assertEqual(self.agents[0].credit_total, 2)

    def test_two_ordinary_500_credit_adoptions_cannot_claim_same_slot(self):
        self.agents[0].credit_total = 500
        self.db.commit()
        self._concurrent_adoptions()

    def test_adoption_remains_uncommitted_and_parent_rollback_removes_pet_and_log(self):
        self.grant()
        adopted = self.adopt("rolled-back")
        self.assertIsInstance(adopted, Pet)
        self.db.flush()
        with self.sessions() as other:
            self.assertEqual(other.query(Pet).count(), 0)
            self.assertEqual(other.query(ActivityLog).filter_by(action="pet_adopt").count(), 0)
        self.db.rollback()
        self.assertEqual(self.db.query(Pet).count(), 0)
        self.assertEqual(self.db.query(ActivityLog).filter_by(action="pet_adopt").count(), 0)
        self.assertEqual(self.db.query(PetEntitlement).count(), 1)
        self.assertIsInstance(self.adopt("after-rollback"), Pet)
        self.db.commit()
        self.assertEqual(self.alive_count(), 1)

    def test_stale_agent_credit_and_disabled_owner_are_rechecked_before_adoption(self):
        self.agents[0].credit_total = 500
        self.db.commit()
        stale = self.agents[0]
        with self.sessions() as other:
            other.get(Agent, stale.id).credit_total = 2
            other.commit()
        self.assertIsInstance(self.adopt(agent=stale), str)
        self.db.rollback()
        self.grant()
        with self.sessions() as other:
            other.get(User, self.users[0].id).is_active = False
            other.commit()
        self.assertIsInstance(self.adopt(agent=stale), str)
        self.db.commit()
        self.assertEqual(self.alive_count(), 0)

    def test_migration_runs_twice_and_preserves_existing_assets_pets_and_grant(self):
        path = Path(__file__).resolve().parents[1] / "migrations" / "025_pet_entitlement.py"
        spec = importlib.util.spec_from_file_location("pet_entitlement_migration", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        old_pet = Pet(agent_id=self.agents[0].id, name="existing", species="cat", emoji="🐈", lifespan_days=123)
        self.db.add(old_pet)
        self.db.commit()
        target = Path(self.temp.name) / "migration-copy.db"
        source = sqlite3.connect(self.path)
        copy = sqlite3.connect(target)
        try:
            source.backup(copy)
            copy.execute("DROP TABLE pet_entitlements")
            copy.commit()
            before_agent = copy.execute("SELECT id,credit_total,credit_spent,shell_balance FROM agents ORDER BY id").fetchall()
            before_pets = copy.execute("SELECT * FROM pets").fetchall()
        finally:
            source.close()
            copy.close()
        migration.main(target)
        migration.main(target)
        with sqlite3.connect(target) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM pet_entitlements").fetchone()[0], 0)
            db.execute("INSERT INTO pet_entitlements (agent_id,minimum_slots,reason,granted_at) VALUES (?,1,?,?)",
                       (self.agents[0].id, "fixture grant", "2026-09-11 00:00:00"))
        migration.main(target)
        with sqlite3.connect(target) as db:
            self.assertEqual(db.execute("SELECT id,credit_total,credit_spent,shell_balance FROM agents ORDER BY id").fetchall(), before_agent)
            self.assertEqual(db.execute("SELECT * FROM pets").fetchall(), before_pets)
            self.assertEqual(db.execute("SELECT agent_id,minimum_slots,reason FROM pet_entitlements").fetchall(),
                             [(self.agents[0].id, 1, "fixture grant")])
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
