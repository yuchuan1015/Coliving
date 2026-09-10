"""Final independent review: cross-request public epochs and terminal bookkeeping."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from fractions import Fraction
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from database import Base
import models  # register the application's real metadata
from models.agent import Agent
from models.user import User
from models.garden import GardenLedger, GardenStock
from services import garden_catalog, garden_engine, garden_service as G


START = datetime(2026, 1, 1, tzinfo=timezone.utc)


def add_days(at, days):
    return at + timedelta(microseconds=math.ceil(Fraction(str(days)) * garden_engine.DAY_US / 7))


class GardenFinalReviewTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="garden-review-")
        self.addCleanup(temporary.cleanup)
        engine = create_engine(f"sqlite:///{Path(temporary.name) / 'review.sqlite'}")
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        self.sessions = sessionmaker(bind=engine, expire_on_commit=False)
        self.db = self.sessions()
        self.addCleanup(lambda: self.db.close())
        self.users, self.agents = [], []
        for index in range(2):
            user = User(username=f"review-{index}", display_name=f"review-{index}",
                        birth_year=1990, hashed_password="isolated-fixture-no-login")
            self.db.add(user)
            self.db.flush()
            agent = Agent(user_id=user.id, name=f"review-agent-{index}", persona="fixture",
                          llm_provider="claude", llm_model="fixture", encrypted_api_key="")
            self.db.add(agent)
            self.db.flush()
            self.users.append(G.GardenActor("user", user.id, user.id))
            self.agents.append(G.GardenActor("agent", agent.id, user.id))
        self.db.commit()
        self.now = START
        for target, replacement in (("_now", lambda: self.now),):
            mocked = patch.object(G, target, side_effect=replacement)
            mocked.start()
            self.addCleanup(mocked.stop)
        for target, result in (("_season_factor", Fraction(1)), ("_random_draw", 1.0)):
            mocked = patch.object(garden_engine, target, return_value=result)
            mocked.start()
            self.addCleanup(mocked.stop)

    def short_crop(self, crop_id, offsets, end_behavior="production_complete"):
        original = garden_catalog.get_crop(crop_id)
        original["harvest"].update(maturity_offsets_days=offsets,
                                   yield_g_per_plot_by_batch=[200] * len(offsets),
                                   clock="independent", end_behavior=end_behavior,
                                   repeat_cycle_days=0)
        def fixture(requested):
            return deepcopy(original) if requested == crop_id else garden_catalog.get_crop(requested)
        mocked = patch.object(garden_engine, "get_crop", side_effect=fixture)
        mocked.start()
        self.addCleanup(mocked.stop)

    def mutate(self, actor, action, *, plot_id="public:1", **kwargs):
        kwargs.setdefault("request_id", str(uuid.uuid4()))
        return G.mutate(self.db, actor, plot_id=plot_id, action=action, **kwargs)

    def public_plant(self, crop_id):
        public = G.get_public(self.db, self.users[0])["plots"][0]
        self.mutate(self.users[0], "vote", vote_id=public["vote"]["id"], crop_id=crop_id)
        self.now = START + timedelta(hours=12)
        result = G.get_public(self.db, self.users[0])["plots"][0]
        return result["planting"]["planting_id"], self.now

    def stock(self, actor, crop_id):
        row = self.db.get(GardenStock, (actor.key, crop_id))
        return Fraction(row.quantity_numerator + "/" + row.quantity_denominator) if row else Fraction(0)

    def test_same_tick_snapshot_survives_restart_and_defers_new_contributor(self):
        self.short_crop("cucumber", [0.7, 1.4, 2.1])
        planting_id, planted_at = self.public_plant("cucumber")
        first_request = "one-contribution-before-first-maturity"
        self.mutate(self.users[0], "water", planting_id=planting_id, request_id=first_request)
        self.mutate(self.agents[0], "care", planting_id=planting_id)
        self.now = add_days(planted_at, "0.7")
        G.get_public(self.db, self.users[0])
        self.assertEqual(self.stock(self.users[0], "cucumber"), 8000)
        self.assertEqual(self.stock(self.agents[0], "cucumber"), 8000)
        self.db.close()
        self.db = self.sessions()  # contributor snapshot must survive the request/session
        self.mutate(self.users[1], "water", planting_id=planting_id)
        self.mutate(self.users[0], "water", planting_id=planting_id, request_id=first_request)
        self.now = add_days(planted_at, "1.4")
        G.get_public(self.db, self.users[1])
        self.assertEqual(self.stock(self.users[0], "cucumber"), 16000)
        self.assertEqual(self.stock(self.agents[0], "cucumber"), 16000)
        self.assertEqual(self.stock(self.users[1], "cucumber"), 0)
        self.now = add_days(planted_at, "2.1")
        G.get_public(self.db, self.users[1])
        self.assertEqual(self.stock(self.users[1], "cucumber"), 16000)
        self.assertEqual(sum(self.stock(actor, "cucumber") for actor in self.users + self.agents), 48000)
        rows = self.db.scalars(select(GardenLedger).where(GardenLedger.kind == "public_share")).all()
        self.assertEqual(len(rows), 5)

    def test_unattended_completed_public_crop_opens_vote_at_actual_completion(self):
        self.short_crop("water_spinach", [1])
        _, planted_at = self.public_plant("water_spinach")
        completed_at = add_days(planted_at, 1)
        self.now = completed_at + timedelta(hours=2)
        result = G.get_public(self.db, self.users[0])["plots"][0]
        vote = result["vote"]
        self.assertIsNone(result["planting"])
        self.assertEqual(datetime.fromisoformat(vote["opened_at"]), completed_at)
        closes_at = completed_at + timedelta(hours=12)
        self.assertEqual(datetime.fromisoformat(vote["closes_at"]), closes_at)
        self.assertNotIn("water_spinach", vote["candidates"])
        self.now = closes_at - timedelta(microseconds=1)
        self.mutate(self.users[0], "vote", vote_id=vote["id"], crop_id="daikon")
        self.now = closes_at
        with self.assertRaises(G.GardenError) as rejected:
            self.mutate(self.users[1], "vote", vote_id=vote["id"], crop_id="carrot")
        self.assertEqual(rejected.exception.code, "stale_vote")
        new = G.get_public(self.db, self.users[0])["plots"][0]["planting"]
        self.assertEqual(new["crop_id"], "daikon")
        self.assertEqual(datetime.fromisoformat(new["planted_at"]), closes_at)

    def test_joint_clear_records_only_unclaimed_loss_and_preserves_stolen_stock(self):
        self.short_crop("cucumber", [1, 20])
        plot_id = G.get_private(self.db, self.users[0])["plots"][0]["id"]
        planted = self.mutate(self.agents[0], "plant", plot_id=plot_id, crop_id="cucumber")
        planting_id = planted["plot"]["planting"]["planting_id"]
        self.now = add_days(START, 1)
        ready = G.get_private(self.db, self.users[0])["plots"][0]
        batch_id = next(iter(ready["planting"]["batches"]))
        self.mutate(self.users[0], "steal", plot_id=plot_id, planting_id=planting_id, batch_id=batch_id)
        proposed = self.mutate(self.agents[0], "propose_clear", plot_id=plot_id,
                               planting_id=planting_id, reason="換一種作物")
        proposal_id = proposed["proposal_id"]
        self.mutate(self.users[0], "consent_clear", plot_id=plot_id, planting_id=planting_id, proposal_id=proposal_id)
        self.assertEqual(self.stock(self.users[0], "cucumber"), 100)
        self.assertEqual(G.get_progress(self.db, self.users[0])["completed_count"], 0)
        entries = self.db.scalars(select(GardenLedger).where(GardenLedger.batch_id == batch_id)).all()
        self.assertEqual({entry.kind for entry in entries}, {"steal", "clear_loss"})
        self.assertEqual(sum(Fraction(entry.quantity_numerator + "/" + entry.quantity_denominator) for entry in entries), 200)
        self.mutate(self.agents[0], "plant", plot_id=plot_id, crop_id="daikon")
        with self.assertRaises(G.GardenError) as rejected:
            self.mutate(self.users[0], "consent_clear", plot_id=plot_id,
                        planting_id=planting_id, proposal_id=proposal_id)
        self.assertEqual(rejected.exception.code, "stale_planting")

    def test_living_completed_private_crop_advertises_the_care_that_service_accepts(self):
        self.short_crop("water_spinach", [1])
        plot_id = G.get_private(self.db, self.users[0])["plots"][0]["id"]
        planted = self.mutate(self.agents[0], "plant", plot_id=plot_id, crop_id="water_spinach")
        planting_id = planted["plot"]["planting"]["planting_id"]
        self.now = add_days(START, 1)
        ready = G.get_private(self.db, self.agents[0])["plots"][0]
        batch_id = next(iter(ready["planting"]["batches"]))
        harvested = self.mutate(self.agents[0], "harvest", plot_id=plot_id, planting_id=planting_id, batch_id=batch_id)
        self.assertEqual(harvested["plot"]["planting"]["status"], "production_complete")
        self.assertIn("care", harvested["plot"]["allowed_actions"])
        user_view = G.get_private(self.db, self.users[0])["plots"][0]
        self.assertIn("water", user_view["allowed_actions"])
        self.assertNotIn("plant", harvested["plot"]["allowed_actions"])
        self.assertNotIn("clear_dead_crop", harvested["plot"]["allowed_actions"])
        self.mutate(self.agents[0], "care", plot_id=plot_id, planting_id=planting_id)
        self.mutate(self.users[0], "water", plot_id=plot_id, planting_id=planting_id)


if __name__ == "__main__":
    unittest.main()
