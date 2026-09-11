"""Real crop-to-wallet flows, exact fractional stock and concurrent sale retries."""
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import threading
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from models.garden import GardenLedger, GardenStock, GardenWorld
from models.garden_market import GardenMarketBatch, GardenMarketLot
from models.garden_sale import GardenSale
from models.shell_wallet import ShellEntry
from routers import garden as router
from services import garden_service as garden, garden_market as market, garden_mcp, shell_wallet
from tests.test_garden_acceptance import GardenServiceFixture
from utils.deps import get_current_user, get_db


class GardenMarketTest(GardenServiceFixture):
    def harvest_mushroom(self):
        state, _ = self.mature_first("petite_oyster_mushroom")
        batch = self.batch(state)
        self.do(self.user, "steal", planting_id=state["planting_id"], batch_id=batch["id"])
        self.do(self.agent, "harvest", planting_id=state["planting_id"], batch_id=batch["id"])
        return batch

    def quoted(self, actor=None, amount="2637"):
        return market.quote(self.db, actor or self.user, crop_id="petite_oyster_mushroom", quantity_g=amount)

    def sell_quote(self, quoted, actor=None, request_id="sale-1", db=None):
        return market.sell(db or self.db, actor or self.user, crop_id=quoted["crop_id"],
            quantity_g=quoted["quantity_g"], quote_id=quoted["quote_id"], request_id=request_id)

    def test_real_harvest_mints_nothing_until_each_owner_sells(self):
        self.harvest_mushroom()
        self.assertEqual(shell_wallet.balance(self.db, self.user), 0)
        self.assertEqual(shell_wallet.balance(self.db, self.agent), 0)
        quoted = self.quoted()
        self.assertEqual(Fraction(quoted["shells_exact"]), Fraction(30, 7))
        result = self.sell_quote(quoted)
        self.assertEqual(result["remaining_g"], "0")
        self.assertEqual(result["wallet"]["shell_balance_exact"], "30/7")
        self.assertEqual(self.balance("petite_oyster_mushroom", "agent"), 2637)
        other = self.sell_quote(self.quoted(self.agent), self.agent)
        self.assertEqual(Fraction(other["wallet"]["shell_balance_exact"]), Fraction(30, 7))
        ledger = self.db.scalars(select(GardenLedger).where(GardenLedger.owner_key.in_([self.user.key, self.agent.key]))).all()
        self.assertEqual(sum((Fraction(int(r.quantity_numerator), int(r.quantity_denominator)) for r in ledger), Fraction()), 0)

    def test_partial_fraction_sales_equal_bulk_and_zero_lots_stay_empty(self):
        self.harvest_mushroom()
        # Three fractional sales of the human's half versus one Agent bulk sale.
        for index, amount in enumerate(("1/3", "1/3", "7909/3")):
            self.sell_quote(self.quoted(amount=amount), request_id=f"split-{index}")
        self.sell_quote(self.quoted(self.agent), self.agent)
        self.assertEqual(shell_wallet.balance(self.db, self.user), shell_wallet.balance(self.db, self.agent))
        view = market.get_market(self.db, self.user)
        self.assertEqual(view["items"][0]["quantity_g"], "0")
        self.assertFalse(view["items"][0]["can_sell"])
        self.assertEqual(self.db.scalar(select(GardenMarketLot).where(GardenMarketLot.owner_key == self.user.key)).remaining_numerator, "0")

    def test_quote_is_owner_scoped_and_changes_require_reconfirmation(self):
        self.harvest_mushroom()
        old_quote = self.quoted()
        with self.assertRaises(garden.GardenError) as wrong_owner:
            self.sell_quote(old_quote, self.agent)
        self.assertEqual(wrong_owner.exception.code, "stale_quote")
        part = self.quoted(amount="1")
        self.sell_quote(part, request_id="partial")
        with self.assertRaises(garden.GardenError):
            self.sell_quote(old_quote)
        view = market.get_market(self.db, self.user, owner="agent")
        self.assertFalse(view["can_sell"])
        self.assertFalse(view["items"][0]["can_sell"])
        self.assertEqual(shell_wallet.balance(self.db, self.agent), 0)

    def test_same_request_replays_receipt_and_different_body_conflicts(self):
        self.harvest_mushroom()
        quoted = self.quoted()
        first = self.sell_quote(quoted)
        second = self.sell_quote(quoted)
        self.assertEqual(first, second)
        self.assertEqual(self.db.query(GardenSale).count(), 1)
        self.assertEqual(self.db.query(ShellEntry).filter_by(action="crop_sale").count(), 1)
        with self.assertRaises(garden.GardenError) as conflict:
            market.sell(self.db, self.user, crop_id="petite_oyster_mushroom", quantity_g="1", quote_id=quoted["quote_id"], request_id="sale-1")
        self.assertEqual(conflict.exception.code, "idempotency_conflict")

    def parallel_sales(self, quoted, ids):
        barrier = threading.Barrier(len(ids), timeout=10)
        def run(request_id):
            with self.sessions() as db:
                barrier.wait()
                try:
                    return "ok", self.sell_quote(quoted, request_id=request_id, db=db)
                except garden.GardenError as exc:
                    return "error", exc.code
        with ThreadPoolExecutor(max_workers=len(ids)) as pool:
            return list(pool.map(run, ids))

    def test_concurrent_distinct_sales_cannot_double_sell(self):
        self.harvest_mushroom()
        result = self.parallel_sales(self.quoted(), ["a", "b"])
        self.assertEqual(sorted(row[0] for row in result), ["error", "ok"])
        self.db.expire_all()
        self.assertEqual(shell_wallet.balance(self.db, self.user), Fraction(30, 7))

    def test_concurrent_same_request_is_one_sale_with_two_equal_receipts(self):
        self.harvest_mushroom()
        result = self.parallel_sales(self.quoted(), ["same", "same"])
        self.assertEqual(result[0], result[1])
        self.assertEqual(result[0][0], "ok")
        self.db.expire_all()
        self.assertEqual(self.db.query(GardenSale).count(), 1)

    def test_wallet_failure_rolls_back_stock_lots_sale_and_allows_retry(self):
        self.harvest_mushroom()
        quoted = self.quoted()
        def fail(connection, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("INSERT INTO SHELL_ENTRIES"):
                raise RuntimeError("isolated ledger failure")
        event.listen(self.engine, "before_cursor_execute", fail)
        try:
            with self.assertRaises(RuntimeError):
                self.sell_quote(quoted)
        finally:
            event.remove(self.engine, "before_cursor_execute", fail)
        self.assertEqual(self.balance("petite_oyster_mushroom"), 2637)
        self.assertEqual(self.db.query(GardenSale).count(), 0)
        self.assertEqual(shell_wallet.balance(self.db, self.user), 0)
        self.assertEqual(self.sell_quote(quoted)["wallet"]["shell_balance_exact"], "30/7")

    def test_legacy_inventory_is_backfilled_once_without_new_money_or_world_change(self):
        self.harvest_mushroom()
        self.db.query(GardenMarketLot).delete()
        self.db.query(GardenMarketBatch).delete()
        self.db.commit()
        before = self.db.get(GardenWorld, 1).epoch_at
        view = market.get_market(self.db, self.user)
        self.assertEqual(view["items"][0]["shells_exact"], "30/7")
        self.assertEqual(view["wallet"]["shell_balance_exact"], "0")
        self.sell_quote(self.quoted())
        self.assertEqual(market.get_market(self.db, self.user)["items"][0]["quantity_g"], "0")
        self.assertEqual(self.db.get(GardenWorld, 1).epoch_at, before)

    def test_unexplained_stock_is_blocked_and_never_sold(self):
        self.harvest_mushroom()
        stock = self.db.get(GardenStock, (self.user.key, "petite_oyster_mushroom"))
        stock.quantity_numerator = "999999"
        self.db.commit()
        with self.assertRaises(garden.GardenError) as mismatch:
            self.quoted()
        self.assertEqual(mismatch.exception.code, "inventory_source_mismatch")
        self.assertEqual(shell_wallet.balance(self.db, self.user), 0)

    def test_rest_and_mcp_sell_only_the_authenticated_identity(self):
        self.harvest_mushroom()
        app = FastAPI()
        app.include_router(router.router)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.households[0][0]
        with TestClient(app) as client:
            body = {"crop_id": "petite_oyster_mushroom", "quantity_g": "2637"}
            quote_response = client.post("/api/garden/market/quote", json=body)
            self.assertEqual(quote_response.status_code, 200, quote_response.text)
            quoted = quote_response.json()
            for field in ("owner", "actor", "agent_id", "shells_exact", "price", "now"):
                self.assertEqual(client.post("/api/garden/market/quote", json={**body, field: "forged"}).status_code, 422)
            for amount in (0, 1.2, "NaN", "-1", "0", "1/0", "1e6", " " * 5):
                self.assertEqual(client.post("/api/garden/market/quote", json={**body, "quantity_g": amount}).status_code, 422)
            sold = client.post("/api/garden/market/sell", json={**body, "quote_id": quoted["quote_id"], "request_id": "web"})
            self.assertEqual(sold.status_code, 200, sold.text)
        forbidden = garden_mcp.dispatch(self.db, self.user.id, action="quote", owner="user", **body)
        self.assertFalse(forbidden["ok"])
        agent_quote = garden_mcp.dispatch(self.db, self.user.id, action="quote", **body)
        self.assertTrue(agent_quote["ok"], agent_quote)
        sold = garden_mcp.dispatch(self.db, self.user.id, action="sell", **body,
            quote_id=agent_quote["result"]["quote_id"], request_id="mcp")
        self.assertTrue(sold["ok"], sold)
        self.assertEqual(sold["result"]["wallet"]["shell_balance_exact"], "30/7")

    def test_migration_twice_adds_empty_tables_and_preserves_old_assets(self):
        path = Path(__file__).resolve().parents[1] / "migrations" / "024_garden_economy.py"
        spec = importlib.util.spec_from_file_location("migration024", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "old.db"
            with sqlite3.connect(target) as db:
                db.execute("CREATE TABLE users (id TEXT PRIMARY KEY)")
                db.execute("CREATE TABLE agents (id TEXT PRIMARY KEY, shell_balance INTEGER, credit_total INTEGER)")
                db.execute("INSERT INTO agents VALUES ('a',50,499)")
                db.execute("CREATE TABLE garden_stock (marker TEXT)")
                db.execute("INSERT INTO garden_stock VALUES ('original-fractional-stock')")
            migration.main(target)
            migration.main(target)
            with sqlite3.connect(target) as db:
                self.assertEqual(db.execute("SELECT * FROM agents").fetchall(), [("a", 50, 499)])
                self.assertEqual(db.execute("SELECT * FROM garden_stock").fetchall(), [("original-fractional-stock",)])
                for table in migration.TABLES:
                    self.assertEqual(db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)
                self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
