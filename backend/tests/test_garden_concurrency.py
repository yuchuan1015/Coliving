"""Real SQLite multi-session contention, transaction failure and process-restart checks."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from fractions import Fraction
import threading

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from models.garden import GardenLedger, GardenOperation
from services import garden_service as garden
from tests import test_garden_acceptance as fixtures

duration = fixtures.duration
real_seconds = fixtures.real_seconds


class GardenConcurrencyAcceptance(fixtures.GardenServiceFixture):
    start_public = fixtures.GardenSharedAcceptance.start_public

    def parallel(self, functions):
        """Each worker owns a separate DB connection and crosses a shared barrier."""
        barrier = threading.Barrier(len(functions), timeout=10)
        def worker(function):
            with self.sessions() as db:
                barrier.wait()
                try:
                    return "ok", function(db)
                except garden.GardenError as exc:
                    return "rejected", exc.code
        with ThreadPoolExecutor(max_workers=len(functions)) as pool:
            return list(pool.map(worker, functions))

    def mature_boundary(self):
        self.boundary_crop()
        state = self.plant("water_spinach")
        self.maintain_until(self.now + duration(real_seconds(1)))
        return state["planting_id"], self.batch(self.state())["id"]

    def test_simultaneous_theft_and_harvest_conserve_exactly_one_batch(self):
        planting_id, batch_id = self.mature_boundary()
        def act(db, actor, action):
            return garden.mutate(db, actor, plot_id=self.plot_id, planting_id=planting_id,
                                 batch_id=batch_id, action=action, request_id=f"race-{action}")
        outcomes = self.parallel([
            lambda db: act(db, self.user, "steal"),
            lambda db: act(db, self.agent, "harvest"),
        ])
        self.assertEqual(outcomes[1][0], "ok", outcomes)
        stolen = self.balance("water_spinach")
        harvested = self.balance("water_spinach", "agent")
        self.assertIn((stolen, harvested), [(Fraction(0), Fraction(200)), (Fraction(100), Fraction(100))])
        self.assertEqual(stolen + harvested, 200)
        self.assertEqual(self.completed(), {"water_spinach"})

    def test_two_distinct_theft_requests_allow_only_one_credit(self):
        planting_id, batch_id = self.mature_boundary()
        def steal(db, request):
            return garden.mutate(db, self.user, plot_id=self.plot_id, planting_id=planting_id,
                                 batch_id=batch_id, action="steal", request_id=request)
        outcomes = self.parallel([
            lambda db: steal(db, "distinct-1"), lambda db: steal(db, "distinct-2"),
        ])
        self.assertEqual(sorted(outcome[0] for outcome in outcomes), ["ok", "rejected"])
        self.assertEqual(self.balance("water_spinach"), 100)
        self.assertEqual(self.balance("water_spinach", "agent"), 0)
        self.assertFalse(self.completed())

    def test_same_request_concurrent_retry_returns_one_effect(self):
        planting_id, batch_id = self.mature_boundary()
        def steal(db):
            return garden.mutate(db, self.user, plot_id=self.plot_id, planting_id=planting_id,
                                 batch_id=batch_id, action="steal", request_id="same-steal")
        outcomes = self.parallel([steal, steal])
        self.assertEqual([outcome[0] for outcome in outcomes], ["ok", "ok"], outcomes)
        self.assertEqual(self.balance("water_spinach"), 100)
        self.assertEqual(self.db.query(GardenOperation).filter_by(request_id="same-steal").count(), 1)
        self.assertEqual(self.db.query(GardenLedger).filter_by(planting_id=planting_id, kind="steal").count(), 1)
        with self.assertRaises(garden.GardenError):
            garden.mutate(self.db, self.user, plot_id=self.plot_id, planting_id=planting_id,
                          action="water", request_id="same-steal")
        self.assertEqual(self.balance("water_spinach"), 100)

    def test_multiple_tick_workers_do_not_duplicate_public_shares_or_clear_votes(self):
        self.boundary_crop()
        plot_id, planting_id, started = self.start_public()
        for actor in (self.user, self.agent, self.other_user):
            self.do(actor, "water", plot_id=plot_id, planting_id=planting_id)
        self.now = started + duration(real_seconds(1))
        outcomes = self.parallel([garden.tick_all, garden.tick_all])
        self.assertEqual([outcome[0] for outcome in outcomes], ["ok", "ok"], outcomes)
        for actor, owner in [(self.user, "user"), (self.user, "agent"), (self.other_user, "user")]:
            self.assertEqual(self.balance("water_spinach", owner, actor), Fraction(200, 3))
        self.assertEqual(self.state(plot_id=plot_id, public=True)["planting_id"], planting_id)
        self.assertIsNone(self.view(plot_id=plot_id, public=True)["vote"])
        self.assertEqual(self.db.query(GardenLedger).filter_by(planting_id=planting_id, kind="public_share").count(), 3)

    def test_restart_retains_inventory_batch_identity_and_idempotency_receipt(self):
        planting_id, batch_id = self.mature_boundary()
        self.do(self.user, "steal", planting_id=planting_id, batch_id=batch_id, request_id="before-restart")
        self.db.close()
        self.engine.dispose()
        restarted_engine = create_engine(
            f"sqlite:///{self.temp.name}/garden.db", connect_args={"check_same_thread": False, "timeout": 20},
        )
        self.addCleanup(restarted_engine.dispose)
        self.engine = restarted_engine
        self.sessions = sessionmaker(bind=restarted_engine, expire_on_commit=False)
        self.db = self.sessions()
        self.addCleanup(self.db.close)
        restored = self.state()
        self.assertEqual(restored["planting_id"], planting_id)
        self.assertEqual(self.batch(restored)["id"], batch_id)
        self.assertTrue(self.batch(restored)["stolen"])
        self.assertEqual(self.balance("water_spinach"), 100)
        self.do(self.user, "steal", planting_id=planting_id, batch_id=batch_id, request_id="before-restart")
        self.assertEqual(self.balance("water_spinach"), 100)
        self.do(self.agent, "harvest", planting_id=planting_id, batch_id=batch_id, request_id="after-restart")
        self.assertEqual(self.balance("water_spinach", "agent"), 100)

    def test_credit_write_failure_rolls_back_batch_ledger_and_receipt_atomically(self):
        planting_id, batch_id = self.mature_boundary()
        def fail_stock_write(connection, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("INSERT INTO GARDEN_STOCK"):
                raise RuntimeError("fixture: stock storage temporarily unavailable")
        event.listen(self.engine, "before_cursor_execute", fail_stock_write)
        try:
            with self.assertRaises(RuntimeError):
                self.do(self.user, "steal", planting_id=planting_id, batch_id=batch_id, request_id="atomic-retry")
        finally:
            event.remove(self.engine, "before_cursor_execute", fail_stock_write)
        self.assertFalse(self.batch(self.state())["stolen"])
        self.assertEqual(self.balance("water_spinach"), 0)
        self.assertEqual(self.db.query(GardenOperation).filter_by(request_id="atomic-retry").count(), 0)
        self.assertEqual(self.db.query(GardenLedger).filter_by(planting_id=planting_id).count(), 0)
        self.do(self.user, "steal", planting_id=planting_id, batch_id=batch_id, request_id="atomic-retry")
        self.assertTrue(self.batch(self.state())["stolen"])
        self.assertEqual(self.balance("water_spinach"), 100)
