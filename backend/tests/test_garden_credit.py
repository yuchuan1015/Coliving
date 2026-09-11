"""Real SQLite checks for public-garden credit limits and transaction ownership."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest

from sqlalchemy import create_engine, event, func, select, update
from sqlalchemy.orm import sessionmaker

from database import Base
import models
from models.agent import Agent
from models.credit_log import CreditLog
from models.garden_credit import GardenCreditDay, GardenCreditSlot, GardenCreditVote
from models.user import User
from services import garden_credit as C


EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)


class GardenCreditTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="garden-credit-")
        self.addCleanup(temporary.cleanup)
        self.engine = create_engine(f"sqlite:///{Path(temporary.name) / 'credit.sqlite'}",
                                    connect_args={"timeout": 15})
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.sessions()
        self.addCleanup(self.db.close)
        self.user = User(username="credit-owner", display_name="owner", birth_year=1990,
                         hashed_password="offline-fixture")
        self.db.add(self.user)
        self.db.flush()
        self.agent = Agent(user_id=self.user.id, name="credit-agent", persona="fixture",
                           llm_provider="claude", llm_model="fixture", encrypted_api_key="",
                           credit_total=0, credit_spent=0, shell_balance=11)
        self.db.add(self.agent)
        self.db.commit()
        self.actor = SimpleNamespace(kind="agent", id=self.agent.id, household_id=self.user.id)

    def award(self, at=EPOCH, action="care", **kwargs):
        with self.db.begin():
            return C.award(self.db, self.actor, scope="public", action=action,
                           epoch_at=EPOCH, now=at, **kwargs)

    def count(self, model):
        with self.sessions() as db:
            return db.scalar(select(func.count()).select_from(model))

    def total(self):
        with self.sessions() as db:
            return db.scalar(select(Agent.credit_total).where(Agent.id == self.actor.id))

    def test_first_care_and_water_share_one_epoch_slot(self):
        self.assertEqual(self.award(), 20)
        self.assertEqual(self.award(EPOCH + timedelta(hours=5, minutes=59), "water"), 0)
        self.assertEqual(self.award(EPOCH + timedelta(hours=6)), 1)
        self.assertEqual(self.total(), 21)
        self.assertEqual(self.count(GardenCreditSlot), 2)
        with self.sessions() as db:
            rows = db.scalars(select(CreditLog).order_by(CreditLog.created_at)).all()
            self.assertEqual([row.amount for row in rows], [20, 1])
            self.assertEqual([row.credit_total_after for row in rows], [20, 21])

    def test_epoch_slot_boundary_uses_microseconds_not_calendar_hour(self):
        epoch = EPOCH + timedelta(minutes=17, microseconds=5)
        before = epoch + timedelta(hours=6) - timedelta(microseconds=1)
        with self.db.begin():
            self.assertEqual(C.award(self.db, self.actor, scope="public", action="care", epoch_at=epoch, now=before), 20)
            self.assertEqual(C.award(self.db, self.actor, scope="public", action="water", epoch_at=epoch,
                                     now=before + timedelta(microseconds=1)), 1)
        self.assertEqual(self.total(), 21)

    def test_five_overlapping_slots_in_one_taipei_day_still_cap_at_four_and_23(self):
        # Taipei Jan 2 contains part of UTC-epoch slots 2, 3, 4, 5 and 6.
        instants = [EPOCH + timedelta(hours=hours) for hours in (16, 18, 24, 30, 36)]
        self.assertEqual([self.award(at) for at in instants], [20, 1, 1, 1, 0])
        self.assertEqual(self.total(), 23)
        self.assertEqual(self.count(GardenCreditSlot), 4)
        with self.sessions() as db:
            day = db.get(GardenCreditDay, (self.actor.id, "2026-01-02"))
            self.assertEqual((day.awarded_slots, day.points_awarded), (4, 23))
        # An unclaimed slot rejected by yesterday's cap may become today's first.
        self.assertEqual(self.award(EPOCH + timedelta(hours=40)), 20)
        self.assertEqual(self.total(), 43)

    def test_midnight_does_not_reaward_an_already_claimed_six_hour_slot(self):
        before = EPOCH + timedelta(hours=16) - timedelta(microseconds=1)
        self.assertEqual(self.award(before), 20)
        self.assertEqual(self.award(before + timedelta(microseconds=1)), 0)
        self.assertEqual(self.award(EPOCH + timedelta(hours=18)), 20)
        self.assertEqual(self.count(GardenCreditDay), 2)
        self.assertEqual(self.total(), 40)

    def test_equivalent_timezone_and_naive_utc_cannot_create_extra_claims(self):
        at = EPOCH + timedelta(hours=6)
        self.assertEqual(self.award(at), 20)
        self.assertEqual(self.award(at.astimezone(timezone(timedelta(hours=8)))), 0)
        self.assertEqual(self.award(at.replace(tzinfo=None)), 0)
        self.assertEqual(self.total(), 20)

    def test_vote_is_once_per_agent_and_vote_and_separate_from_care_cap(self):
        for hours in (16, 18, 24, 30):
            self.award(EPOCH + timedelta(hours=hours))
        at = EPOCH + timedelta(hours=31)
        self.assertEqual(self.award(at, "vote", vote_id="round-1"), 1)
        self.assertEqual(self.award(at, "vote", vote_id="round-1"), 0)
        self.assertEqual(self.award(at + timedelta(days=1), "vote", vote_id="round-1"), 0)
        self.assertEqual(self.award(at + timedelta(days=1), "vote", vote_id="round-2"), 1)
        self.assertEqual(self.total(), 25)
        self.assertEqual(self.count(GardenCreditVote), 2)
        self.assertEqual(self.count(GardenCreditDay), 1)

    def test_humans_private_and_non_reward_actions_do_not_grant_agent_credit(self):
        human = SimpleNamespace(kind="user", id=self.user.id, household_id=self.user.id)
        cases = [(human, "public", action) for action in ("care", "water", "vote")]
        cases += [(self.actor, "private", action) for action in ("care", "water", "vote")]
        cases += [(self.actor, "public", action) for action in ("plant", "harvest", "steal", "propose_clear", "clear_dead_crop")]
        with self.db.begin():
            for actor, scope, action in cases:
                self.assertEqual(C.award(self.db, actor, scope=scope, action=action,
                                         epoch_at=EPOCH, now=EPOCH, vote_id="round"), 0)
        self.assertEqual(self.total(), 0)
        for model in (GardenCreditDay, GardenCreditSlot, GardenCreditVote, CreditLog):
            self.assertEqual(self.count(model), 0)

    def test_inactive_or_mismatched_agent_owner_cannot_receive_credit(self):
        forged = SimpleNamespace(kind="agent", id=self.agent.id, household_id="different-owner")
        with self.db.begin():
            self.assertEqual(C.award(self.db, forged, scope="public", action="care", epoch_at=EPOCH, now=EPOCH), 0)
            self.user.is_active = False
            self.db.flush()
            self.assertEqual(C.award(self.db, self.actor, scope="public", action="care", epoch_at=EPOCH, now=EPOCH), 0)
        self.assertEqual(self.total(), 0)
        self.assertEqual(self.count(GardenCreditSlot), 0)

    def test_atomic_increment_refreshes_stale_identity_without_losing_other_changes(self):
        self.assertEqual(self.agent.credit_total, 0)
        with self.sessions() as another:
            another.execute(update(Agent).where(Agent.id == self.agent.id).values(credit_total=7))
            another.commit()
        with self.db.begin():
            self.agent.persona = "pending persona must survive"
            self.agent.credit_spent = 2
            self.user.display_name = "pending name must survive"
            self.assertEqual(C.award(self.db, self.actor, scope="public", action="care", epoch_at=EPOCH, now=EPOCH), 20)
            self.assertEqual(self.agent.credit_total, 27)
            self.assertEqual(self.agent.persona, "pending persona must survive")
            self.assertEqual(self.agent.credit_spent, 2)
            self.assertEqual(self.agent.shell_balance, 11)
        with self.sessions() as db:
            stored = db.get(Agent, self.agent.id)
            self.assertEqual((stored.credit_total, stored.credit_spent, stored.persona),
                             (27, 2, "pending persona must survive"))
            self.assertEqual(db.get(User, self.user.id).display_name, "pending name must survive")

    def test_duplicate_refreshes_cached_total_after_another_session_awarded(self):
        self.assertEqual(self.agent.credit_total, 0)
        with self.sessions() as another, another.begin():
            self.assertEqual(C.award(another, self.actor, scope="public", action="care", epoch_at=EPOCH, now=EPOCH), 20)
        self.assertEqual(self.award(), 0)
        self.assertEqual(self.agent.credit_total, 20)

    def test_stale_cached_daily_counter_cannot_bypass_the_four_slot_limit(self):
        self.assertEqual(self.award(EPOCH + timedelta(hours=16)), 20)
        cached = self.db.get(GardenCreditDay, (self.actor.id, "2026-01-02"))
        self.db.commit()
        self.assertEqual(cached.awarded_slots, 1)
        for hour in (18, 24, 30):
            with self.sessions() as another, another.begin():
                self.assertEqual(C.award(another, self.actor, scope="public", action="care",
                                         epoch_at=EPOCH, now=EPOCH + timedelta(hours=hour)), 1)
        self.assertEqual(cached.awarded_slots, 1)
        self.assertEqual(self.award(EPOCH + timedelta(hours=36)), 0)
        self.assertEqual(cached.awarded_slots, 4)
        self.assertEqual(self.total(), 23)

    def test_outer_failure_rolls_back_credit_claim_log_and_other_action_changes(self):
        with self.assertRaisesRegex(RuntimeError, "action failed"):
            with self.db.begin():
                self.user.display_name = "should roll back"
                self.assertEqual(C.award(self.db, self.actor, scope="public", action="care", epoch_at=EPOCH, now=EPOCH), 20)
                raise RuntimeError("action failed after award")
        self.assertEqual(self.total(), 0)
        for model in (GardenCreditDay, GardenCreditSlot, CreditLog):
            self.assertEqual(self.count(model), 0)
        self.assertEqual(self.award(), 20)

    def test_credit_log_failure_cannot_leave_points_or_claims_committed(self):
        def fail_log(_mapper, _connection, _target):
            raise RuntimeError("injected credit log storage failure")
        event.listen(CreditLog, "before_insert", fail_log)
        try:
            with self.assertRaisesRegex(RuntimeError, "storage failure"):
                self.award()
        finally:
            event.remove(CreditLog, "before_insert", fail_log)
        self.assertEqual(self.total(), 0)
        self.assertEqual(self.count(GardenCreditDay), 0)
        self.assertEqual(self.count(GardenCreditSlot), 0)
        self.assertEqual(self.award(), 20)

    def test_multiple_connections_racing_the_same_slot_award_once(self):
        barrier = threading.Barrier(8)
        def race(index):
            with self.sessions() as db, db.begin():
                barrier.wait(timeout=10)
                return C.award(db, self.actor, scope="public", action="water" if index % 2 else "care",
                               epoch_at=EPOCH, now=EPOCH + timedelta(seconds=index))
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(race, range(8)))
        self.assertEqual(sorted(results), [0] * 7 + [20])
        self.assertEqual(self.total(), 20)
        self.assertEqual(self.count(GardenCreditSlot), 1)
        self.assertEqual(self.count(CreditLog), 1)

    def test_concurrent_distinct_slots_cannot_exceed_one_daily_bonus_or_daily_limit(self):
        barrier = threading.Barrier(5)
        def race(hours):
            with self.sessions() as db, db.begin():
                barrier.wait(timeout=10)
                return C.award(db, self.actor, scope="public", action="care", epoch_at=EPOCH,
                               now=EPOCH + timedelta(hours=hours))
        with ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(race, (16, 18, 24, 30, 36)))
        self.assertEqual(sorted(results), [0, 1, 1, 1, 20])
        self.assertEqual(self.total(), 23)
        self.assertEqual(self.count(GardenCreditDay), 1)
        self.assertEqual(self.count(GardenCreditSlot), 4)

    def test_vote_requires_identity_and_helper_never_begins_or_commits_transaction(self):
        self.assertFalse(self.db.in_transaction())
        with self.assertRaisesRegex(RuntimeError, "transaction"):
            C.award(self.db, self.actor, scope="public", action="care", epoch_at=EPOCH, now=EPOCH)
        self.assertFalse(self.db.in_transaction())
        for vote_id in (None, "", " ", "x" * 129):
            with self.subTest(vote_id=vote_id), self.assertRaises(ValueError):
                self.award(action="vote", vote_id=vote_id)
        with self.db.begin():
            C.award(self.db, self.actor, scope="public", action="care", epoch_at=EPOCH, now=EPOCH)
            with self.sessions() as observer:
                self.assertEqual(observer.scalar(select(Agent.credit_total).where(Agent.id == self.agent.id)), 0)
        self.assertEqual(self.total(), 20)


if __name__ == "__main__":
    unittest.main()
