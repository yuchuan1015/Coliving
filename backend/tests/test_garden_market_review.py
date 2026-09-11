"""Independent review of public shares, FIFO prices, ownership and recovery."""

from datetime import timedelta
from fractions import Fraction
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from models.agent import Agent
from models.user import User
from models.garden import GardenLedger, GardenStock, GardenWorld
from models.garden_market import GardenMarketBatch, GardenMarketLot
from models.garden_sale import GardenSale
from routers import garden as garden_router
from services import auth_service, garden_service as garden, garden_market as market, garden_pricing, garden_lots, shell_wallet
from tests.test_garden_acceptance import GardenServiceFixture, duration, real_seconds
from utils.deps import get_db


class GardenMarketReview(GardenServiceFixture):
    crop = "petite_oyster_mushroom"

    def own_first_batch(self):
        state, _ = self.mature_first(self.crop)
        batch = self.batch(state)
        self.do(self.user, "steal", planting_id=state["planting_id"], batch_id=batch["id"])
        self.do(self.agent, "harvest", planting_id=state["planting_id"], batch_id=batch["id"])
        return state["planting_id"], batch

    def quote(self, actor, amount):
        return market.quote(self.db, actor, crop_id=self.crop, quantity_g=str(amount))

    def sell(self, actor, quoted, key):
        return market.sell(self.db, actor, crop_id=quoted["crop_id"], quantity_g=quoted["quantity_g"],
                           quote_id=quoted["quote_id"], request_id=key)

    def public_start(self):
        public = garden.get_public(self.db, self.user)["plots"][0]
        world = self.db.get(GardenWorld, 1)
        world.public_productive_area_m2 = 6
        self.db.commit()
        self.do(self.user, "vote", plot_id=public["id"], vote_id=public["vote"]["id"], crop_id=self.crop)
        self.now += timedelta(hours=12)
        garden.tick_all(self.db)
        state = self.state(plot_id=public["id"], public=True)
        return public["id"], state["planting_id"], self.now

    def public_participants(self, count):
        actors = [self.user, self.agent, self.other_user, self.other_agent]
        for index in range(2):
            if len(actors) >= count:
                break
            user = User(username=f"market-public-{index}", display_name="fixture", hashed_password="unused")
            self.db.add(user)
            self.db.flush()
            agent = Agent(user_id=user.id, name=f"market-public-agent-{index}", persona="fixture", llm_provider="claude",
                          llm_model="unused", encrypted_api_key="")
            self.db.add(agent)
            self.db.commit()
            actors.extend([garden.actor_for_user(self.db, user.id), garden.actor_for_agent(self.db, user.id)])
        return actors[:count]

    def public_harvest_and_sell(self, count, batches):
        actors = self.public_participants(count)
        plot_id, planting_id, started = self.public_start()
        for actor in actors:
            self.do(actor, "care", plot_id=plot_id, planting_id=planting_id)
        self.maintain_until(started + duration(real_seconds(6)), plot_id=plot_id, public=True)
        expected_quantity, expected_shells = Fraction(5274), Fraction(60, 7)
        if batches == 2:
            for actor in actors:
                self.do(actor, "care", plot_id=plot_id, planting_id=planting_id)
            self.maintain_until(self.now + duration(real_seconds(13)), plot_id=plot_id, public=True)
            expected_quantity += 3692
            expected_shells += Fraction(130, 7)
        proceeds = Fraction()
        for index, actor in enumerate(actors):
            stock = garden.get_inventory(self.db, actor, owner=actor.kind)["items"][0]
            grams = Fraction(stock["quantity_g"])
            self.assertEqual(grams, expected_quantity / count)
            # UI may show kg, but the conversion preserves the rational before
            # submitting the API's gram string; never truncate decimal display.
            kilograms = grams / 1000
            quoted = self.quote(actor, kilograms * 1000)
            self.assertEqual(Fraction(quoted["shells_exact"]), expected_shells / count)
            receipt = self.sell(actor, quoted, f"public-{index}")
            self.assertEqual(Fraction(receipt["remaining_g"]), 0)
            self.assertEqual(shell_wallet.balance(self.db, actor), expected_shells / count)
            proceeds += Fraction(receipt["shells_exact"])
            self.assertNotIn(self.crop, self.completed(actor))
        self.assertEqual(proceeds, expected_shells)
        rows = self.db.scalars(select(GardenLedger).where(GardenLedger.planting_id == planting_id)).all()
        self.assertEqual(sum((Fraction(int(row.quantity_numerator), int(row.quantity_denominator)) for row in rows), Fraction()), 0)
        self.assertEqual(self.db.query(GardenSale).count(), count)

    def test_three_public_identities_sell_fractional_two_batch_shares_exactly(self):
        self.public_harvest_and_sell(3, 2)

    def test_seven_public_identities_sell_fractional_kg_without_shell_remainder(self):
        self.public_harvest_and_sell(7, 1)

    def test_fifo_partial_sale_spans_two_different_batch_prices(self):
        planting_id, first = self.own_first_batch()
        self.maintain_until(self.now + duration(real_seconds(13)))
        second = self.batch(self.state(), 1)
        self.do(self.user, "steal", planting_id=planting_id, batch_id=second["id"])
        amount = Fraction(2637) + Fraction(100, 3)
        first_rate = garden_pricing.batch_unit_price(self.db.get(GardenMarketBatch, first["id"]))
        second_rate = garden_pricing.batch_unit_price(self.db.get(GardenMarketBatch, second["id"]))
        self.assertNotEqual(first_rate, second_rate)
        quoted = self.quote(self.user, amount)
        self.assertEqual([row["batch_id"] for row in quoted["allocations"]], [first["id"], second["id"]])
        self.assertEqual([Fraction(row["quantity_g"]) for row in quoted["allocations"]], [2637, Fraction(100, 3)])
        expected = 2637 * first_rate + Fraction(100, 3) * second_rate
        self.assertEqual(Fraction(quoted["shells_exact"]), expected)
        sold = self.sell(self.user, quoted, "fifo-partial")
        self.assertEqual(Fraction(sold["remaining_g"]), Fraction(1846) - Fraction(100, 3))
        self.assertEqual(shell_wallet.balance(self.db, self.user), expected)
        rows = self.db.scalars(select(GardenMarketLot).where(GardenMarketLot.owner_key == self.user.key)
                               .order_by(GardenMarketLot.created_at, GardenMarketLot.id)).all()
        self.assertEqual([Fraction(int(row.remaining_numerator), int(row.remaining_denominator)) for row in rows],
                         [0, Fraction(1846) - Fraction(100, 3)])

    def test_new_pricing_function_cannot_reprice_frozen_stock_or_existing_quote(self):
        self.own_first_batch()
        quoted = self.quote(self.user, 2637)
        with patch.object(garden_pricing, "price_per_gram", side_effect=AssertionError("must use frozen batch price")):
            after = self.quote(self.user, 2637)
            self.assertEqual(after, quoted)
            receipt = self.sell(self.user, after, "frozen-price")
        self.assertEqual(Fraction(receipt["shells_exact"]), Fraction(30, 7))

    def test_rest_cannot_sell_agent_stock_even_with_a_valid_agent_quote(self):
        self.own_first_batch()
        quoted_for_agent = self.quote(self.agent, 2637)
        app = FastAPI()
        app.include_router(garden_router.router)
        def test_db():
            with self.sessions() as db:
                yield db
        app.dependency_overrides[get_db] = test_db
        token = auth_service.create_access_token(self.households[0][0].id, self.households[0][0].username,
                                                self.households[0][0].role)
        with TestClient(app, headers={"Authorization": f"Bearer {token}"}) as client:
            view = client.get("/api/garden/market?owner=agent")
            self.assertEqual(view.status_code, 200, view.text)
            self.assertFalse(view.json()["can_sell"])
            body = {"crop_id": self.crop, "quantity_g": "2637", "quote_id": quoted_for_agent["quote_id"], "request_id": "cross-owner"}
            spoofed = client.post("/api/garden/market/sell", json={**body, "owner": "agent"})
            self.assertEqual(spoofed.status_code, 422)
            transplanted = client.post("/api/garden/market/sell", json=body)
            self.assertEqual(transplanted.status_code, 409, transplanted.text)
            self.assertEqual(transplanted.json()["error"]["code"], "stale_quote")
        self.db.expire_all()
        self.assertEqual(self.balance(self.crop, "agent"), 2637)
        self.assertEqual(shell_wallet.balance(self.db, self.user), 0)
        self.assertEqual(shell_wallet.balance(self.db, self.agent), 0)
        self.assertEqual(self.db.query(GardenSale).count(), 0)

    def test_disabled_owner_cannot_replay_a_previously_successful_sale(self):
        self.own_first_batch()
        quoted = self.quote(self.user, 2637)
        self.sell(self.user, quoted, "prior-success")
        user = self.db.get(User, self.user.id)
        user.is_active = False
        self.db.commit()
        with self.assertRaises(garden.GardenError) as disabled:
            self.sell(self.user, quoted, "prior-success")
        self.assertEqual(disabled.exception.status_code, 401)
        self.assertEqual(self.db.query(GardenSale).count(), 1)

    def test_missing_lot_after_partial_sale_is_not_rebuilt_as_unsold_legacy(self):
        self.own_first_batch()
        self.sell(self.user, self.quote(self.user, 1000), "prior-partial")
        self.db.query(GardenMarketLot).filter_by(owner_key=self.user.key).delete()
        self.db.commit()
        expected_stock = self.balance(self.crop)
        expected_shells = shell_wallet.balance(self.db, self.user)
        market_view = market.get_market(self.db, self.user)
        self.assertFalse(market_view["items"][0]["can_sell"])
        self.assertEqual(self.db.query(GardenMarketLot).filter_by(owner_key=self.user.key).count(), 0,
                         "A sale-era missing lot cannot be restored to the original pre-sale credit amount")
        self.assertEqual(self.balance(self.crop), expected_stock)
        self.assertEqual(shell_wallet.balance(self.db, self.user), expected_shells)

    def test_legacy_lot_recovery_itself_rejects_prior_sale_without_a_lot(self):
        self.own_first_batch()
        self.sell(self.user, self.quote(self.user, 2637), "fully-sold")
        self.db.query(GardenMarketLot).filter_by(owner_key=self.user.key).delete()
        self.db.commit()
        with self.assertRaises(garden_lots.GardenLotError) as missing:
            garden_lots.ensure_legacy_lots(self.db, self.user.key)
        self.assertEqual(missing.exception.code, "legacy_sale_without_lot")
        self.assertEqual(self.db.query(GardenMarketLot).filter_by(owner_key=self.user.key).count(), 0)
        self.assertEqual(self.balance(self.crop), 0)
        self.assertEqual(shell_wallet.balance(self.db, self.user), Fraction(30, 7))

    def test_market_source_mismatch_rolls_back_partial_backfill_without_sale_history(self):
        self.own_first_batch()
        self.db.query(GardenMarketLot).filter_by(owner_key=self.user.key).delete()
        stock = self.db.get(GardenStock, (self.user.key, self.crop))
        stock.quantity_numerator = "2638"
        self.db.commit()
        result = market.get_market(self.db, self.user)
        self.assertFalse(result["items"][0]["can_sell"])
        self.assertEqual(result["items"][0]["unavailable_reason"], "inventory_source_mismatch")
        self.assertEqual(self.db.query(GardenMarketLot).filter_by(owner_key=self.user.key).count(), 0,
                         "An unavailable market item must not commit its failed legacy backfill")
        self.assertEqual(self.balance(self.crop), 2638)
        self.assertEqual(shell_wallet.balance(self.db, self.user), 0)

    def test_old_ready_batch_can_be_harvested_after_price_tables_are_added(self):
        state, _ = self.mature_first(self.crop)
        ready = self.batch(state)
        self.db.query(GardenMarketBatch).delete()
        self.db.commit()
        self.do(self.user, "steal", planting_id=state["planting_id"], batch_id=ready["id"])
        frozen = self.db.get(GardenMarketBatch, ready["id"])
        self.assertEqual(frozen.matured_at.isoformat(), ready["matured_at"])
        self.assertEqual(self.quote(self.user, 2637)["shells_exact"], "30/7")
