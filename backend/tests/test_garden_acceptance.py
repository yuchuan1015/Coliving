"""Tier-one executable acceptance: real service transactions and simulated server time.

All twelve lifecycle tests use the unmodified handoff crop cards and real growth,
care, theft and harvest. Only the explicitly named boundary fixtures substitute
small schedules/yields; no lifecycle is satisfied by injecting mature batches.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from fractions import Fraction
import json
import tempfile
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
from database import Base
from models.agent import Agent
from models.user import User
from services import garden_catalog, garden_engine, garden_service as garden


CONTRACT = json.loads((garden_catalog.DATA_DIR / "acceptance.json").read_text(encoding="utf-8"))
CROPS = {crop["id"]: crop for crop in garden_catalog.list_crops()}
DAY = Fraction(86400)


def real_seconds(cultivation_days):
    return Fraction(str(cultivation_days)) * DAY / 7


def duration(seconds):
    """Round up to the first representable microsecond at/after a threshold."""
    value = Fraction(seconds) * 1_000_000
    return timedelta(microseconds=-(-value.numerator // value.denominator))


def fraction(value):
    return Fraction(str(value))


class GardenServiceFixture(unittest.TestCase):
    """One on-disk SQLite database per test; no real environment or network."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="garden-acceptance-")
        self.addCleanup(self.temp.cleanup)
        self.engine = create_engine(
            f"sqlite:///{self.temp.name}/garden.db",
            connect_args={"check_same_thread": False, "timeout": 20},
        )
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.sessions()
        self.addCleanup(self.db.close)
        self.now = datetime(2026, 9, 11, 0, 0, tzinfo=timezone.utc)
        self.request_number = 0
        self.households = []
        for index in range(2):
            user = User(username=f"garden-user-{index}", display_name="fixture",
                        hashed_password="not-a-credential", timezone="Asia/Taipei")
            self.db.add(user)
            self.db.flush()
            agent = Agent(user_id=user.id, name=f"garden-agent-{index}", persona="fixture",
                          llm_provider="claude", llm_model="unused", encrypted_api_key="")
            self.db.add(agent)
            self.db.flush()
            self.households.append((user, agent))
        self.db.commit()
        self.user = garden.actor_for_user(self.db, self.households[0][0].id)
        self.agent = garden.actor_for_agent(self.db, self.households[0][0].id)
        self.other_user = garden.actor_for_user(self.db, self.households[1][0].id)
        self.other_agent = garden.actor_for_agent(self.db, self.households[1][0].id)
        self.addCleanup(patch.stopall)
        patch.object(garden.time_service, "now_utc", side_effect=lambda: self.now).start()
        self._install_normal_conditions()
        self.plot_id = garden.get_private(self.db, self.user)["plots"][0]["id"]

    def _install_normal_conditions(self):
        """Controlled preferred season and no random hazard; care remains real."""
        # The garden engine exposes these deterministic clock/random boundaries.
        self.season = patch.object(garden_engine, "_season_factor", return_value=Fraction(1)).start()
        self.draw = patch.object(garden_engine, "_random_draw", return_value=1.0).start()

    def request_id(self, prefix="action"):
        self.request_number += 1
        return f"{prefix}-{self.request_number}"

    def do(self, actor, action, *, plot_id=None, request_id=None, **kwargs):
        return garden.mutate(self.db, actor, plot_id=plot_id or self.plot_id,
                             action=action, request_id=request_id or self.request_id(action), **kwargs)

    def view(self, plot_id=None, actor=None, public=False):
        result = (garden.get_public(self.db, actor or self.user) if public
                  else garden.get_private(self.db, actor or self.user))
        return next(plot for plot in result["plots"] if plot["id"] == (plot_id or self.plot_id))

    def state(self, **kwargs):
        return self.view(**kwargs)["planting"]

    def plant(self, crop_id, *, plot_id=None):
        self.do(self.agent, "plant", plot_id=plot_id, crop_id=crop_id)
        return self.state(plot_id=plot_id)

    def balance(self, crop_id, owner="user", actor=None, db=None):
        result = garden.get_inventory(db or self.db, actor or self.user, owner=owner, limit=100, offset=0)
        return sum((fraction(item["quantity_g"]) for item in result["items"]
                    if item["crop_id"] == crop_id), Fraction())

    def completed(self, actor=None):
        return set(garden.get_progress(self.db, actor or self.user)["completed_crop_ids"])

    def maintain_until(self, target, *, plot_id=None, public=False, caretaker=None):
        """Replay real six-hour care, keeping the final threshold unrounded."""
        self.assertGreaterEqual(target, self.now)
        plot_id = plot_id or self.plot_id
        caretaker = caretaker or self.agent
        while self.now < target:
            previous = self.state(plot_id=plot_id, public=public)
            if previous:
                origin = datetime.fromisoformat(previous["planted_at"])
                next_tick = origin + timedelta(hours=6 * (previous["last_care_tick"] + 1))
                self.assertGreater(next_tick, self.now, "Normal-care crop unexpectedly stopped advancing")
                self.now = min(next_tick, target)
            else:
                self.now = target
            current = self.state(plot_id=plot_id, public=public)
            if current and current["status"] not in {"dead", "empty", "production_complete", "substrate_spent"}:
                self.do(caretaker, "care", plot_id=plot_id, planting_id=current["planting_id"])
        return self.state(plot_id=plot_id, public=public)

    def mature_first(self, crop_id, *, plot_id=None):
        planted = self.plant(crop_id, plot_id=plot_id)
        planted_at = self.now
        ready_at = planted_at + duration(real_seconds(CROPS[crop_id]["timing"]["first_harvest_days"]))
        self.maintain_until(ready_at, plot_id=plot_id)
        return self.state(plot_id=plot_id), planted_at

    @staticmethod
    def batch(state, batch_index=0, cycle_index=0):
        return next(batch for batch in state["batches"].values()
                    if batch["batch_index"] == batch_index and batch["cycle_index"] == cycle_index)

    def assert_rejected(self, actor, action, **kwargs):
        with self.assertRaises(garden.GardenError) as raised:
            self.do(actor, action, **kwargs)
        self.assertIn(raised.exception.status_code, (400, 401, 403, 404, 409, 422))
        return raised.exception

    def boundary_crop(self, crop_id="water_spinach", *, yields=(200, 200), offsets=(1, 2),
                      clock="after_harvest", end="production_complete", repeat_days=0):
        """Small game values for shared edge cases, with real engine maturation."""
        original = garden_catalog.get_crop
        def get_crop(requested):
            card = deepcopy(original(requested))
            if requested == crop_id:
                card["care"]["preferred_months"] = list(range(1, 13))
                card["timing"] = {"nursery_days": 0, "growing_days_to_first": offsets[0],
                                  "first_harvest_days": offsets[0]}
                card["harvest"].update({"maturity_offsets_days": list(offsets),
                                        "yield_g_per_plot_by_batch": list(yields),
                                        "clock": clock, "end_behavior": end,
                                        "repeat_cycle_days": repeat_days})
                card["harvest"].pop("first_cycle_yield_factor", None)
                card["harvest"].pop("first_cycle_yield_factors_by_batch", None)
            return card
        patcher = patch.object(garden_engine, "get_crop", side_effect=get_crop)
        patcher.start()
        self.addCleanup(patcher.stop)
        return crop_id


class GardenLifecycleAcceptance(GardenServiceFixture):
    def run_lifecycle(self, contract):
        crop_id = contract["crop_id"]
        card = CROPS[crop_id]
        harvest = card["harvest"]
        state = self.plant(crop_id)
        planting_id = state["planting_id"]
        planted_at = self.now
        self.assertEqual(self.balance(crop_id), 0)
        self.assertEqual(self.balance(crop_id, "agent"), 0)
        self.assertNotIn(crop_id, self.completed())
        first_at = planted_at + duration(Fraction(contract["nominal_first_maturity_real_seconds_exact"]))
        self.maintain_until(first_at - timedelta(microseconds=1))
        state = self.state()
        self.assertFalse(state["batches"], "No mature batch before the exact cultivation threshold")
        self.assert_rejected(self.user, "steal", planting_id=planting_id, batch_id=f"{planting_id}:0:0")
        self.assert_rejected(self.agent, "harvest", planting_id=planting_id, batch_id=f"{planting_id}:0:0")
        total = Fraction()
        previous_harvest_at = None
        old_batch_ids = set()
        offsets = harvest["maturity_offsets_days"]
        for index, nominal in enumerate(harvest["yield_g_per_plot_by_batch"]):
            if index == 0 or harvest["clock"] == "independent":
                ready_at = planted_at + duration(real_seconds(offsets[index]))
            else:
                ready_at = previous_harvest_at + duration(real_seconds(Fraction(str(offsets[index])) - Fraction(str(offsets[index-1]))))
            self.maintain_until(ready_at)
            state = self.state()
            self.assertTrue(any(b["batch_index"] == index for b in state["batches"].values()),
                            f"{crop_id} batch {index} at {self.now.isoformat()}: " + str(state))
            batch = self.batch(state, index)
            batch_id = batch["id"]
            self.assertNotIn(batch_id, old_batch_ids)
            self.assertEqual(batch["cycle_index"], 0)
            factors = harvest.get("first_cycle_yield_factors_by_batch")
            factor = Fraction(str(factors[index] if factors else harvest.get("first_cycle_yield_factor", 1)))
            expected_yield = 2 * (Fraction(nominal) * factor // 2)
            self.assertEqual(fraction(batch["yield_g"]), expected_yield, crop_id)
            self.assertEqual(fraction(batch["remaining_g"]), expected_yield)
            self.assertEqual(state["health"], 100)
            before_user, before_agent = self.balance(crop_id), self.balance(crop_id, "agent")
            steal_request = self.request_id("steal")
            self.do(self.user, "steal", request_id=steal_request, planting_id=planting_id, batch_id=batch_id)
            self.assertEqual(self.balance(crop_id), before_user + expected_yield / 2)
            self.assertEqual(self.balance(crop_id, "agent"), before_agent)
            if index == 0:
                self.assertNotIn(crop_id, self.completed(), "Theft alone cannot unlock a crop")
            self.do(self.user, "steal", request_id=steal_request, planting_id=planting_id, batch_id=batch_id)
            self.assert_rejected(self.user, "steal", planting_id=planting_id, batch_id=batch_id)
            self.assertEqual(self.balance(crop_id), before_user + expected_yield / 2)
            harvest_request = self.request_id("harvest")
            self.do(self.agent, "harvest", request_id=harvest_request, planting_id=planting_id, batch_id=batch_id)
            self.assertEqual(self.balance(crop_id, "agent"), before_agent + expected_yield / 2)
            self.assertIn(crop_id, self.completed())
            self.do(self.agent, "harvest", request_id=harvest_request, planting_id=planting_id, batch_id=batch_id)
            self.assertEqual(self.balance(crop_id, "agent"), before_agent + expected_yield / 2)
            old_batch_ids.add(batch_id)
            previous_harvest_at = self.now
            total += expected_yield
        self.assertEqual(total, contract["first_production_cycle_total_g"])
        self.assertEqual(self.balance(crop_id) + self.balance(crop_id, "agent"), total)
        self.assertEqual(self.completed(), {crop_id}, "Repeated batches count as one distinct crop")
        self.assertEqual(garden.get_progress(self.db, self.user)["unlocked_tier"], 1)
        current = self.state()
        if contract["end_behavior"] == "empty":
            self.assertTrue(current is None or current["status"] == "empty")
        elif contract["end_behavior"] == "repeat_perennial_cycle":
            self.assertIsNotNone(current)
            self.assertNotEqual(current["status"], "dead")
            self.assertEqual(current["planting_id"], planting_id)
            next_at = planted_at + duration(real_seconds(contract["perennial_expectation"]["next_cycle_first_maturity_cultivation_day"]))
            self.maintain_until(next_at - timedelta(microseconds=1))
            self.assertFalse(any(batch["cycle_index"] == 1 for batch in self.state()["batches"].values()))
            self.maintain_until(next_at)
            new_batch = self.batch(self.state(), 0, 1)
            self.assertEqual(fraction(new_batch["yield_g"]), 314)
            self.assertNotIn(new_batch["id"], old_batch_ids)
            self.do(self.user, "steal", planting_id=planting_id, batch_id=new_batch["id"])
            self.do(self.agent, "harvest", planting_id=planting_id, batch_id=new_batch["id"])
            self.assertEqual(self.balance(crop_id) + self.balance(crop_id, "agent"), total + 314)
        else:
            self.assertEqual(current["status"], "production_complete")
            self.assertEqual(current["terminal_reason"], contract["end_behavior"])
            self.assertGreater(current["health"], 0, "Finite production exhaustion must not be labelled disease death")


def _lifecycle_method(contract):
    def test(self):
        self.run_lifecycle(contract)
    test.__doc__ = f"Execute every batch of {contract['crop_id']} from planting to durable stock."
    return test


for _contract in CONTRACT["crop_lifecycles"]:
    setattr(GardenLifecycleAcceptance, "test_" + _contract["id"], _lifecycle_method(_contract))


class GardenSharedAcceptance(GardenServiceFixture):
    def start_public(self, crop_id="water_spinach", *, area_m2=6):
        from models.garden import GardenWorld
        public = garden.get_public(self.db, self.user)["plots"][0]
        world = self.db.get(GardenWorld, 1)
        world.public_productive_area_m2 = area_m2
        self.db.commit()
        self.do(self.user, "vote", plot_id=public["id"], vote_id=public["vote"]["id"], crop_id=crop_id)
        self.now += timedelta(hours=12)
        garden.tick_all(self.db)
        public = self.view(plot_id=public["id"], public=True)
        self.assertEqual(public["planting"]["crop_id"], crop_id)
        return public["id"], public["planting"]["planting_id"], self.now

    def edit_state(self, plot_id, transform):
        from models.garden import GardenPlot
        row = self.db.get(GardenPlot, plot_id)
        state = json.loads(row.state_json)
        transform(state)
        row.state_json = json.dumps(state)
        self.db.commit()

    def test_harvest_wins_race(self):
        self.boundary_crop()
        state = self.plant("water_spinach")
        self.maintain_until(self.now + duration(real_seconds(1)))
        batch = self.batch(self.state())
        self.do(self.agent, "harvest", planting_id=state["planting_id"], batch_id=batch["id"])
        self.assert_rejected(self.user, "steal", planting_id=state["planting_id"], batch_id=batch["id"])
        self.assertEqual(self.balance("water_spinach", "agent"), 200)
        self.assertEqual(self.balance("water_spinach"), 0)

    def test_theft_wins_race_and_after_harvest_clock_waits_for_actual_harvest(self):
        self.boundary_crop()
        state = self.plant("water_spinach")
        self.maintain_until(self.now + duration(real_seconds(1)))
        batch = self.batch(self.state())
        self.do(self.user, "steal", planting_id=state["planting_id"], batch_id=batch["id"])
        self.assertEqual(self.balance("water_spinach"), 100)
        self.assertEqual(self.balance("water_spinach", "agent"), 0)
        self.maintain_until(self.now + duration(real_seconds(3)))
        self.assertEqual(len(self.state()["batches"]), 1, "Stealing must not start regrowth")
        harvested_at = self.now
        self.do(self.agent, "harvest", planting_id=state["planting_id"], batch_id=batch["id"])
        self.assertEqual(self.balance("water_spinach", "agent"), 100)
        self.maintain_until(harvested_at + duration(real_seconds(1)) - timedelta(microseconds=1))
        self.assertEqual(len(self.state()["batches"]), 1)
        self.maintain_until(harvested_at + duration(real_seconds(1)))
        new_batch = self.batch(self.state(), 1)
        self.assertNotEqual(new_batch["id"], batch["id"])
        self.do(self.user, "steal", planting_id=state["planting_id"], batch_id=new_batch["id"])
        self.assertEqual(self.balance("water_spinach"), 200)

    def test_independent_batches_mature_without_old_harvest_and_never_merge_theft_rights(self):
        self.boundary_crop("cucumber", offsets=(1, 2), clock="independent")
        state = self.plant("cucumber")
        started = self.now
        self.maintain_until(started + duration(real_seconds(1)))
        first = self.batch(self.state())
        self.do(self.user, "steal", planting_id=state["planting_id"], batch_id=first["id"])
        self.maintain_until(started + duration(real_seconds(2)))
        current = self.state()
        second = self.batch(current, 1)
        self.assertEqual(len(current["batches"]), 2)
        self.assertEqual(fraction(self.batch(current)["remaining_g"]), 100)
        self.assertNotEqual(first["id"], second["id"])
        self.assert_rejected(self.user, "steal", planting_id=state["planting_id"], batch_id=first["id"])
        self.do(self.user, "steal", planting_id=state["planting_id"], batch_id=second["id"])
        self.assertEqual(self.balance("cucumber"), 200)
        self.assertEqual(self.balance("cucumber", "agent"), 0)

    def test_public_identity_split_uses_exact_equal_fractions_and_retry_is_free(self):
        self.boundary_crop()
        plot_id, planting_id, started = self.start_public()
        for _ in range(3):
            self.do(self.user, "water", plot_id=plot_id, planting_id=planting_id)
        request = self.request_id("public-care")
        self.do(self.agent, "care", plot_id=plot_id, planting_id=planting_id, request_id=request)
        self.do(self.agent, "care", plot_id=plot_id, planting_id=planting_id, request_id=request)
        self.do(self.other_user, "water", plot_id=plot_id, planting_id=planting_id)
        self.now = started + duration(real_seconds(1))
        garden.tick_all(self.db)
        for actor, owner in [(self.user, "user"), (self.user, "agent"), (self.other_user, "user")]:
            self.assertEqual(self.balance("water_spinach", owner, actor), Fraction(200, 3))
            self.assertNotIn("water_spinach", self.completed(actor))
        garden.tick_all(self.db)
        self.assertEqual(self.balance("water_spinach"), Fraction(200, 3))
        self.assertEqual(self.balance("water_spinach", "agent", self.other_user), 0)

    def test_public_contributors_reset_after_each_harvest_epoch(self):
        self.boundary_crop()
        plot_id, planting_id, started = self.start_public()
        self.do(self.user, "water", plot_id=plot_id, planting_id=planting_id)
        self.now = started + duration(real_seconds(1))
        garden.tick_all(self.db)
        self.assertEqual(self.balance("water_spinach"), 200)
        self.do(self.other_agent, "care", plot_id=plot_id, planting_id=planting_id)
        self.now += duration(real_seconds(1))
        garden.tick_all(self.db)
        self.assertEqual(self.balance("water_spinach"), 200)
        self.assertEqual(self.balance("water_spinach", "agent", self.other_user), 200)
        self.assertEqual(self.balance("water_spinach", "agent"), 0)

    def test_public_simultaneous_batches_share_original_contributors(self):
        self.boundary_crop("cucumber", offsets=(1, 1.5), clock="independent")
        plot_id, planting_id, started = self.start_public("cucumber")
        for actor in (self.user, self.agent, self.other_user):
            self.do(actor, "water", plot_id=plot_id, planting_id=planting_id)
        self.now = started + duration(real_seconds(1.5))
        garden.tick_all(self.db)
        for actor, owner in [(self.user, "user"), (self.user, "agent"), (self.other_user, "user")]:
            self.assertEqual(self.balance("cucumber", owner, actor), Fraction(400, 3))
        garden.tick_all(self.db)
        self.assertEqual(self.balance("cucumber"), Fraction(400, 3))

    def test_public_no_contributors_records_unallocated_loss(self):
        from models.garden import GardenLedger
        self.boundary_crop()
        plot_id, planting_id, started = self.start_public()
        self.now = started + duration(real_seconds(1))
        garden.tick_all(self.db)
        self.assertEqual(self.balance("water_spinach"), 0)
        self.assertEqual(self.balance("water_spinach", "agent"), 0)
        self.assertFalse(self.completed())
        losses = self.db.query(GardenLedger).filter(GardenLedger.planting_id == planting_id).all()
        self.assertTrue(losses, "A system harvest with no contributor needs a durable loss ledger entry")
        self.assertEqual(sum((Fraction(int(row.quantity_numerator), int(row.quantity_denominator))
                              for row in losses if row.kind == "unallocated_loss"), Fraction()), 200)

    def test_public_stale_view_water_records_both_identities_without_overwatering(self):
        self.boundary_crop()
        plot_id, planting_id, _ = self.start_public()
        self.edit_state(plot_id, lambda state: state.update(moisture=30))
        self.do(self.user, "water", plot_id=plot_id, planting_id=planting_id)
        self.do(self.other_user, "water", plot_id=plot_id, planting_id=planting_id)
        current = self.state(plot_id=plot_id, public=True)
        self.assertEqual(current["moisture"], 80)
        self.now += duration(real_seconds(1))
        garden.tick_all(self.db)
        self.assertEqual(self.balance("water_spinach"), 100)
        self.assertEqual(self.balance("water_spinach", actor=self.other_user), 100)

    def test_private_user_permissions_and_other_household_access(self):
        private = garden.get_private(self.db, self.user)["plots"]
        self.assertEqual(len(private), 4)
        self.assertEqual(len({plot["id"] for plot in private}), 4)
        for action in ("plant", "care", "harvest", "fertilize", "pest_control"):
            self.assert_rejected(self.user, action, crop_id="daikon")
        state = self.plant("daikon")
        self.do(self.user, "water", planting_id=state["planting_id"])
        for actor in (self.other_user, self.other_agent):
            self.assert_rejected(actor, "water", planting_id=state["planting_id"])
            self.assert_rejected(actor, "propose_clear", planting_id=state["planting_id"], reason="other household")
        self.assertEqual(self.state()["planting_id"], state["planting_id"])
        self.assertEqual(self.balance("daikon"), 0)

    def test_disabled_actor_cannot_start_or_continue_garden_actions(self):
        self.households[0][0].is_active = False
        self.db.commit()
        with self.assertRaises(garden.GardenError):
            garden.actor_for_user(self.db, self.households[0][0].id)
        with self.assertRaises(garden.GardenError):
            garden.actor_for_agent(self.db, self.households[0][0].id)
        self.assert_rejected(self.agent, "plant", crop_id="daikon")

    def test_vote_tie_deadline_is_twelve_real_hours_and_latest_sequence_wins(self):
        public = garden.get_public(self.db, self.user)["plots"][0]
        vote_id = public["vote"]["id"]
        started = self.now
        # Both calls intentionally have the same timestamp; server order is decisive.
        self.do(self.user, "vote", plot_id=public["id"], vote_id=vote_id, crop_id="daikon")
        self.do(self.agent, "vote", plot_id=public["id"], vote_id=vote_id, crop_id="carrot")
        self.assert_rejected(self.agent, "vote", plot_id=public["id"], vote_id=vote_id, crop_id="daikon")
        self.now = started + timedelta(hours=12) - timedelta(microseconds=1)
        self.assertIsNone(self.state(plot_id=public["id"], public=True))
        self.now = started + timedelta(hours=12)
        garden.tick_all(self.db)
        selected = self.state(plot_id=public["id"], public=True)
        self.assertEqual(selected["crop_id"], "carrot")
        self.assert_rejected(self.other_user, "vote", plot_id=public["id"], vote_id=vote_id, crop_id="daikon")

    def test_vote_empty_persists_one_fallback_without_refresh_redraw(self):
        public = garden.get_public(self.db, self.user)["plots"][0]
        self.now += timedelta(hours=12)
        garden.tick_all(self.db)
        chosen = self.state(plot_id=public["id"], public=True)
        self.assertIn(chosen["crop_id"], CROPS)
        for _ in range(4):
            garden.tick_all(self.db)
            current = self.state(plot_id=public["id"], public=True)
            self.assertEqual(current["planting_id"], chosen["planting_id"])
            self.assertEqual(current["crop_id"], chosen["crop_id"])

    def test_clear_consent_scope_and_revoked_proposals_cannot_clear_new_planting(self):
        first = self.plant("water_spinach")
        proposal = self.do(self.agent, "propose_clear", planting_id=first["planting_id"], reason="replace initial planting")
        self.do(self.user, "consent_clear", planting_id=first["planting_id"], proposal_id=proposal["proposal_id"])
        second = self.plant("water_spinach")
        self.assertNotEqual(first["planting_id"], second["planting_id"])
        self.assert_rejected(self.user, "consent_clear", planting_id=first["planting_id"], proposal_id=proposal["proposal_id"])
        self.assert_rejected(self.user, "consent_clear", planting_id=second["planting_id"], proposal_id=proposal["proposal_id"])
        current_proposal = self.do(self.agent, "propose_clear", planting_id=second["planting_id"], reason="new scoped request")
        self.do(self.agent, "revoke_clear", planting_id=second["planting_id"], proposal_id=current_proposal["proposal_id"])
        self.assert_rejected(self.user, "consent_clear", planting_id=second["planting_id"], proposal_id=current_proposal["proposal_id"])
        self.assertEqual(self.state()["planting_id"], second["planting_id"])

    def test_public_lifecycle_votes_only_after_final_finite_batch(self):
        self.boundary_crop()
        plot_id, planting_id, started = self.start_public()
        self.do(self.user, "water", plot_id=plot_id, planting_id=planting_id)
        self.now = started + duration(real_seconds(1))
        garden.tick_all(self.db)
        current = self.view(plot_id=plot_id, public=True)
        self.assertEqual(current["planting"]["planting_id"], planting_id)
        self.assertIsNone(current["vote"])
        self.now += duration(real_seconds(1))
        garden.tick_all(self.db)
        current = self.view(plot_id=plot_id, public=True)
        self.assertIsNone(current["planting"])
        self.assertIsNotNone(current["vote"])
        self.assert_rejected(self.user, "water", plot_id=plot_id, planting_id=planting_id)

    def test_public_perennial_cycle_keeps_same_planting_without_vote(self):
        self.boundary_crop("vegetable_fern", offsets=(1, 2), clock="independent",
                           end="repeat_perennial_cycle", repeat_days=2)
        plot_id, planting_id, started = self.start_public("vegetable_fern")
        for days in (1, 2, 3):
            self.do(self.user, "water", plot_id=plot_id, planting_id=planting_id)
            self.now = started + duration(real_seconds(days))
            garden.tick_all(self.db)
            current = self.view(plot_id=plot_id, public=True)
            self.assertEqual(current["planting"]["planting_id"], planting_id)
            self.assertIsNone(current["vote"])
        self.assertEqual(self.balance("vegetable_fern"), 600)
        self.assertNotIn("vegetable_fern", self.completed())

    def test_random_problem_refresh_and_retry_do_not_redraw_or_move_clock(self):
        state = self.plant("daikon")
        self.draw.reset_mock()
        self.now += timedelta(hours=6)
        current = self.state()
        draws = self.draw.call_count
        self.assertGreater(draws, 0)
        for _ in range(5):
            self.assertEqual(self.state(), current)
            garden.tick_all(self.db)
        self.assertEqual(self.draw.call_count, draws)
        request = self.request_id("care")
        self.do(self.agent, "care", planting_id=state["planting_id"], request_id=request)
        after_care = self.state()
        self.do(self.agent, "care", planting_id=state["planting_id"], request_id=request)
        self.assertEqual(self.state(), after_care)
        self.assertEqual(self.draw.call_count, draws)

    def test_no_fertilizer_speed_exploit_and_health_upper_bound(self):
        state = self.plant("daikon")
        self.do(self.agent, "care", planting_id=state["planting_id"])
        before = self.state()
        for _ in range(20):
            self.do(self.agent, "care", planting_id=state["planting_id"])
        after = self.state()
        self.assertEqual(after, before, "Same-time care cannot add growth or healing")
        self.assertEqual(after["health"], 100)
        self.now += timedelta(hours=6)
        self.do(self.agent, "care", planting_id=state["planting_id"])
        self.assertEqual(self.state()["health"], 100)

    def test_plant_failure_keeps_credited_stock_and_closes_future(self):
        self.boundary_crop("vegetable_fern", offsets=(1, 2), clock="independent",
                           end="repeat_perennial_cycle", repeat_days=2)
        state = self.plant("vegetable_fern")
        self.maintain_until(self.now + duration(real_seconds(1)))
        batch = self.batch(self.state())
        self.do(self.user, "steal", planting_id=state["planting_id"], batch_id=batch["id"])
        self.assertEqual(self.balance("vegetable_fern"), 100)
        self.edit_state(self.plot_id, lambda current: current.update(health=0))
        self.now += timedelta(hours=6)
        garden.tick_all(self.db)
        failed = self.state()
        self.assertEqual(failed["status"], "dead")
        self.assertEqual(fraction(self.batch(failed)["remaining_g"]), 0)
        self.assertIsNone(failed["next_due_growth_us"])
        self.assertTrue(failed["all_batches_generated"])
        from models.garden import GardenLedger
        losses = self.db.query(GardenLedger).filter_by(planting_id=state["planting_id"], kind="plant_failure").all()
        self.assertEqual(sum((Fraction(int(row.quantity_numerator), int(row.quantity_denominator))
                              for row in losses), Fraction()), 100)
        self.assertEqual(self.balance("vegetable_fern"), 100)
        self.assertFalse(self.completed())
        self.assert_rejected(self.agent, "harvest", planting_id=state["planting_id"], batch_id=batch["id"])
        failed_batches = deepcopy(failed["batches"])
        self.now += timedelta(days=365)
        garden.tick_all(self.db)
        self.assertEqual(self.state()["batches"], failed_batches)
        self.do(self.agent, "clear_dead_crop", planting_id=state["planting_id"])
        self.assertIsNone(self.state())
        self.assertEqual(self.balance("vegetable_fern"), 100)

    def test_zero_yield_batch_closes_and_after_harvest_clock_continues(self):
        self.boundary_crop(yields=(1, 200), offsets=(1, 2))
        state = self.plant("water_spinach")
        start = self.now
        self.maintain_until(start + duration(real_seconds(1)))
        failed = self.batch(self.state())
        self.assertEqual(fraction(failed["yield_g"]), 0)
        self.assertEqual(fraction(failed["remaining_g"]), 0)
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(self.balance("water_spinach", "agent"), 0)
        self.assertFalse(self.completed())
        self.maintain_until(self.now + duration(real_seconds(1)))
        second = self.batch(self.state(), 1)
        self.assertEqual(fraction(second["yield_g"]), 200)
        self.do(self.agent, "harvest", planting_id=state["planting_id"], batch_id=second["id"])
        self.assertEqual(self.balance("water_spinach", "agent"), 200)
        self.assertIn("water_spinach", self.completed())

    def test_unlock_distinct_twelve_requires_positive_private_agent_harvest(self):
        for index, crop_id in enumerate(CROPS):
            state, _ = self.mature_first(crop_id)
            batch = self.batch(state)
            self.do(self.user, "steal", planting_id=state["planting_id"], batch_id=batch["id"])
            self.assertEqual(len(self.completed()), index)
            self.assertEqual(garden.get_progress(self.db, self.user)["unlocked_tier"], 1)
            self.do(self.agent, "harvest", planting_id=state["planting_id"], batch_id=batch["id"])
            self.assertEqual(len(self.completed()), index + 1)
            current = self.state()
            if current and current["status"] != "empty":
                proposal = self.do(self.agent, "propose_clear", planting_id=current["planting_id"], reason="next acceptance crop")
                self.do(self.user, "consent_clear", planting_id=current["planting_id"], proposal_id=proposal["proposal_id"])
        self.assertEqual(self.completed(), set(CROPS))
        self.assertEqual(garden.get_progress(self.db, self.user)["unlocked_tier"], 2)
        self.assertFalse(self.completed(self.other_user))

    def test_public_split_requests_same_tick_reuse_snapshot_and_new_care_waits_next_epoch(self):
        self.boundary_crop("cucumber", yields=(200, 200, 200), offsets=(1, 1.5, 3), clock="independent")
        plot_id, planting_id, started = self.start_public("cucumber")
        for actor in (self.user, self.agent, self.other_user):
            self.do(actor, "water", plot_id=plot_id, planting_id=planting_id)
        self.now = started + duration(real_seconds(1))
        garden.tick_all(self.db)
        self.assertEqual(self.balance("cucumber"), Fraction(200, 3))
        # This action belongs to the following harvest epoch, not the already
        # settled group whose second independent batch is about to mature.
        self.do(self.other_agent, "care", plot_id=plot_id, planting_id=planting_id)
        self.now = started + duration(real_seconds(1.5))
        garden.tick_all(self.db)
        for actor, owner in [(self.user, "user"), (self.user, "agent"), (self.other_user, "user")]:
            self.assertEqual(self.balance("cucumber", owner, actor), Fraction(400, 3))
        self.assertEqual(self.balance("cucumber", "agent", self.other_user), 0)
        self.now = started + duration(real_seconds(3))
        garden.tick_all(self.db)
        self.assertEqual(self.balance("cucumber", "agent", self.other_user), 200)
        self.assertEqual(self.balance("cucumber"), Fraction(400, 3))

    def rest_client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from routers import garden as router
        from utils.deps import get_current_user, get_db
        app = FastAPI()
        app.include_router(router.router)
        def session():
            with self.sessions() as db:
                yield db
        # Only authentication is supplied by a fixture; real server actor
        # resolution, permissions, transactions and the HTTP adapter all run.
        app.dependency_overrides[get_db] = session
        app.dependency_overrides[get_current_user] = lambda: self.households[0][0]
        client = TestClient(app)
        self.addCleanup(client.close)
        return client

    def test_multi_plot_partial_success_persists_legal_actions_through_real_http(self):
        self.boundary_crop()
        plots = garden.get_private(self.db, self.user)["plots"]
        first = self.plant("daikon", plot_id=plots[0]["id"])
        third = self.plant("water_spinach", plot_id=plots[2]["id"])
        self.maintain_until(self.now + duration(real_seconds(1)), plot_id=plots[2]["id"])
        mature = self.batch(self.state(plot_id=plots[2]["id"]))
        self.edit_state(plots[0]["id"], lambda state: state.update(moisture=30))
        foreign = garden.get_private(self.db, self.other_user)["plots"][0]
        self.do(self.other_agent, "plant", plot_id=foreign["id"], crop_id="daikon")
        foreign_state = self.state(plot_id=foreign["id"], actor=self.other_user)
        commands = [
            {"plot_id": plots[0]["id"], "action": "water", "planting_id": first["planting_id"], "request_id": "multi-water"},
            {"plot_id": plots[1]["id"], "action": "water", "planting_id": "empty-stale-view", "request_id": "multi-empty"},
            {"plot_id": plots[2]["id"], "action": "steal", "planting_id": third["planting_id"], "batch_id": mature["id"], "request_id": "multi-steal"},
            {"plot_id": foreign["id"], "action": "water", "planting_id": foreign_state["planting_id"], "request_id": "multi-foreign"},
        ]
        response = self.rest_client().post("/api/garden/actions", json={"actions": commands})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([result["ok"] for result in response.json()["results"]], [True, False, True, False])
        self.assertEqual(self.state(plot_id=plots[0]["id"])["moisture"], 80)
        self.assertEqual(self.balance("water_spinach"), 100)
        self.assertIsNone(self.state(plot_id=plots[1]["id"]))
        self.assertEqual(self.state(plot_id=foreign["id"], actor=self.other_user), foreign_state)

    def test_actor_spoofing_payload_cannot_obtain_agent_or_foreign_household_through_http(self):
        client = self.rest_client()
        command = {"plot_id": self.plot_id, "action": "plant", "crop_id": "daikon", "request_id": "forged-plant"}
        for field, value in (("role", "agent"), ("household_id", self.other_agent.household_id)):
            response = client.post("/api/garden/actions", json={"actions": [{**command, field: value}]})
            self.assertEqual(response.status_code, 422)
            self.assertIsNone(self.state())
        response = client.post("/api/garden/actions", json={"actions": [command]})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["results"][0]["ok"])
        self.assertEqual(response.json()["results"][0]["error"]["status_code"], 403)
        self.assertIsNone(self.state())
