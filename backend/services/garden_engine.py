"""Pure, deterministic garden simulation; persistence and actor permissions live outside.

Call ``advance`` inside the same transaction immediately before an action. All
timestamps are server UTC; naive database datetimes are interpreted as UTC.
Growth uses rational microseconds, so splitting a catch-up into refreshes cannot
gain time. State is plain JSON. Care settles once per six real hours from planting;
maturity can fall between care ticks and is rounded up by at most one microsecond.
The shared calendar starts at 2026-01-01 at the persisted world epoch and advances
sevenfold through the Gregorian calendar, independently of a plant's health.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from fractions import Fraction
import hashlib
import math

from services.garden_catalog import get_crop, get_rules


UTC = timezone.utc
CALENDAR_START = datetime(2026, 1, 1, tzinfo=UTC)
DAY_US = 86_400_000_000
HOUR_US = 3_600_000_000
TIME_MULTIPLIER = 7
CARE_TICK_US = 6 * HOUR_US
_TERMINAL = {"empty", "dead"}


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _dt(value: str) -> datetime:
    return _utc(datetime.fromisoformat(value))


def _micros(delta: timedelta) -> int:
    return (delta.days * 86_400 + delta.seconds) * 1_000_000 + delta.microseconds


def _f(value) -> Fraction:
    return Fraction(str(value))


def garden_datetime(now: datetime, epoch: datetime) -> datetime:
    return CALENDAR_START + timedelta(microseconds=_micros(_utc(now) - _utc(epoch)) * TIME_MULTIPLIER)


def garden_month(now: datetime, epoch: datetime) -> int:
    return garden_datetime(now, epoch).month


def _next_month(now: datetime, epoch: datetime) -> datetime:
    virtual = garden_datetime(now, epoch)
    year, month = (virtual.year + 1, 1) if virtual.month == 12 else (virtual.year, virtual.month + 1)
    boundary = datetime(year, month, 1, tzinfo=UTC)
    return _utc(epoch) + timedelta(microseconds=math.ceil(Fraction(_micros(boundary - CALENDAR_START), TIME_MULTIPLIER)))


def _season_factor(crop: dict, now: datetime, epoch: datetime, kind: str) -> Fraction:
    season = get_rules()["v1_defaults"]["season"]
    preferred = garden_month(now, epoch) in crop["care"]["preferred_months"]
    return _f(season[f"{'preferred' if preferred else 'other'}_month_{kind}"])


def _random_draw(seed: str, planting_id: str, tick_index: int, event_kind: str) -> float:
    # Length framing prevents delimiter ambiguities between independent inputs.
    parts = [str(seed), str(planting_id), str(tick_index), event_kind]
    key = "".join(f"{len(part)}:{part}" for part in parts).encode("utf-8")
    return int.from_bytes(hashlib.sha256(key).digest()[:8], "big") / 2**64


def _clamp(value) -> float:
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("Garden condition must be finite")
    return min(100.0, max(0.0, value))


def _environment_problems(state: dict) -> set[str]:
    rules = get_rules()["v1_defaults"]["care"]
    problems = set()
    if state["moisture"] < rules["water_needed_below"]:
        problems.add("water")
    if state["moisture"] > rules["critical_wet_above"]:
        problems.add("waterlogging")
    if state["nutrients"] < rules["nutrients_needed_below"]:
        problems.add("nutrients")
    return problems


def _update_problems(state: dict, now: datetime) -> None:
    active = _environment_problems(state)
    if state.get("random_problem"):
        active.add("random_problem")
    previous = state.get("problem_since", {})
    state["problem_since"] = {key: previous.get(key, now.isoformat()) for key in sorted(active)}
    state["needs"] = sorted(active)


def _condition_growth_rate(state: dict) -> Fraction:
    rules = get_rules()["v1_defaults"]["care"]
    if state["moisture"] < rules["critical_dry_below"]:
        return _f(rules["critical_dry_growth_rate"])
    return _f(rules["unresolved_problem_growth_rate"] if state["problem_since"] else rules["healthy_growth_rate"])


def _tick_index(state: dict, at: datetime) -> int:
    # All maturities in (previous_tick, this_tick] share one harvest epoch.
    return max(0, math.ceil(Fraction(_micros(at - _dt(state["planted_at"])), CARE_TICK_US)))


def _event(state: dict, kind: str, at: datetime, **fields) -> dict:
    return {"kind": kind, "at": at.isoformat(), "tick_index": _tick_index(state, at), **fields}


def new_planting(crop_id: str, planting_id: str, now: datetime, *, epoch: datetime,
                 seed: str, public: bool = False, area_scale: str = "1") -> dict:
    crop = get_crop(crop_id)
    now, epoch = _utc(now), _utc(epoch)
    scale = _f(area_scale)
    if not planting_id or scale <= 0:
        raise ValueError("Planting identity and positive area scale are required")
    if now < epoch:
        raise ValueError("Planting cannot predate the garden epoch")
    rules = get_rules()["v1_defaults"]["care"]
    return {
        "version": 1, "planting_id": str(planting_id), "crop_id": crop_id,
        "status": "growing", "end_behavior": crop["harvest"]["end_behavior"],
        "terminal_reason": None, "health": rules["initial_health"],
        "moisture": rules["initial_moisture"], "nutrients": rules["initial_nutrients"],
        "planted_at": now.isoformat(), "last_advanced_at": now.isoformat(),
        "epoch_at": epoch.isoformat(), "public": bool(public), "area_scale": str(scale),
        "last_care_tick": 0, "effective_growth_us": "0",
        "next_cycle_index": 0, "next_batch_index": 0,
        "next_due_growth_us": str(_f(crop["harvest"]["maturity_offsets_days"][0]) * DAY_US),
        "all_batches_generated": False, "batches": {}, "problem_since": {}, "needs": [],
        "random_problem": None, "last_random_decision": None,
    }


def _status(state: dict, crop: dict) -> None:
    if state["status"] in _TERMINAL:
        return
    if any(batch["status"] == "ready" for batch in state["batches"].values()):
        state["status"] = "harvest_ready"
    elif state["all_batches_generated"]:
        state["status"] = "empty" if crop["harvest"]["end_behavior"] == "empty" else "production_complete"
        state["terminal_reason"] = crop["harvest"]["end_behavior"]
        state.setdefault("production_completed_at", state["last_advanced_at"])
    else:
        state["status"] = "regrowing" if state["batches"] else "growing"


def _die(state: dict, at: datetime, events: list[dict]) -> None:
    if state["status"] == "dead":
        return
    state["health"] = 0
    state["status"] = "dead"
    state["terminal_reason"] = "whole_plant_failure"
    state["died_at"] = at.isoformat()
    state["next_due_growth_us"] = None
    state["all_batches_generated"] = True
    for batch in state["batches"].values():
        if batch["status"] == "ready":
            quantity = batch["remaining_g"]
            batch.update(status="lost", remaining_g=0, closed_at=at.isoformat(), lost_g=quantity)
            if quantity:
                events.append(_event(state, "loss", at, batch_id=batch["id"], quantity_g=quantity,
                                     reason="whole_plant_failure"))
    events.append(_event(state, "plant_died", at, quantity_g=0))


def _care_tick(state: dict, crop: dict, at: datetime, seed: str, events: list[dict]) -> None:
    defaults = get_rules()["v1_defaults"]
    rules, random_rules = defaults["care"], defaults["random_problems"]
    hours = rules["tick_real_hours"]
    state["moisture"] = _clamp(_f(state["moisture"]) - _f(rules["moisture_loss_per_real_hour"][crop["care"]["water_profile"]]) * hours)
    state["nutrients"] = _clamp(_f(state["nutrients"]) - _f(rules["nutrient_loss_per_real_hour"]) * hours)
    state["last_care_tick"] += 1
    environment = _environment_problems(state)
    # Each tick has exactly one deterministic, persisted decision, even when the
    # existing problem or a completed production cycle makes a new one ineligible.
    draw = _random_draw(seed, state["planting_id"], state["last_care_tick"], "crop_problem")
    probability = _f(random_rules["base_probability_per_care_tick"])
    if environment:
        probability *= _f(random_rules["unresolved_environment_problem_multiplier"])
    eligible = state["status"] in {"growing", "harvest_ready", "regrowing"} and not state["random_problem"]
    triggered = eligible and draw < probability
    state["last_random_decision"] = {"tick_index": state["last_care_tick"], "draw": draw,
                                     "probability": float(probability), "triggered": bool(triggered)}
    if triggered:
        state["random_problem"] = {
            "kind": "contamination" if crop["care"]["water_profile"] == "humidity" else "pests",
            "label": random_rules["mushroom_label"] if crop["care"]["water_profile"] == "humidity" else random_rules["other_crop_label"],
            "started_at": at.isoformat(), "tick_index": state["last_care_tick"],
        }
    _update_problems(state, at)
    old_problems = sum(at - _dt(since) >= timedelta(hours=rules["unresolved_problem_grace_real_hours"])
                       for since in state["problem_since"].values())
    if old_problems:
        loss = min(rules["maximum_health_loss_per_tick"], old_problems * rules["health_loss_per_problem_per_tick_after_grace"])
        state["health"] = _clamp(state["health"] - loss)
    elif not state["problem_since"]:
        state["health"] = _clamp(state["health"] + rules["healthy_recovery_per_tick"])
    if state["health"] <= rules["death_health_at_or_below"]:
        _die(state, at, events)


def _schedule_after_close(state: dict, crop: dict, batch: dict) -> None:
    harvest = crop["harvest"]
    if harvest["clock"] == "after_harvest" and not state["all_batches_generated"]:
        next_index = state["next_batch_index"]
        offsets = harvest["maturity_offsets_days"]
        interval = _f(offsets[next_index]) - _f(offsets[batch["batch_index"]])
        state["next_due_growth_us"] = str(_f(state["effective_growth_us"]) + interval * DAY_US)
    _status(state, crop)


def _mature(state: dict, crop: dict, at: datetime, epoch: datetime, events: list[dict], public: bool) -> None:
    harvest = crop["harvest"]
    cycle, index = state["next_cycle_index"], state["next_batch_index"]
    identity = f"{state['planting_id']}:cycle{cycle}:batch{index}"
    if identity in state["batches"]:
        raise ValueError("A mature batch cannot be generated twice")
    health_rules = get_rules()["v1_defaults"]["care"]
    health_factor = min(Fraction(1), max(_f(health_rules["minimum_positive_harvest_health_factor"]), _f(state["health"]) / 100))
    first_factor = Fraction(1)
    if cycle == 0:
        factors = harvest.get("first_cycle_yield_factors_by_batch")
        first_factor = _f(factors[index] if factors else harvest.get("first_cycle_yield_factor", 1))
    season_factor = _season_factor(crop, at, epoch, "yield_factor")
    nominal = harvest["yield_g_per_plot_by_batch"][index]
    quantity = 2 * math.floor(_f(nominal) * _f(state["area_scale"]) * season_factor * health_factor * first_factor / 2)
    batch = {
        "id": identity, "cycle_index": cycle, "batch_index": index,
        "yield_g": quantity, "remaining_g": quantity, "stolen": False,
        "status": "ready" if quantity > 0 else "failed", "matured_at": at.isoformat(),
        "season_factor": str(season_factor), "health_factor": str(health_factor),
        "first_cycle_factor": str(first_factor), "garden_month": garden_month(at, epoch),
    }
    state["batches"][identity] = batch
    if index + 1 < len(harvest["maturity_offsets_days"]):
        state["next_batch_index"] += 1
    elif harvest["end_behavior"] == "repeat_perennial_cycle":
        state["next_cycle_index"] += 1
        state["next_batch_index"] = 0
    else:
        state["all_batches_generated"] = True
    state["next_due_growth_us"] = None
    if not state["all_batches_generated"] and harvest["clock"] == "independent":
        offset = _f(harvest["maturity_offsets_days"][state["next_batch_index"]])
        offset += state["next_cycle_index"] * _f(harvest["repeat_cycle_days"])
        state["next_due_growth_us"] = str(offset * DAY_US)
    if quantity == 0:
        batch["closed_at"] = at.isoformat()
        events.append(_event(state, "batch_failed", at, batch_id=identity, quantity_g=0))
        _schedule_after_close(state, crop, batch)
    elif public:
        batch.update(status="harvested", remaining_g=0, harvested_at=at.isoformat(), closed_at=at.isoformat())
        events.append(_event(state, "public_harvest", at, batch_id=identity, quantity_g=quantity))
        _schedule_after_close(state, crop, batch)
    else:
        events.append(_event(state, "batch_ready", at, batch_id=identity, quantity_g=quantity))
    _status(state, crop)


def advance(state: dict, now: datetime, *, epoch: datetime, seed: str, public: bool = False) -> list[dict]:
    """Advance exactly to server ``now``; replaying the same time emits nothing."""
    now, epoch = _utc(now), _utc(epoch)
    cursor = _dt(state["last_advanced_at"])
    if now < cursor:
        raise ValueError("Garden time cannot move backwards")
    if epoch != _dt(state["epoch_at"]) or bool(public) != state["public"]:
        raise ValueError("Garden epoch and planting scope cannot change")
    crop = get_crop(state["crop_id"])
    events: list[dict] = []
    for key in ("health", "moisture", "nutrients"):
        state[key] = _clamp(state[key])
    _update_problems(state, cursor)
    if state["health"] <= 0 and state["status"] != "empty":
        _die(state, cursor, events)
    while cursor < now and state["status"] not in _TERMINAL and not (public and state["status"] == "production_complete"):
        next_tick = _dt(state["planted_at"]) + timedelta(microseconds=(state["last_care_tick"] + 1) * CARE_TICK_US)
        boundary = min(now, next_tick, _next_month(cursor, epoch))
        rate = _condition_growth_rate(state) * _season_factor(crop, cursor, epoch, "growth_rate") * TIME_MULTIPLIER
        growth = _f(state["effective_growth_us"])
        due = state["next_due_growth_us"]
        if due is not None and rate > 0:
            remaining = max(Fraction(0), _f(due) - growth)
            maturity = cursor + timedelta(microseconds=math.ceil(remaining / rate))
            boundary = min(boundary, maturity)
        state["effective_growth_us"] = str(growth + _micros(boundary - cursor) * rate)
        cursor = boundary
        state["last_advanced_at"] = cursor.isoformat()
        if due is not None and _f(state["effective_growth_us"]) >= _f(due):
            _mature(state, crop, cursor, epoch, events, public)
        if cursor == next_tick and state["status"] not in _TERMINAL and not (public and state["status"] == "production_complete"):
            _care_tick(state, crop, cursor, seed, events)
    state["last_advanced_at"] = now.isoformat()
    _status(state, crop)
    return events


def _require_advanced(state: dict, now: datetime) -> datetime:
    now = _utc(now)
    if now != _dt(state["last_advanced_at"]):
        raise ValueError("Advance planting to the action's server timestamp first")
    return now


def care(state: dict, action: str, now: datetime) -> None:
    now = _require_advanced(state, now)
    if action not in {"water", "care"}:
        raise ValueError("Unknown garden care action")
    if state["status"] in _TERMINAL:
        raise ValueError("An empty or dead plot cannot be cared for")
    rules = get_rules()["v1_defaults"]["care"]
    for key in ("health", "moisture", "nutrients"):
        state[key] = _clamp(state[key])
    if action == "water":
        state["moisture"] = max(state["moisture"], rules["initial_moisture"])
    else:
        state["random_problem"] = None
        if state["moisture"] < rules["water_needed_below"]:
            state["moisture"] = rules["initial_moisture"]
        elif state["moisture"] > rules["critical_wet_above"]:
            state["moisture"] = rules["drained_moisture_target"]
        if state["nutrients"] < rules["nutrients_needed_below"]:
            state["nutrients"] = rules["nutrient_restore_target"]
    _update_problems(state, now)


def harvest(state: dict, batch_id: str, now: datetime) -> int:
    now = _require_advanced(state, now)
    if state["status"] in _TERMINAL:
        raise ValueError("An empty or dead plot cannot be harvested")
    batch = state["batches"].get(batch_id)
    if not batch or batch["status"] != "ready":
        raise ValueError("Batch is not available for harvest")
    quantity = batch["remaining_g"]
    batch.update(status="harvested", remaining_g=0, harvested_at=now.isoformat(), closed_at=now.isoformat())
    _schedule_after_close(state, get_crop(state["crop_id"]), batch)
    return quantity
