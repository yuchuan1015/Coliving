"""Exact shell assets, legacy compatibility and real SQLite writer contention."""
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
import tempfile
import threading
import unittest

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker

import models
from database import Base
from models.agent import Agent
from models.garden import GardenWorld
from models.shell_log import ShellLog
from models.shell_wallet import ShellEntry, ShellWallet
from models.user import User
from routers import shell as shell_routes
from services import agent_service, garden_service, shell_service, shell_wallet
from utils.deps import get_current_user, get_db


class ShellWalletTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="shell-wallet-")
        self.addCleanup(self.temp.cleanup)
        self.engine = create_engine(f"sqlite:///{self.temp.name}/wallet.db",
                                    connect_args={"check_same_thread": False, "timeout": 15})
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.sessions()
        self.addCleanup(self.db.close)
        self.users, self.agents = [], []
        for index in range(3):
            user = User(username=f"wallet-{index}", display_name="fixture", hashed_password="unused",
                        role="admin" if index == 0 else "resident")
            self.db.add(user)
            self.db.flush()
            agent = Agent(user_id=user.id, name=f"wallet-agent-{index}", persona="fixture",
                          llm_provider="claude", llm_model="unused", encrypted_api_key="",
                          shell_balance=50 if index == 0 else 0)
            self.db.add(agent)
            self.db.flush()
            self.users.append(user)
            self.agents.append(agent)
        self.db.commit()
        self.actors = [shell_wallet.actor_for_agent(agent) for agent in self.agents]
        self.human = shell_wallet.WalletActor("user", self.users[0].id, self.users[0].id)

    def balance(self, actor=None, db=None):
        return shell_wallet.balance(db or self.db, actor or self.actors[0])

    def credit(self, amount, source="sale-1", actor=None):
        return garden_service._transaction(self.db, lambda: shell_wallet.credit(
            self.db, actor or self.actors[0], amount, source_key=source, action="crop_sale"))

    def entries(self, db=None):
        return (db or self.db).scalars(select(ShellEntry).order_by(ShellEntry.id)).all()

    def parallel(self, *functions):
        barrier = threading.Barrier(len(functions), timeout=10)
        def worker(function):
            with self.sessions() as db:
                barrier.wait()
                return function(db)
        with ThreadPoolExecutor(max_workers=len(functions)) as executor:
            return list(executor.map(worker, functions))

    def test_readonly_summary_preserves_legacy_assets_without_creating_rows(self):
        self.assertEqual(self.balance(), 50)
        self.assertEqual(self.balance(self.human), 0)
        self.assertEqual(shell_wallet.summary(self.db, self.actors[0]), {
            "shell_balance": 50, "shell_balance_exact": "50", "shell_balance_display": "50.00"})
        self.assertEqual(self.db.query(ShellWallet).count(), 0)
        self.assertEqual(self.db.query(ShellEntry).count(), 0)
        self.assertEqual(self.db.query(GardenWorld).count(), 0)

    def test_legacy_integer_is_imported_once_and_fractional_income_updates_floor_mirror(self):
        self.assertEqual(self.credit(Fraction(1, 3)), Fraction(151, 3))
        self.assertEqual(self.agents[0].shell_balance, 50)
        self.assertEqual(self.credit(Fraction(2, 3), "sale-2"), 51)
        self.assertEqual(self.agents[0].shell_balance, 51)
        self.assertEqual(self.db.query(ShellWallet).count(), 1)
        self.assertEqual(len(self.entries()), 2)
        # A legacy mirror must never become a second source of currency once a
        # rational wallet exists. A later wallet mutation repairs that mirror.
        self.agents[0].shell_balance = 5000
        self.db.commit()
        self.assertEqual(self.balance(), 51)
        self.assertEqual(self.credit(Fraction(1, 2), "sale-3"), Fraction(103, 2))
        self.assertEqual(self.agents[0].shell_balance, 51)

    def test_user_and_agent_wallets_are_distinct_and_human_starts_at_zero(self):
        self.credit(Fraction(1, 3), actor=self.human)
        self.assertEqual(self.balance(self.human), Fraction(1, 3))
        self.assertEqual(self.balance(), 50)
        self.assertEqual(self.agents[0].shell_balance, 50)
        self.assertEqual(self.db.query(ShellWallet).one().owner_key, self.human.key)

    def test_credit_source_retry_is_one_effect_and_conflicting_reuse_is_rejected(self):
        self.credit(Fraction(1, 3))
        self.credit(1, "sale-later")
        self.assertEqual(self.credit(Fraction(1, 3)), Fraction(154, 3))
        self.assertEqual(len(self.entries()), 2)
        for actor, amount, action in ((self.human, Fraction(1, 3), "crop_sale"),
                                      (self.actors[0], Fraction(2, 3), "crop_sale"),
                                      (self.actors[0], Fraction(1, 3), "admin_grant")):
            with self.subTest(actor=actor.key, amount=amount, action=action):
                with self.assertRaises(ValueError):
                    garden_service._transaction(self.db, lambda: shell_wallet.credit(
                        self.db, actor, amount, source_key="sale-1", action=action))
        self.assertEqual(self.balance(), Fraction(154, 3))
        self.assertEqual(self.balance(self.human), 0)
        self.assertEqual(len(self.entries()), 2)

    def test_exact_credit_is_not_committed_by_helper_and_rolls_back_with_parent(self):
        with self.assertRaises(RuntimeError):
            def work():
                shell_wallet.credit(self.db, self.human, Fraction(1, 3), source_key="rollback-sale", action="crop_sale")
                raise RuntimeError("sale failed after wallet credit")
            garden_service._transaction(self.db, work)
        self.assertEqual(self.balance(self.human), 0)
        self.assertEqual(self.db.query(ShellWallet).count(), 0)
        self.assertEqual(self.db.query(ShellEntry).count(), 0)
        self.assertEqual(self.credit(Fraction(1, 3), "rollback-sale", self.human), Fraction(1, 3))

    def test_fractional_display_rounds_once_without_rounding_the_stored_money(self):
        self.credit(Fraction(1, 3), actor=self.human)
        self.assertEqual(shell_wallet.summary(self.db, self.human)["shell_balance_display"], "0.33")
        self.credit(Fraction(1, 3), "sale-2", self.human)
        self.assertEqual(shell_wallet.summary(self.db, self.human), {
            "shell_balance": 0, "shell_balance_exact": "2/3", "shell_balance_display": "0.67"})
        self.credit(Fraction(1, 3), "sale-3", self.human)
        self.assertEqual(self.balance(self.human), 1)
        self.assertEqual(shell_wallet.summary(self.db, self.human)["shell_balance_display"], "1.00")
        self.credit(Fraction(1, 200), "half-cent", self.actors[1])
        self.assertEqual(shell_wallet.summary(self.db, self.actors[1])["shell_balance_display"], "0.01")
        self.assertEqual(self.balance(self.actors[1]), Fraction(1, 200))

    def test_transfer_and_spend_use_the_exact_wallet_and_preserve_fractional_remainder(self):
        self.credit(Fraction(1, 3))
        self.credit(Fraction(2, 3), "recipient-sale", self.actors[1])
        result = garden_service._transaction(self.db, lambda: shell_service.transfer(
            self.db, self.agents[0], self.agents[1], 10, "legacy transfer"))
        self.assertTrue(result)
        self.assertEqual(self.balance(), Fraction(121, 3))
        self.assertEqual(self.balance(self.actors[1]), Fraction(32, 3))
        self.assertEqual(self.balance() + self.balance(self.actors[1]), 51)
        self.assertEqual(self.agents[0].shell_balance, 40)
        self.assertEqual(self.agents[1].shell_balance, 10)
        spent = garden_service._transaction(self.db, lambda: shell_service.spend(
            self.db, self.agents[0], 40, "legacy-spend"))
        self.assertTrue(spent)
        self.assertEqual(self.balance(), Fraction(1, 3))
        self.assertFalse(garden_service._transaction(self.db, lambda: shell_service.spend(
            self.db, self.agents[0], 1, "insufficient")))
        self.assertEqual(self.balance(), Fraction(1, 3))
        self.assertEqual(self.agents[0].shell_balance, 0)
        self.assertEqual(self.db.query(ShellLog).count(), 3)

    def test_admin_adjustments_share_wallet_and_clamp_actual_fractional_deduction(self):
        self.credit(Fraction(1, 3), actor=self.actors[1])
        garden_service._transaction(self.db, lambda: shell_service.admin_grant(self.db, self.agents[1], 2))
        self.assertEqual(self.balance(self.actors[1]), Fraction(7, 3))
        garden_service._transaction(self.db, lambda: shell_service.admin_deduct(self.db, self.agents[1], 10))
        self.assertEqual(self.balance(self.actors[1]), 0)
        entry = self.entries()[-1]
        self.assertEqual(Fraction(int(entry.amount_numerator), int(entry.amount_denominator)), Fraction(-7, 3))
        self.assertEqual(self.agents[1].shell_balance, 0)
        self.assertIn("-7/3", self.db.query(ShellLog).filter_by(action="admin_deduct").one().note)

    def test_new_adoption_no_longer_issues_welcome_shells_or_erases_old_balances(self):
        garden_service._transaction(self.db, lambda: shell_service.grant_welcome_bonus(self.db, self.agents[0]))
        self.assertEqual(self.balance(), 50)
        newcomer = User(username="new-wallet", display_name="fixture", hashed_password="unused")
        self.db.add(newcomer)
        self.db.commit()
        new_agent = agent_service.create_agent(self.db, newcomer.id, "new-wallet-agent", "fixture", "claude", "unused", None)
        self.assertEqual(new_agent.shell_balance, 0)
        self.assertEqual(self.db.query(ShellWallet).count(), 0)
        self.assertEqual(self.db.query(ShellLog).filter_by(action="welcome").count(), 0)
        self.assertEqual(self.db.query(ShellEntry).count(), 0)

    def test_invalid_identity_or_inexact_amount_cannot_credit_another_owner(self):
        for actor in (shell_wallet.WalletActor("agent", self.agents[0].id, self.users[1].id),
                      shell_wallet.WalletActor("user", self.users[0].id, self.users[1].id),
                      shell_wallet.WalletActor("admin", self.users[0].id, self.users[0].id)):
            with self.assertRaises(ValueError):
                self.credit(1, actor=actor)
        for amount in (0, -1, True, 0.1, "nan", "1/0"):
            with self.subTest(amount=amount), self.assertRaises(ValueError):
                self.credit(amount)
        self.assertEqual(self.balance(), 50)
        self.assertEqual(self.db.query(ShellWallet).count(), 0)
        self.assertEqual(self.db.query(ShellEntry).count(), 0)

    def test_two_sale_workers_with_same_source_credit_only_once(self):
        def sell(db):
            return garden_service._transaction(db, lambda: shell_wallet.credit(
                db, self.actors[0], Fraction(1, 3), source_key="concurrent-sale", action="crop_sale"))
        results = self.parallel(sell, sell)
        self.assertEqual(results, [Fraction(151, 3), Fraction(151, 3)])
        self.assertEqual(self.balance(), Fraction(151, 3))
        self.assertEqual(len(self.entries()), 1)
        self.assertEqual(self.db.query(ShellWallet).count(), 1)

    def test_two_transfer_routes_cannot_spend_the_same_legacy_assets_twice(self):
        def transfer(db, target):
            user = db.get(User, self.users[0].id)
            try:
                return shell_routes.transfer_shells(target, 40, "race", db, user)
            except HTTPException as exc:
                return exc.status_code
        results = self.parallel(lambda db: transfer(db, self.agents[1].name),
                                lambda db: transfer(db, self.agents[2].name))
        self.assertEqual(sum(isinstance(result, dict) for result in results), 1)
        self.assertEqual(sum(result == 400 for result in results), 1)
        amounts = [self.balance(actor) for actor in self.actors]
        self.assertEqual(amounts[0], 10)
        self.assertEqual(sorted(amounts[1:]), [0, 40])
        self.assertEqual(sum(amounts), 50)
        self.assertEqual(self.db.query(GardenWorld).count(), 0)
        self.assertEqual(len(self.entries()), 2)

    def test_sale_and_legacy_transfer_contend_on_one_exact_balance(self):
        def sell(db):
            return garden_service._transaction(db, lambda: shell_wallet.credit(
                db, self.actors[0], Fraction(1, 3), source_key="sale-versus-transfer", action="crop_sale"))
        def transfer(db):
            return shell_routes.transfer_shells(self.agents[1].name, 40, "race", db, db.get(User, self.users[0].id))
        self.parallel(sell, transfer)
        self.assertEqual(self.balance(), Fraction(31, 3))
        self.assertEqual(self.balance(self.actors[1]), 40)
        self.assertEqual(self.balance() + self.balance(self.actors[1]), Fraction(151, 3))
        self.assertEqual(self.agents[0].shell_balance, 10)
        self.assertEqual(len(self.entries()), 3)

    def test_transfer_recipient_write_failure_rolls_back_both_wallets_and_logs(self):
        recipient_key = self.actors[1].key
        def fail_entry(connection, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("INSERT INTO SHELL_ENTRIES") and recipient_key in parameters:
                raise RuntimeError("fixture recipient ledger unavailable")
        event.listen(self.engine, "before_cursor_execute", fail_entry)
        try:
            with self.assertRaises(RuntimeError):
                shell_routes.transfer_shells(self.agents[1].name, 40, "atomic transfer", self.db, self.users[0])
        finally:
            event.remove(self.engine, "before_cursor_execute", fail_entry)
        self.assertEqual(self.balance(), 50)
        self.assertEqual(self.balance(self.actors[1]), 0)
        self.assertEqual(self.db.query(ShellWallet).count(), 0)
        self.assertEqual(self.db.query(ShellEntry).count(), 0)
        self.assertEqual(self.db.query(ShellLog).count(), 0)

    def test_write_routes_recheck_active_role_and_auth_version_after_taking_lock(self):
        for change, expected in (({"is_active": False}, 401), ({"auth_version": 1}, 401), ({"role": "resident"}, 403)):
            self.db.refresh(self.users[0])
            stale = self.users[0]
            with self.sessions() as other:
                user = other.get(User, stale.id)
                for name, value in change.items():
                    setattr(user, name, value)
                other.commit()
            with self.assertRaises(HTTPException) as raised:
                shell_routes.admin_grant(self.agents[1].id, 10, "stale principal", self.db, stale)
            self.assertEqual(raised.exception.status_code, expected)
            with self.sessions() as other:
                user = other.get(User, self.users[0].id)
                user.is_active, user.auth_version, user.role = True, 0, "admin"
                other.commit()
        self.assertEqual(self.balance(self.actors[1]), 0)
        self.assertEqual(self.db.query(ShellEntry).count(), 0)

    def test_http_summary_and_existing_admin_transfer_apis_return_exact_fields(self):
        app = FastAPI()
        app.include_router(shell_routes.router)
        def session():
            with self.sessions() as db:
                yield db
        app.dependency_overrides[get_db] = session
        app.dependency_overrides[get_current_user] = lambda: self.users[0]
        with TestClient(app) as client:
            self.credit(Fraction(1, 3))
            self.assertEqual(client.get("/api/shell/summary").json()["shell_balance_exact"], "151/3")
            transferred = client.post("/api/shell/transfer", params={"to_agent_name": self.agents[1].name, "amount": 1})
            self.assertEqual(transferred.status_code, 200, transferred.text)
            self.assertEqual(transferred.json()["shell_balance_exact"], "148/3")
            granted = client.post("/api/shell/admin/grant", params={"agent_id": self.agents[1].id, "amount": 2})
            self.assertEqual(granted.status_code, 200, granted.text)
            self.assertEqual(granted.json()["shell_balance_exact"], "3")
            deducted = client.post("/api/shell/admin/deduct", params={"agent_id": self.agents[1].id, "amount": 2})
            self.assertEqual(deducted.status_code, 200, deducted.text)
            self.assertEqual(deducted.json()["shell_balance_exact"], "1")
            self.assertEqual(client.get("/api/shell/logs").status_code, 200)
        self.assertEqual(self.db.query(GardenWorld).count(), 0)

    def test_023_stays_at_seven_tables_and_024_replays_preserve_exact_existing_assets(self):
        import importlib.util
        from pathlib import Path
        import sqlite3
        migrations = Path(__file__).resolve().parents[1] / "migrations"
        def load(name):
            spec = importlib.util.spec_from_file_location("wallet_check_" + name, migrations / name)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
        migration23 = load("023_garden_tier1.py")
        migration24 = load("024_garden_economy.py")
        target = Path(self.temp.name) / "legacy-migration.db"
        with sqlite3.connect(target) as db:
            db.execute("CREATE TABLE users (id TEXT PRIMARY KEY)")
            db.execute("INSERT INTO users VALUES ('household')")
            db.execute("CREATE TABLE agents (id TEXT PRIMARY KEY, shell_balance INTEGER, credit_total INTEGER)")
            db.execute("INSERT INTO agents VALUES ('agent',50,499)")
        migration23.main(target)
        migration23.main(target)
        original = {"garden_world", "garden_plots", "garden_operations", "garden_stock",
                    "garden_ledger", "garden_progress", "garden_logs"}
        with sqlite3.connect(target) as db:
            names = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertEqual({name for name in names if name.startswith("garden_")}, original)
            self.assertNotIn("shell_wallets", names)
            db.execute("INSERT INTO garden_stock VALUES ('user:household','daikon','household','1','3')")
        migration24.main(target)
        migration24.main(target)
        with sqlite3.connect(target) as db:
            for table in migration24.TABLES:
                self.assertEqual(db.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0], 0)
            db.execute("INSERT INTO shell_wallets VALUES ('agent:agent','household','151','3')")
            db.execute("""INSERT INTO shell_entries
                (source_key,owner_key,household_id,action,amount_numerator,amount_denominator,
                 balance_after_numerator,balance_after_denominator,created_at)
                VALUES ('preserved-sale','agent:agent','household','crop_sale','1','3','151','3','2026-09-11 00:00:00')""")
            before_stock = db.execute("SELECT * FROM garden_stock").fetchall()
            before_wallet = db.execute("SELECT * FROM shell_wallets").fetchall()
            before_entries = db.execute("SELECT * FROM shell_entries").fetchall()
        migration23.main(target)
        migration24.main(target)
        with sqlite3.connect(target) as db:
            self.assertEqual(db.execute("SELECT * FROM agents").fetchall(), [("agent", 50, 499)])
            self.assertEqual(db.execute("SELECT * FROM garden_stock").fetchall(), before_stock)
            self.assertEqual(db.execute("SELECT * FROM shell_wallets").fetchall(), before_wallet)
            self.assertEqual(db.execute("SELECT * FROM shell_entries").fetchall(), before_entries)
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
