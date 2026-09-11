"""Public pet-tool targeting and settlement using independent local fixtures."""
import asyncio
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import models
import mcp_server as M
from database import Base
from models.activity_log import ActivityLog
from models.agent import Agent
from models.mail import Mail
from models.pet import Pet
from models.pet_entitlement import PetEntitlement
from models.user import User
from services import bed_service, pet_service


class PetMcpTargetingTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="pet-mcp-targeting-")
        self.addCleanup(temp.cleanup)
        self.engine = create_engine(f"sqlite:///{Path(temp.name) / 'pets.db'}")
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.agent_ids, self.tokens = [], []
        with self.sessions() as db:
            for index in range(2):
                user = User(username=f"targeting-fixture-{index}", display_name="local fixture",
                            hashed_password="unused")
                db.add(user)
                db.flush()
                agent = Agent(user_id=user.id, name=f"targeting-agent-{index}", persona="fixture",
                              llm_provider="claude", llm_model="unused", encrypted_api_key="",
                              credit_total=2, credit_spent=0, shell_balance=0)
                db.add(agent)
                db.flush()
                key = bed_service.issue_key(db, user.id, agent.id)
                self.agent_ids.append(agent.id)
                self.tokens.append(bed_service.token_string(key, user.username))
            db.commit()
        self.enterContext(patch.object(M, "SessionLocal", self.sessions))

    def call(self, action, household=0, **kwargs):
        context = SimpleNamespace(headers={"authorization": f"Bearer {self.tokens[household]}"})
        tool = M.mcp._tool_manager.get_tool("pet")
        return json.loads(asyncio.run(tool.run({"action": action, **kwargs}, context=context)))

    def add_pet(self, name="同名", *, household=0, alive=True, expired=False):
        now = datetime.now(timezone.utc)
        with self.sessions() as db:
            pet = Pet(agent_id=self.agent_ids[household], name=name, species="cat", emoji="🐈",
                      hunger=40, cleanliness=50, happiness=60, health=50,
                      is_alive=alive, lifespan_days=90,
                      born_at=now - timedelta(days=91 if expired else 1),
                      last_tick_at=now - timedelta(hours=1 if expired else 0),
                      died_at=None if alive else now)
            db.add(pet)
            db.commit()
            return pet.id

    def pet_state(self, pet_id):
        with self.sessions() as db:
            pet = db.get(Pet, pet_id)
            return {"id": pet.id, "hunger": pet.hunger, "cleanliness": pet.cleanliness,
                    "is_alive": pet.is_alive, "last_tick_at": pet.last_tick_at}

    def snapshot(self):
        with self.sessions() as db:
            return (db.execute(select(Pet.__table__).order_by(Pet.id)).all(),
                    db.query(ActivityLog).count(), db.query(Mail).count())

    def set_credit(self, amount):
        with self.sessions() as db:
            db.get(Agent, self.agent_ids[0]).credit_total = amount
            db.commit()

    def grant(self):
        with self.sessions() as db:
            db.add(PetEntitlement(agent_id=self.agent_ids[0], minimum_slots=1,
                                   reason="isolated fixture", granted_at=datetime.now(timezone.utc)))
            db.commit()

    def test_legacy_name_targets_live_pet_after_same_name_dead_pet(self):
        dead = self.add_pet(alive=False)
        live = self.add_pet()
        before_dead = self.pet_state(dead)
        result = self.call("interact", pet_name="同名", act="feed")
        self.assertTrue(result["success"], result)
        self.assertEqual(result["pet"]["id"], live)
        self.assertEqual(self.pet_state(live)["hunger"], 80)
        self.assertEqual(self.pet_state(dead), before_dead)

    def test_two_live_names_require_id_without_changing_either_pet(self):
        self.add_pet()
        self.add_pet()
        before = self.snapshot()
        result = self.call("interact", pet_name="同名", act="feed")
        self.assertFalse(result["success"], result)
        self.assertIn("pet_id", result["error"])
        self.assertEqual(self.snapshot(), before)

    def test_id_alone_selects_exact_pet_and_overrides_conflicting_name(self):
        first = self.add_pet()
        second = self.add_pet()
        before_first = self.pet_state(first)
        result = self.call("interact", pet_id=second, act="feed")
        self.assertTrue(result["success"], result)
        self.assertEqual(result["pet"]["id"], second)
        again = self.call("interact", pet_id=second, pet_name="不存在的名字", act="clean")
        self.assertTrue(again["success"], again)
        self.assertEqual(self.pet_state(second)["hunger"], 80)
        self.assertEqual(self.pet_state(second)["cleanliness"], 90)
        self.assertEqual(self.pet_state(first), before_first)

    def test_foreign_missing_and_empty_ids_never_fall_back_to_own_name(self):
        self.add_pet()
        foreign = self.add_pet(household=1)
        before = self.snapshot()
        for pet_id in (foreign, "not-a-pet-id", ""):
            with self.subTest(pet_id=pet_id):
                result = self.call("interact", pet_id=pet_id, pet_name="同名", act="feed")
                self.assertFalse(result["success"], result)
                self.assertEqual(self.snapshot(), before)

    def test_dead_id_does_not_fall_back_to_live_namesake(self):
        dead = self.add_pet(alive=False)
        self.add_pet()
        before = self.snapshot()
        result = self.call("interact", pet_id=dead, pet_name="同名", act="feed")
        self.assertFalse(result["success"], result)
        self.assertIn("不在", result["error"])
        self.assertEqual(self.snapshot(), before)

    def test_dead_only_or_unknown_name_is_not_operable(self):
        self.add_pet(alive=False)
        before = self.snapshot()
        for name in ("同名", "不存在"):
            result = self.call("interact", pet_name=name, act="feed")
            self.assertFalse(result["success"], result)
        self.assertEqual(self.snapshot(), before)

    def test_my_pets_reports_zero_and_exception_capacity_with_old_messages(self):
        denied = self.call("my_pets")
        self.assertTrue(denied["success"], denied)
        self.assertEqual((denied["pets"], denied["max_pets"]), ([], 0))
        self.assertIn("信用不足", denied["message"])
        self.grant()
        empty = self.call("my_pets")
        self.assertEqual((empty["pets"], empty["max_pets"]), ([], 1))
        self.assertIn("領養", empty["message"])
        adopted = self.call("adopt", name="例外寵物", species="cat", emoji="🐈")
        self.assertTrue(adopted["success"], adopted)
        populated = self.call("my_pets")
        self.assertEqual(populated["max_pets"], 1)
        self.assertEqual([pet["id"] for pet in populated["pets"]], [adopted["pet"]["id"]])

    def test_my_pets_reports_ordinary_credit_capacity_when_populated(self):
        self.add_pet()
        for credit, expected in ((500, 1), (1000, 2)):
            with self.subTest(credit=credit):
                self.set_credit(credit)
                result = self.call("my_pets")
                self.assertTrue(result["success"], result)
                self.assertEqual(result["max_pets"], expected)
                self.assertEqual(len(result["pets"]), 1)

    def test_death_discovered_during_interaction_commits_once(self):
        expired = self.add_pet(expired=True)
        first = self.call("interact", pet_id=expired, act="feed")
        self.assertFalse(first["success"], first)
        self.assertFalse(self.pet_state(expired)["is_alive"])
        before_retry = self.snapshot()
        self.assertEqual(before_retry[1:], (1, 1))
        again = self.call("interact", pet_id=expired, act="feed")
        self.assertFalse(again["success"], again)
        self.assertEqual(self.snapshot(), before_retry)

    def test_mcp_adoption_rejects_empty_and_overlength_fields(self):
        self.grant()
        valid = {"name": "local-pet", "species": "cat", "emoji": "🐈"}
        cases = [{}]
        for field, maximum in (("name", 64), ("species", 64), ("emoji", 8)):
            for value in ("", " \t\u3000", "x" * (maximum + 1)):
                cases.append({**valid, field: value})
        before = self.snapshot()
        for values in cases:
            with self.subTest(values=values):
                result = self.call("adopt", **values)
                self.assertFalse(result["success"], result)
                self.assertEqual(self.snapshot(), before)

    def test_adoption_status_settlement_is_committed_before_response(self):
        self.grant()
        later = datetime.now(timezone.utc) + timedelta(hours=2)
        with patch.object(pet_service, "datetime") as clock, \
             patch.object(pet_service._rng, "random", return_value=1.0):
            clock.now.return_value = later
            result = self.call("adopt", name="delayed-status", species="cat", emoji="🐈")
        self.assertTrue(result["success"], result)
        self.assertLess(result["pet"]["hunger"], 100)
        saved = self.pet_state(result["pet"]["id"])
        self.assertEqual(round(saved["hunger"], 1), result["pet"]["hunger"])
        self.assertEqual(saved["last_tick_at"].replace(tzinfo=timezone.utc), later)
