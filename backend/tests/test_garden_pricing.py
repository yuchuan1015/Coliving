"""Exact batch pricing and legacy/source-preserving lots, on isolated SQLite."""

from datetime import datetime, timedelta, timezone
from fractions import Fraction
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from database import Base
from models.agent import Agent
from models.user import User
from models.garden import GardenLedger, GardenStock
from models.garden_market import GardenMarketBatch, GardenMarketLot
from services import garden_catalog, garden_lots as lots, garden_pricing as prices


NOW = datetime(2026, 9, 11, tzinfo=timezone.utc)


class GardenPricingTest(unittest.TestCase):
    def test_all_twelve_standard_cycles_pay_ten_per_real_growth_day_exactly(self):
        cards = garden_catalog.list_crops()
        self.assertEqual(len(cards), 12)
        for card in cards:
            with self.subTest(crop=card["id"]):
                harvest = card["harvest"]
                nominal_proceeds = sum((
                    prices.price_per_gram(card["id"], cycle_index=0, batch_index=index) * grams
                    for index, grams in enumerate(harvest["yield_g_per_plot_by_batch"])
                ), Fraction())
                self.assertIsInstance(nominal_proceeds, Fraction)
                self.assertEqual(nominal_proceeds, Fraction(10) * Fraction(str(harvest["maturity_offsets_days"][-1])) / 7)

    def test_all_twelve_first_batches_use_elapsed_time_from_zero(self):
        expected_first_values = {
            "daikon": Fraction(90), "carrot": Fraction(1100, 7), "potato": Fraction(150),
            "kohlrabi": Fraction(850, 7), "pak_choi": Fraction(330, 7),
            "water_spinach": Fraction(230, 7), "cauliflower": Fraction(600, 7),
            "broccoli": Fraction(150), "cucumber": Fraction(440, 7),
            "tomato": Fraction(1070, 7), "petite_oyster_mushroom": Fraction(60, 7),
            "vegetable_fern": Fraction(900, 7),
        }
        for crop_id, value in expected_first_values.items():
            with self.subTest(crop=crop_id):
                nominal = garden_catalog.get_crop(crop_id)["harvest"]["yield_g_per_plot_by_batch"][0]
                self.assertEqual(prices.price_per_gram(crop_id, cycle_index=0, batch_index=0) * nominal, value)

    def test_mushroom_declining_yield_does_not_create_replant_or_last_batch_arbitrage(self):
        yields = [5274, 3692, 1582, 792, 394, 198]
        proceeds = [prices.price_per_gram("petite_oyster_mushroom", cycle_index=0, batch_index=i) * qty
                    for i, qty in enumerate(yields)]
        self.assertEqual(proceeds, [Fraction(60, 7)] + [Fraction(130, 7)] * 5)
        self.assertEqual(sum(proceeds), Fraction(710, 7))
        # Repeated first-flush replants use six cultivation days each; they never
        # receive the late-flush unit price just because the crop ID is the same.
        self.assertEqual(proceeds[0] * 20 / Fraction(6 * 20, 7), 10)
        self.assertLess(prices.price_per_gram("petite_oyster_mushroom", cycle_index=0, batch_index=0),
                        prices.price_per_gram("petite_oyster_mushroom", cycle_index=0, batch_index=5))

    def test_fern_second_cycle_does_not_repeat_ninety_day_nursery_price(self):
        first = prices.price_per_gram("vegetable_fern", cycle_index=0, batch_index=0)
        next_cycle = prices.price_per_gram("vegetable_fern", cycle_index=1, batch_index=0)
        self.assertEqual(first * 314, Fraction(900, 7))
        self.assertEqual(next_cycle * 314, 10)
        self.assertEqual(prices.price_per_gram("vegetable_fern", cycle_index=100, batch_index=0), next_cycle)
        crop = garden_catalog.get_crop("vegetable_fern")
        all_next_cycle = sum((prices.price_per_gram("vegetable_fern", cycle_index=1, batch_index=i) * qty
                              for i, qty in enumerate(crop["harvest"]["yield_g_per_plot_by_batch"])), Fraction())
        self.assertEqual(all_next_cycle, 520)

    def test_reduced_actual_output_is_not_compensated_by_higher_unit_price(self):
        price = prices.price_per_gram("vegetable_fern", cycle_index=0, batch_index=0)
        # Engine rounds 314g * 0.5 down to a 2g quantum: first-cycle output 156g.
        self.assertEqual(price * 156, Fraction(900, 7) * Fraction(156, 314))
        self.assertLess(price * 156, price * 314)
        self.assertEqual(price * 0, 0)

    def test_invalid_batch_indices_and_unknown_crop_cannot_be_priced(self):
        for crop, cycle, index in (("missing", 0, 0), ("daikon", 1, 0), ("daikon", 0, 1),
                                   ("vegetable_fern", -1, 0), ("vegetable_fern", 0, -1),
                                   ("vegetable_fern", True, 0), ("vegetable_fern", 0, "1")):
            with self.subTest(crop=crop, cycle=cycle, index=index), self.assertRaises(prices.GardenPricingError):
                prices.price_per_gram(crop, cycle_index=cycle, batch_index=index)

    def test_batch_id_requires_real_canonical_planting_and_indices(self):
        planting = str(uuid4())
        parsed = prices.parse_batch_id(f"{planting}:cycle2:batch3", planting)
        self.assertEqual((parsed.planting_id, parsed.cycle_index, parsed.batch_index), (planting, 2, 3))
        for invalid in (f"{planting}:cycle01:batch0", f"{planting}:cycle0:batch-1", f"{planting}:0:0",
                        f"{planting}:cycle0:batch0\n", "fake:cycle0:batch0", f"{planting}:cycle0:batch0:suffix"):
            with self.subTest(batch=invalid), self.assertRaises(prices.GardenPricingError):
                prices.parse_batch_id(invalid)
        with self.assertRaises(prices.GardenPricingError):
            prices.parse_batch_id(f"{planting}:cycle0:batch0", str(uuid4()))


class GardenLotsTest(unittest.TestCase):
    def setUp(self):
        temp = self.enterContext(tempfile.TemporaryDirectory(prefix="garden-lots-"))
        self.engine = create_engine(f"sqlite:///{temp}/market.db")
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.sessions()
        self.addCleanup(self.db.close)
        self.user = User(username="market-user", display_name="fixture", hashed_password="not-a-credential")
        self.db.add(self.user)
        self.db.flush()
        self.agent = Agent(user_id=self.user.id, name="market-agent", persona="fixture", llm_provider="claude",
                           llm_model="unused", encrypted_api_key="")
        self.db.add(self.agent)
        self.db.commit()
        self.owner = f"user:{self.user.id}"
        self.agent_owner = f"agent:{self.agent.id}"
        self.planting = str(uuid4())

    def batch_id(self, index=0, cycle=0):
        return f"{self.planting}:cycle{cycle}:batch{index}"

    def freeze(self, crop="petite_oyster_mushroom", index=0, cycle=0, at=NOW):
        return prices.freeze_batch(self.db, crop_id=crop, planting_id=self.planting,
                                   batch_id=self.batch_id(index, cycle), matured_at=at)

    def credit(self, amount=100, *, owner=None, household=None, crop="petite_oyster_mushroom", index=0,
               cycle=0, kind="steal", at=NOW, source=None, batch=None):
        amount = Fraction(amount)
        row = GardenLedger(source_key=source or f"fixture:{uuid4()}", owner_key=owner or self.owner,
                           household_id=household or self.user.id, crop_id=crop, planting_id=self.planting,
                           batch_id=batch if batch is not None else self.batch_id(index, cycle), kind=kind,
                           quantity_numerator=str(amount.numerator), quantity_denominator=str(amount.denominator),
                           created_at=at)
        self.db.add(row)
        self.db.flush()
        return row

    @staticmethod
    def remaining(lot):
        return Fraction(int(lot.remaining_numerator), int(lot.remaining_denominator))

    def test_freeze_persists_exact_price_and_reuses_first_price_and_timestamp(self):
        frozen = self.freeze()
        expected = Fraction(10 * 6, 7 * 5274)
        self.assertEqual(prices.batch_unit_price(frozen), expected)
        self.assertEqual(frozen.pricing_version, prices.PRICING_VERSION)
        self.db.commit()
        self.db.expunge_all()
        with patch.object(prices.garden_catalog, "get_crop", side_effect=AssertionError("must retain frozen price")):
            same = self.freeze(at=NOW + timedelta(days=500))
        self.assertEqual(prices.batch_unit_price(same), expected)
        self.assertEqual(same.matured_at, NOW)
        self.assertEqual(self.db.query(GardenMarketBatch).count(), 1)

    def test_price_is_independent_of_actual_maturity_or_harvest_delay(self):
        first = self.freeze(at=NOW)
        self.planting = str(uuid4())
        delayed = self.freeze(at=NOW + timedelta(days=1000))
        self.assertEqual(prices.batch_unit_price(first), prices.batch_unit_price(delayed))

    def test_freeze_rejects_conflicting_origin_invalid_time_and_corrupt_saved_price(self):
        frozen = self.freeze()
        with self.assertRaises(prices.GardenPricingError) as conflict:
            self.freeze(crop="daikon")
        self.assertEqual(conflict.exception.code, "batch_price_conflict")
        frozen.price_denominator = "0"
        with self.assertRaises(prices.GardenPricingError) as corrupt:
            self.freeze()
        self.assertEqual(corrupt.exception.code, "invalid_stored_price")
        self.db.rollback()
        with self.assertRaises(prices.GardenPricingError):
            self.freeze(at="not-a-date")

    def test_register_requires_maturity_price_and_does_not_guess_from_credit_time(self):
        credit = self.credit(at=NOW + timedelta(days=300))
        with self.assertRaises(lots.GardenLotError) as error:
            lots.register_lot(self.db, credit)
        self.assertEqual(error.exception.code, "batch_price_missing")
        self.assertEqual(self.db.query(GardenMarketBatch).count(), 0)
        self.assertEqual(self.db.query(GardenMarketLot).count(), 0)

    def test_register_is_idempotent_and_never_restores_a_sold_out_lot(self):
        self.freeze()
        credit = self.credit(Fraction(100, 3))
        lot = lots.register_lot(self.db, credit)
        self.assertEqual(self.remaining(lot), Fraction(100, 3))
        self.assertEqual(lots.register_lot(self.db, credit).id, lot.id)
        lot.remaining_numerator = "0"
        lot.remaining_denominator = "1"
        self.db.commit()
        self.db.expunge_all()
        refreshed = lots.register_lot(self.db, self.db.get(GardenLedger, credit.id))
        self.assertEqual(self.remaining(refreshed), 0)
        self.assertEqual(self.db.query(GardenMarketLot).count(), 1)

    def test_different_mushroom_batches_keep_distinct_prices_within_same_crop(self):
        early, late = self.freeze(index=0), self.freeze(index=5)
        first = lots.register_lot(self.db, self.credit(5274, index=0))
        last = lots.register_lot(self.db, self.credit(198, index=5))
        value = self.remaining(first) * prices.batch_unit_price(early) + self.remaining(last) * prices.batch_unit_price(late)
        self.assertEqual(value, Fraction(190, 7))
        self.assertNotEqual(value, (self.remaining(first) + self.remaining(last)) * prices.batch_unit_price(late))
        self.assertNotEqual(first.batch_id, last.batch_id)

    def test_exact_public_fraction_shares_preserve_total_grams_and_price(self):
        batch = self.freeze()
        created = []
        for index in range(7):
            user = User(username=f"public-{index}", display_name="fixture", hashed_password="unused")
            self.db.add(user)
            self.db.flush()
            credit = self.credit(Fraction(5274, 7), owner=f"user:{user.id}", household=user.id, kind="public_share")
            created.append(lots.register_lot(self.db, credit))
        self.assertTrue(all(self.remaining(row) == Fraction(5274, 7) for row in created))
        self.assertEqual(sum((self.remaining(row) for row in created), Fraction()), 5274)
        self.assertEqual(sum((self.remaining(row) * prices.batch_unit_price(batch) for row in created), Fraction()), Fraction(60, 7))

    def test_lots_do_not_change_stock_or_commit_caller_transaction(self):
        stock = GardenStock(owner_key=self.owner, household_id=self.user.id, crop_id="petite_oyster_mushroom",
                            quantity_numerator="123", quantity_denominator="7")
        self.db.add(stock)
        self.db.commit()
        self.freeze()
        lots.register_lot(self.db, self.credit(100))
        self.assertEqual((stock.quantity_numerator, stock.quantity_denominator), ("123", "7"))
        self.db.rollback()
        self.assertEqual(self.db.query(GardenMarketBatch).count(), 0)
        self.assertEqual(self.db.query(GardenMarketLot).count(), 0)
        self.assertEqual(self.db.query(GardenLedger).count(), 0)
        self.assertEqual(self.db.query(GardenStock).count(), 1)

    def test_register_skips_sale_debits_nonpositive_credits_and_ownerless_losses(self):
        for kind, quantity in (("sale", -100), ("sale", 0), ("harvest", 0), ("steal", -1)):
            self.assertIsNone(lots.register_lot(self.db, self.credit(quantity, kind=kind)))
        loss = self.credit(100, kind="clear_loss")
        loss.owner_key = None
        self.assertIsNone(lots.register_lot(self.db, loss))
        credit = self.credit(100)
        credit.owner_key = None
        self.assertIsNone(lots.register_lot(self.db, credit))
        self.assertEqual(self.db.query(GardenMarketLot).count(), 0)

    def test_unknown_positive_source_invalid_owner_and_incomplete_batch_are_errors(self):
        for changes in ({"kind": "mystery"}, {"kind": "sale"}, {"owner_key": "system:1"},
                        {"owner_key": "user:another"}, {"household_id": None}, {"batch_id": None},
                        {"created_at": None}, {"quantity_denominator": "0"}):
            credit = self.credit()
            for key, value in changes.items():
                setattr(credit, key, value)
            with self.subTest(changes=changes), self.assertRaises((lots.GardenLotError, prices.GardenPricingError)):
                lots.register_lot(self.db, credit)
            self.db.rollback()
        self.assertEqual(self.db.query(GardenMarketLot).count(), 0)

    def test_same_source_cannot_change_owner_crop_or_batch(self):
        self.freeze()
        credit = self.credit()
        lot = lots.register_lot(self.db, credit)
        self.db.flush()
        credit.owner_key = self.agent_owner
        with self.assertRaises(lots.GardenLotError) as error:
            lots.register_lot(self.db, credit)
        self.assertEqual(error.exception.code, "lot_source_conflict")
        self.assertEqual(lot.owner_key, self.owner)

    def test_legacy_rebuild_uses_earliest_same_batch_credit_across_owners(self):
        stolen = self.credit(200, at=NOW + timedelta(hours=2))
        harvested = self.credit(200, owner=self.agent_owner, kind="harvest", at=NOW + timedelta(days=90))
        self.db.commit()
        created = lots.ensure_legacy_lots(self.db, self.agent_owner)
        self.assertEqual(len(created), 1)
        batch = self.db.get(GardenMarketBatch, harvested.batch_id)
        self.assertEqual(batch.pricing_version, prices.LEGACY_PRICING_VERSION)
        self.assertEqual(batch.matured_at, stolen.created_at)
        self.assertEqual(prices.batch_unit_price(batch), prices.price_per_gram(harvested.crop_id, cycle_index=0, batch_index=0))
        self.assertEqual(len(lots.ensure_legacy_lots(self.db, self.owner)), 1)
        self.assertEqual(lots.ensure_legacy_lots(self.db, self.agent_owner), [])

    def test_legacy_marker_and_price_survive_later_live_freeze(self):
        self.credit(100, at=NOW + timedelta(days=20))
        lots.ensure_legacy_lots(self.db, self.owner)
        saved = self.freeze(at=NOW)
        self.assertEqual(saved.pricing_version, prices.LEGACY_PRICING_VERSION)
        self.assertEqual(saved.matured_at, NOW + timedelta(days=20))

    def test_legacy_does_not_replace_existing_live_price(self):
        live = self.freeze(at=NOW)
        self.credit(100, at=NOW + timedelta(days=40))
        lots.ensure_legacy_lots(self.db, self.owner)
        self.assertEqual(live.pricing_version, prices.PRICING_VERSION)
        self.assertEqual(live.matured_at, NOW)

    def test_legacy_replay_after_sale_keeps_partial_and_zero_lots(self):
        original = self.credit(100)
        partial = self.credit(Fraction(100, 3), index=1)
        created = lots.ensure_legacy_lots(self.db, self.owner)
        self.assertEqual(len(created), 2)
        created[0].remaining_numerator = "0"
        created[1].remaining_numerator = "50"
        created[1].remaining_denominator = "3"
        self.credit(-100, kind="sale", source=f"sale:{self.owner}:request:{created[0].id}")
        self.credit(Fraction(-50, 3), kind="sale", index=1, source=f"sale:{self.owner}:request:{created[1].id}")
        self.db.commit()
        self.assertEqual(lots.ensure_legacy_lots(self.db, self.owner), [])
        self.assertEqual([self.remaining(row) for row in created], [0, Fraction(50, 3)])
        self.assertEqual(self.db.query(GardenMarketLot).count(), 2)

    def test_legacy_crop_filter_does_not_reconstruct_another_crop(self):
        self.credit(100)
        second_planting = self.planting
        self.planting = str(uuid4())
        self.credit(100, crop="daikon")
        self.planting = second_planting
        created = lots.ensure_legacy_lots(self.db, self.owner, crop_id="daikon")
        self.assertEqual([row.crop_id for row in created], ["daikon"])
        self.assertEqual(self.db.query(GardenMarketLot).count(), 1)

    def test_legacy_unknown_or_unreconstructable_sources_fail_without_guessing(self):
        for changes in ({"kind": "unexplained_bonus"}, {"crop_id": "lost-crop"}, {"batch_id": "old-unknown-format"}):
            credit = self.credit(100)
            for key, value in changes.items():
                setattr(credit, key, value)
            self.db.flush()
            with self.subTest(changes=changes), self.assertRaises((lots.GardenLotError, prices.GardenPricingError)):
                lots.ensure_legacy_lots(self.db, self.owner)
            self.db.rollback()
            self.assertEqual(self.db.query(GardenMarketLot).count(), 0)
            self.assertEqual(self.db.query(GardenMarketBatch).count(), 0)

    def test_legacy_conflicting_crop_for_same_batch_is_rejected(self):
        self.credit(100)
        self.credit(100, owner=self.agent_owner, crop="daikon", kind="harvest")
        with self.assertRaises(lots.GardenLotError) as error:
            lots.ensure_legacy_lots(self.db, self.owner)
        self.assertEqual(error.exception.code, "legacy_batch_conflict")
        self.assertEqual(self.db.query(GardenMarketLot).count(), 0)


if __name__ == "__main__":
    unittest.main()
