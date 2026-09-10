"""Offline executable coverage for every delivered crop and deterministic clocks."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from fractions import Fraction
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from services import garden_engine as E
from services.garden_catalog import DATA_DIR, get_crop, list_crops, load_catalog, verify_manifest


START = datetime(2026, 1, 1, tzinfo=timezone.utc)
SEED = "isolated-garden-engine-fixture"


def planting(crop_id, **kwargs):
    return E.new_planting(crop_id, f"fixture:{crop_id}:planting1", START, epoch=START, seed=SEED, **kwargs)


def instant(days) -> datetime:
    return START + timedelta(microseconds=math.ceil(Fraction(str(days)) * E.DAY_US / 7))


def healthy_advance(state, target, public=False):
    events = []
    current = datetime.fromisoformat(state["last_advanced_at"])
    while current < target:
        next_tick = START + timedelta(hours=6 * (state["last_care_tick"] + 1))
        current = min(next_tick, target)
        events += E.advance(state, current, epoch=START, seed=SEED, public=public)
        if state["status"] not in {"empty", "dead"}:
            E.care(state, "care", current)
    return events


class GardenCatalogTest(unittest.TestCase):
    def test_exact_delivered_files_and_twelve_cards(self):
        self.assertTrue(verify_manifest()["ready_for_backend"])
        self.assertEqual(len(list_crops()), 12)
        catalog = load_catalog()
        catalog["crops"][0]["name"] = "changed only in caller"
        self.assertEqual(get_crop("daikon")["name"], "白蘿蔔")
        with self.assertRaisesRegex(ValueError, "Unknown"):
            get_crop("old_preview_crop")

    def test_tampered_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            for source in DATA_DIR.iterdir():
                (directory / source.name).write_bytes(source.read_bytes())
            (directory / "crops.json").write_text("{}")
            with self.assertRaisesRegex(ValueError, "checksum"):
                verify_manifest(directory)


class GardenEngineTest(unittest.TestCase):
    def setUp(self):
        self.random_patch = patch.object(E, "_random_draw", return_value=1.0)
        self.random_patch.start()
        self.addCleanup(self.random_patch.stop)

    def ideal_season(self):
        return patch.object(E, "_season_factor", return_value=Fraction(1))

    def test_all_twelve_first_maturity_exact_time_yield_and_no_theft_grace(self):
        contracts = json.loads((DATA_DIR / "acceptance.json").read_text())["crop_lifecycles"]
        with self.ideal_season():
            for contract in contracts:
                with self.subTest(crop=contract["crop_id"]):
                    state = planting(contract["crop_id"])
                    seconds = Fraction(contract["nominal_first_maturity_real_seconds_exact"])
                    maturity = START + timedelta(microseconds=math.ceil(seconds * 1_000_000))
                    healthy_advance(state, maturity - timedelta(microseconds=1))
                    self.assertEqual(state["batches"], {})
                    with self.assertRaises(ValueError):
                        E.harvest(state, "missing", maturity - timedelta(microseconds=1))
                    healthy_advance(state, maturity)
                    expected = contract["actions_and_expected_results"][2]["expected"]
                    batch = state["batches"][expected["batch_id"]]
                    self.assertEqual(batch["yield_g"], expected["yield_g"])
                    self.assertEqual(batch["matured_at"], maturity.isoformat())
                    self.assertEqual(batch["status"], "ready")
                    self.assertFalse(batch["stolen"])
                    batch["stolen"] = True
                    batch["remaining_g"] -= batch["yield_g"] // 2
                    self.assertEqual(E.harvest(state, batch["id"], maturity), expected["yield_g"] // 2)
                    with self.assertRaises(ValueError):
                        E.harvest(state, batch["id"], maturity)
                    # A persisted JSON round-trip cannot regenerate an old batch.
                    restored = json.loads(json.dumps(state))
                    self.assertEqual(E.advance(restored, maturity, epoch=START, seed=SEED), [])
                    self.assertEqual(restored, state)

    def test_all_twelve_entire_first_production_cycles_match_delivered_totals(self):
        contracts = json.loads((DATA_DIR / "acceptance.json").read_text())["crop_lifecycles"]
        with self.ideal_season():
            for contract in contracts:
                with self.subTest(crop=contract["crop_id"]):
                    state = planting(contract["crop_id"])
                    crop = get_crop(contract["crop_id"])
                    count = len(crop["harvest"]["maturity_offsets_days"])
                    current = START
                    total = 0
                    for _ in range(600):
                        current += timedelta(hours=6)
                        E.advance(state, current, epoch=START, seed=SEED)
                        for batch in list(state["batches"].values()):
                            if batch["status"] == "ready" and batch["cycle_index"] == 0:
                                total += E.harvest(state, batch["id"], current)
                        if len([b for b in state["batches"].values() if b["cycle_index"] == 0 and b["status"] == "harvested"]) == count:
                            break
                        E.care(state, "care", current)
                    else:
                        self.fail("Crop did not complete its production cycle")
                    self.assertEqual(total, contract["first_production_cycle_total_g"])
                    self.assertEqual(state["health"], 100)
                    expected_status = {"empty": "empty", "repeat_perennial_cycle": "regrowing"}.get(contract["end_behavior"], "production_complete")
                    self.assertEqual(state["status"], expected_status)
                    if contract["end_behavior"] == "substrate_spent":
                        self.assertEqual(state["terminal_reason"], "substrate_spent")

    def test_after_harvest_waits_for_actual_remainder_not_theft(self):
        with self.ideal_season():
            state = planting("water_spinach")
            first = instant(23)
            healthy_advance(state, first)
            batch = next(iter(state["batches"].values()))
            batch.update(stolen=True, remaining_g=batch["yield_g"] // 2)
            delayed = first + timedelta(days=5)
            healthy_advance(state, delayed)
            self.assertEqual(len(state["batches"]), 1)
            self.assertIsNone(state["next_due_growth_us"])
            E.harvest(state, batch["id"], delayed)
            due = delayed + timedelta(days=3)  # 21 cultivation days / 7, once.
            healthy_advance(state, due - timedelta(microseconds=1))
            self.assertEqual(len(state["batches"]), 1)
            healthy_advance(state, due)
            new = list(state["batches"].values())[1]
            self.assertEqual(new["matured_at"], due.isoformat())
            self.assertEqual(new["yield_g"], 3546)
            self.assertFalse(new["stolen"])

    def test_independent_batches_overlap_and_never_reset_theft_or_merge(self):
        with self.ideal_season():
            state = planting("cucumber")
            healthy_advance(state, instant(44))
            first = next(iter(state["batches"].values()))
            first.update(stolen=True, remaining_g=214)
            healthy_advance(state, instant(46))
            self.assertEqual(len(state["batches"]), 3)
            self.assertEqual(first["remaining_g"], 214)
            self.assertTrue(first["stolen"])
            self.assertEqual(len({b["id"] for b in state["batches"].values()}), 3)
            self.assertFalse(list(state["batches"].values())[1]["stolen"])

    def test_perennial_two_complete_cycles_do_not_repeat_nursery_or_initial_factors(self):
        with self.ideal_season():
            state = planting("vegetable_fern", public=True)
            events = healthy_advance(state, instant(811), public=True)
            self.assertEqual(len(state["batches"]), 104)
            cycle0 = [event for event in events if ":cycle0:" in event.get("batch_id", "")]
            cycle1 = [event for event in events if ":cycle1:" in event.get("batch_id", "")]
            self.assertEqual(sum(e["quantity_g"] for e in cycle0), 15046)
            self.assertEqual(sum(e["quantity_g"] for e in cycle1), 15996)
            new_first = state["batches"][f"{state['planting_id']}:cycle1:batch0"]
            self.assertEqual(new_first["yield_g"], 314)
            self.assertEqual(new_first["matured_at"], instant(454).isoformat())
            self.assertEqual(state["status"], "regrowing")
            self.assertFalse(state["all_batches_generated"])
            self.assertIsNone(state["terminal_reason"])

    def test_zero_yield_after_harvest_closes_all_batches_without_a_softlock(self):
        with self.ideal_season():
            state = planting("water_spinach", area_scale="0.000001")
            events = healthy_advance(state, instant(129))
            self.assertEqual(len(state["batches"]), 6)
            self.assertTrue(all(b["status"] == "failed" and b["remaining_g"] == 0 for b in state["batches"].values()))
            self.assertEqual(state["status"], "production_complete")
            self.assertEqual([event["kind"] for event in events], ["batch_failed"] * 6)

    def test_public_auto_harvest_has_stable_tick_groups_and_area_applied_once(self):
        with self.ideal_season():
            state = planting("cucumber", public=True, area_scale="80")
            events = healthy_advance(state, instant(46), public=True)
            harvests = [event for event in events if event["kind"] == "public_harvest"]
            self.assertEqual([event["quantity_g"] for event in harvests], [428 * 80, 430 * 80, 428 * 80])
            self.assertEqual(harvests[0]["tick_index"], harvests[1]["tick_index"])
            self.assertTrue(all(batch["status"] == "harvested" for batch in state["batches"].values()))
            self.assertEqual(E.advance(state, instant(46), epoch=START, seed=SEED, public=True), [])
            mushrooms = planting("petite_oyster_mushroom", public=True, area_scale="80")
            mushroom_events = healthy_advance(mushrooms, instant(6), public=True)
            self.assertEqual(mushroom_events[0]["quantity_g"], 5274 * 80)

    def test_mature_health_factor_is_bounded_and_even_grams_preserve_exact_half(self):
        crop = get_crop("petite_oyster_mushroom")
        crop["harvest"]["maturity_offsets_days"] = [Fraction(1, 7)]
        crop["harvest"]["yield_g_per_plot_by_batch"] = [202]
        with self.ideal_season(), patch.object(E, "get_crop", return_value=crop):
            for health, expected in ((101, 202), (50, 100), (1, 40)):
                with self.subTest(health=health):
                    state = planting("petite_oyster_mushroom")
                    state["health"] = health
                    at = instant(Fraction(1, 7))
                    E.advance(state, at, epoch=START, seed=SEED)
                    batch = next(iter(state["batches"].values()))
                    self.assertEqual(batch["yield_g"], expected)
                    self.assertEqual(batch["yield_g"] % 2, 0)
                    self.assertLessEqual(state["health"], 100)

    def test_public_completion_stops_catchup_before_later_neglect_and_vote(self):
        crop = get_crop("water_spinach")
        crop["harvest"]["maturity_offsets_days"] = [1]
        crop["harvest"]["yield_g_per_plot_by_batch"] = [200]
        with self.ideal_season(), patch.object(E, "get_crop", return_value=crop):
            state = planting("water_spinach", public=True)
            events = E.advance(state, START + timedelta(days=30), epoch=START, seed=SEED, public=True)
            self.assertEqual(state["status"], "production_complete")
            self.assertEqual(state["health"], 100)
            self.assertEqual(state["production_completed_at"], instant(1).isoformat())
            self.assertEqual([e["kind"] for e in events], ["public_harvest"])
            self.assertEqual(events[0]["at"], instant(1).isoformat())

    def test_production_random_draw_has_stable_framed_inputs(self):
        self.random_patch.stop()
        original = E._random_draw(SEED, "plant", 7, "crop_problem")
        self.assertEqual(original, E._random_draw(SEED, "plant", 7, "crop_problem"))
        self.assertGreaterEqual(original, 0)
        self.assertLess(original, 1)
        self.assertNotEqual(original, E._random_draw(SEED, "plant", 8, "crop_problem"))
        self.assertNotEqual(E._random_draw("a:b", "c", 7, "crop_problem"),
                            E._random_draw("a", "b:c", 7, "crop_problem"))

    def test_whole_plant_failure_only_loses_unclaimed_stock_and_cancels_future(self):
        with self.ideal_season():
            state = planting("vegetable_fern")
            mature = instant(90)
            healthy_advance(state, mature)
            first = next(iter(state["batches"].values()))
            first.update(stolen=True, remaining_g=78)
            # Continue actual neglect ticks until the plant dies.
            events = E.advance(state, mature + timedelta(days=20), epoch=START, seed=SEED)
            self.assertEqual(state["status"], "dead")
            losses = [e for e in events if e["kind"] == "loss"]
            self.assertEqual(next(e for e in losses if e["batch_id"] == first["id"])["quantity_g"], 78)
            self.assertEqual(first["status"], "lost")
            self.assertIsNone(state["next_due_growth_us"])
            self.assertEqual(len([e for e in events if e["kind"] == "plant_died"]), 1)
            self.assertEqual(E.advance(state, mature + timedelta(days=200), epoch=START, seed=SEED), [])
            self.assertTrue(all(b["status"] != "ready" for b in state["batches"].values()))

    def test_refresh_segmentation_is_identical_and_does_not_advance_clock(self):
        whole = planting("tomato")
        split = deepcopy(whole)
        target = START + timedelta(hours=32, seconds=17, microseconds=33)
        one_events = E.advance(whole, target, epoch=START, seed=SEED)
        split_events = []
        for minutes in range(13, 32 * 60, 13):
            split_events += E.advance(split, START + timedelta(minutes=minutes), epoch=START, seed=SEED)
        split_events += E.advance(split, target, epoch=START, seed=SEED)
        self.assertEqual(split, whole)
        self.assertEqual(split_events, one_events)
        before = deepcopy(split)
        self.assertEqual(E.advance(split, target, epoch=START, seed=SEED), [])
        self.assertEqual(split, before)
        with self.assertRaisesRegex(ValueError, "backwards"):
            E.advance(split, target - timedelta(microseconds=1), epoch=START, seed=SEED)

    def test_pests_are_deterministic_environment_probability_doubles_and_grace_is_real(self):
        state = planting("carrot")
        with patch.object(E, "_random_draw", return_value=0.015) as draw:
            E.advance(state, START + timedelta(hours=12), epoch=START, seed=SEED)
            self.assertIsNone(state["random_problem"])
            E.advance(state, START + timedelta(hours=18), epoch=START, seed=SEED)
            self.assertEqual(state["last_random_decision"]["probability"], 0.02)
            self.assertIsNotNone(state["random_problem"])
            E.advance(state, START + timedelta(hours=18), epoch=START, seed=SEED)
            self.assertEqual(draw.call_count, 3)
            self.assertEqual(state["health"], 100)
            E.advance(state, START + timedelta(hours=36), epoch=START, seed=SEED)
            self.assertEqual(state["health"], 100)
            E.advance(state, START + timedelta(hours=42), epoch=START, seed=SEED)
            self.assertEqual(state["health"], 90)  # two unresolved problems, bounded damage

    def test_water_only_and_repeated_care_do_not_stack_healing_growth_or_random_draws(self):
        state = planting("carrot")
        current = START + timedelta(hours=6)
        with patch.object(E, "_random_draw", return_value=0) as draw:
            E.advance(state, current, epoch=START, seed=SEED)
            state.update(health=70, nutrients=10, moisture=10)
            E.care(state, "water", current)
            self.assertEqual(state["moisture"], 80)
            self.assertEqual(state["nutrients"], 10)
            self.assertIsNotNone(state["random_problem"])
            growth = state["effective_growth_us"]
            for _ in range(5):
                E.care(state, "care", current)
                E.care(state, "water", current)
            self.assertEqual(draw.call_count, 1)
            self.assertEqual(state["health"], 70)
            self.assertEqual(state["moisture"], 80)
            self.assertEqual(state["nutrients"], 80)
            self.assertIsNone(state["random_problem"])
            self.assertEqual(state["effective_growth_us"], growth)
            state["health"] = 99
            E.advance(state, current + timedelta(hours=6), epoch=START, seed=SEED)
            # New pest draws prevent healing; independently validate bounded recovery.
        E.care(state, "care", current + timedelta(hours=6))
        E.advance(state, current + timedelta(hours=12), epoch=START, seed=SEED)
        self.assertEqual(state["health"], 100)

    def test_calendar_gregorian_months_growth_and_yield_anchor_at_maturity(self):
        february = instant(31)
        self.assertEqual(E.garden_month(february - timedelta(microseconds=1), START), 1)
        self.assertEqual(E.garden_month(february, START), 2)
        self.assertEqual(E.garden_month(instant(59), START), 3)
        self.assertEqual(E.garden_month(instant(365), START), 1)
        crop = get_crop("daikon")
        crop["care"]["preferred_months"] = [1]
        crop["harvest"]["maturity_offsets_days"] = [32]
        crop["harvest"]["yield_g_per_plot_by_batch"] = [200]
        with patch.object(E, "get_crop", return_value=crop):
            state = planting("daikon")
            # January contributes 31 growth days; February contributes the last
            # growth day at 0.85. Rounding the calendar boundary to microseconds
            # may move maturity by at most one microsecond.
            due = instant(Fraction(31) + Fraction(20, 17))
            healthy_advance(state, due - timedelta(microseconds=2))
            self.assertEqual(state["batches"], {})
            healthy_advance(state, due + timedelta(microseconds=1))
            batch = next(iter(state["batches"].values()))
            self.assertEqual(batch["garden_month"], 2)
            self.assertEqual(batch["yield_g"], 170)
            locked = deepcopy(batch)
            state["health"] = 20
            healthy_advance(state, due + timedelta(days=1))
            self.assertEqual(batch, locked)

    def test_negligence_stops_growth_and_healthy_recovery_resumes_without_reset(self):
        with self.ideal_season():
            state = planting("carrot")
            E.advance(state, START + timedelta(hours=24), epoch=START, seed=SEED)
            self.assertLess(state["moisture"], 15)
            growth = state["effective_growth_us"]
            E.advance(state, START + timedelta(hours=30), epoch=START, seed=SEED)
            self.assertEqual(state["effective_growth_us"], growth)
            E.care(state, "care", START + timedelta(hours=30))
            E.advance(state, START + timedelta(hours=31), epoch=START, seed=SEED)
            self.assertEqual(Fraction(state["effective_growth_us"]) - Fraction(growth), 7 * E.HOUR_US)

    def test_wrong_scope_epoch_and_actions_cannot_change_server_time(self):
        state = planting("daikon")
        for kwargs in ({"epoch": START + timedelta(seconds=1)}, {"public": True}):
            options = {"epoch": START, "seed": SEED, **kwargs}
            with self.assertRaises(ValueError):
                E.advance(state, START, **options)
        with self.assertRaises(ValueError):
            E.care(state, "care", START + timedelta(seconds=1))
        with self.assertRaises(ValueError):
            E.care(state, "fertilize", START)
        with self.assertRaises(ValueError):
            E.new_planting("daikon", "x", START, epoch=START, seed=SEED, area_scale="0")


if __name__ == "__main__":
    unittest.main()
