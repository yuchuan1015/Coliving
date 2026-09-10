"""Authoritative garden transactions shared by web users, MCP agents and the timer.

SQLite BEGIN IMMEDIATE serializes independent API/MCP/timer processes before
reading a plot. The stock credit, batch change, ledger and replay response commit
together. Fraction strings retain exactly equal public shares across restarts.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from fractions import Fraction
from functools import lru_cache
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.agent import Agent
from models.user import User
from models.garden import GardenWorld, GardenPlot, GardenOperation, GardenStock, GardenLedger, GardenProgress, GardenLog
from services import garden_catalog, garden_engine, time_service


class GardenError(ValueError):
    def __init__(self, status_code: int, detail: str, code: str = "garden_error"):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code


@dataclass(frozen=True)
class GardenActor:
    kind: str
    id: str
    household_id: str

    @property
    def key(self):
        return f"{self.kind}:{self.id}"


def _dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _load(value, fallback=None):
    return json.loads(value) if value is not None else fallback


def _now():
    return time_service.aware(time_service.now_utc()).astimezone(timezone.utc)


def _date(value):
    return time_service.aware(datetime.fromisoformat(value))


@lru_cache(maxsize=1)
def _crop_cards():
    # The validated delivery is versioned alongside this service, never read from
    # a developer's Desktop or from mutable frontend simulation data at runtime.
    return {c["id"]: c for c in garden_catalog.list_crops()}


def actor_for_user(db: Session, user_id: str) -> GardenActor:
    user = db.get(User, user_id, populate_existing=True)
    if not user or not user.is_active:
        raise GardenError(401, "登入已失效或帳號已停用", "inactive_user")
    agent = db.scalar(select(Agent).where(Agent.user_id == user.id))
    if not agent:
        raise GardenError(403, "需要先有室友才能使用菜園", "agent_required")
    return GardenActor("user", user.id, user.id)


def actor_for_agent(db: Session, user_id: str) -> GardenActor:
    actor_for_user(db, user_id)
    agent = db.scalar(select(Agent).where(Agent.user_id == user_id))
    return GardenActor("agent", agent.id, user_id)


def _validate_actor(db, actor):
    if actor.kind not in ("user", "agent"):
        raise GardenError(403, "無效的菜園身分", "invalid_actor")
    canonical = (actor_for_user if actor.kind == "user" else actor_for_agent)(db, actor.household_id)
    if canonical != actor:
        raise GardenError(403, "身分不屬於這個家戶", "invalid_actor")


def _transaction(db: Session, work: Callable):
    # Authentication may already have opened a read-only ORM transaction. Never
    # discard a caller's uncommitted writes when taking our service-owned lock.
    if db.new or db.dirty or db.deleted:
        raise RuntimeError("garden service requires a session without pending writes")
    db.rollback()
    try:
        if db.get_bind().dialect.name == "sqlite":
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        else:
            db.begin()
        result = work()
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def _world(db, now):
    world = db.scalar(select(GardenWorld).where(GardenWorld.id == 1).with_for_update())
    if world is None:
        world = GardenWorld(id=1, epoch_at=now, seed=secrets.token_hex(32), sequence=0,
                            public_productive_area_m2=480)
        db.add(world)
        db.flush()
    return world


def _sequence(world):
    world.sequence += 1
    return world.sequence


def _log(db, plot, kind, now, actor=None, planting_id=None, **detail):
    db.add(GardenLog(plot_id=plot.id, planting_id=planting_id,
                     actor_key=actor.key if actor else None, kind=kind,
                     detail_json=_dump(detail), created_at=now))


def _ensure_private(db, actor):
    result = []
    for number in range(1, 5):
        plot_id = f"private:{actor.household_id}:{number}"
        plot = db.get(GardenPlot, plot_id)
        if plot is None:
            plot = GardenPlot(id=plot_id, scope="private", household_id=actor.household_id,
                              number=number, contributors_json="{}", history_json="[]", revision=0)
            db.add(plot)
            db.flush()
        result.append(plot)
    return result


def _open_vote(db, plot, world, now):
    planted = set(_load(plot.history_json, []))
    crop_ids = sorted(_crop_cards())
    candidates = [c for c in crop_ids if c not in planted] or crop_ids
    vote = {"id": str(uuid.uuid4()), "opened_at": now.isoformat(),
            "closes_at": (now + timedelta(hours=12)).isoformat(),
            "candidates": candidates, "ballots": {}, "status": "open"}
    plot.vote_json = _dump(vote)
    plot.contributors_json = "{}"
    plot.distribution_json = "{}"
    plot.revision += 1
    _log(db, plot, "public_vote", now, message="請前往公共菜園選擇下一輪種植作物", vote_id=vote["id"])


def _ensure_public(db, world, now):
    plot = db.get(GardenPlot, "public:1")
    if plot is None:
        plot = GardenPlot(id="public:1", scope="public", number=1,
                          contributors_json="{}", history_json="[]", revision=0)
        db.add(plot)
        db.flush()
        _open_vote(db, plot, world, now)
    return plot


def _ledger(db, *, source_key, crop_id, planting_id, batch_id, kind, amount, now, owner=None):
    amount = Fraction(amount)
    if amount <= 0:
        return
    if db.scalar(select(GardenLedger.id).where(GardenLedger.source_key == source_key)) is not None:
        return
    db.add(GardenLedger(source_key=source_key, owner_key=owner.key if owner else None,
                       household_id=owner.household_id if owner else None,
                       crop_id=crop_id, planting_id=planting_id, batch_id=batch_id, kind=kind,
                       quantity_numerator=str(amount.numerator), quantity_denominator=str(amount.denominator),
                       created_at=now))
    if owner:
        stock = db.get(GardenStock, (owner.key, crop_id))
        if stock is None:
            stock = GardenStock(owner_key=owner.key, crop_id=crop_id, household_id=owner.household_id,
                                quantity_numerator="0", quantity_denominator="1")
            db.add(stock)
        total = Fraction(int(stock.quantity_numerator), int(stock.quantity_denominator)) + amount
        stock.quantity_numerator = str(total.numerator)
        stock.quantity_denominator = str(total.denominator)
    db.flush()


def _public_events(db, plot, state, events, now):
    # Every simultaneous batch in a catch-up tick sees the same contributor set.
    # Only after that entire group is settled does the next epoch begin.
    contributors = _load(plot.contributors_json, {})
    distribution = _load(plot.distribution_json, {})
    groups = {}
    for event in events:
        if event["kind"] == "public_harvest":
            groups.setdefault(event["tick_index"], []).append(event)
        elif event["kind"] == "loss":
            _ledger(db, source_key=f"loss:{event['batch_id']}", crop_id=state["crop_id"],
                    planting_id=state["planting_id"], batch_id=event["batch_id"], kind="plant_failure",
                    amount=event["quantity_g"], now=_date(event["at"]))
    for tick_index, batch_events in groups.items():
        if distribution.get("planting_id") == state["planting_id"] and distribution.get("tick_index") == tick_index:
            beneficiaries = distribution["contributors"]
        else:
            beneficiaries = contributors
            distribution = {"planting_id": state["planting_id"], "tick_index": tick_index,
                            "contributors": contributors}
            contributors = {}
        for event in batch_events:
            qty = Fraction(event["quantity_g"])
            at = _date(event["at"])
            if beneficiaries:
                share = qty / len(beneficiaries)
                for identity in beneficiaries.values():
                    owner = GardenActor(**identity)
                    _ledger(db, source_key=f"public:{event['batch_id']}:{owner.key}",
                            crop_id=state["crop_id"], planting_id=state["planting_id"], batch_id=event["batch_id"],
                            kind="public_share", amount=share, now=at, owner=owner)
            else:
                _ledger(db, source_key=f"unallocated:{event['batch_id']}", crop_id=state["crop_id"],
                        planting_id=state["planting_id"], batch_id=event["batch_id"],
                        kind="unallocated_loss", amount=qty, now=at)
            _log(db, plot, "public_harvest", at, planting_id=state["planting_id"],
                 batch_id=event["batch_id"], quantity_g=str(qty), contributor_count=len(beneficiaries),
                 message="公共菜園已成熟採收完畢。")
    plot.contributors_json = _dump(contributors)
    plot.distribution_json = _dump(distribution)


def _finish_vote(db, plot, world, now):
    vote = _load(plot.vote_json)
    if not vote or _date(vote["closes_at"]) > now:
        return False
    ballots = list(vote["ballots"].values())
    counts = {crop_id: 0 for crop_id in vote["candidates"]}
    latest = {crop_id: 0 for crop_id in vote["candidates"]}
    for ballot in ballots:
        counts[ballot["crop_id"]] += 1
        latest[ballot["crop_id"]] = max(latest[ballot["crop_id"]], ballot["sequence"])
    if ballots:
        winner = max(vote["candidates"], key=lambda c: (counts[c], latest[c]))
    else:
        draw = hashlib.sha256(f"{world.seed}:vote:{vote['id']}".encode()).digest()
        winner = vote["candidates"][int.from_bytes(draw, "big") % len(vote["candidates"])]
    at = _date(vote["closes_at"])
    state = garden_engine.new_planting(winner, str(uuid.uuid4()), at, epoch=time_service.aware(world.epoch_at),
                                       seed=world.seed, public=True,
                                       area_scale=str(Fraction(world.public_productive_area_m2, 6)))
    plot.state_json = _dump(state)
    plot.vote_json = None
    plot.contributors_json = "{}"
    plot.distribution_json = "{}"
    history = _load(plot.history_json, [])
    if winner not in history:
        history.append(winner)
    plot.history_json = _dump(history)
    plot.revision += 1
    _log(db, plot, "vote_closed", at, planting_id=state["planting_id"], vote_id=vote["id"],
         winner=winner, counts=counts, random_fallback=not bool(ballots))
    return True


def _advance_plot(db, plot, world, now):
    # An idle public garden can traverse several expired votes / failed rounds.
    # Each new deadline starts at the actual prior completion time, not refresh.
    for _ in range(10000):
        if plot.scope == "public":
            _finish_vote(db, plot, world, now)
        state = _load(plot.state_json)
        if state is None:
            return
        previous = _dump(state)
        events = garden_engine.advance(state, now, epoch=time_service.aware(world.epoch_at),
                                       seed=world.seed, public=plot.scope == "public")
        if plot.scope == "public":
            _public_events(db, plot, state, events, now)
        else:
            for event in events:
                if event["kind"] == "loss":
                    _ledger(db, source_key=f"loss:{event['batch_id']}", crop_id=state["crop_id"],
                            planting_id=state["planting_id"], batch_id=event["batch_id"],
                            kind="plant_failure", amount=event["quantity_g"], now=_date(event["at"]))
        for event in events:
            if event["kind"] in ("plant_died", "batch_failed", "batch_ready"):
                _log(db, plot, event["kind"], _date(event["at"]), planting_id=state["planting_id"],
                     event=event)
        if _dump(state) != previous:
            plot.revision += 1
        plot.state_json = _dump(state)
        if plot.scope == "public" and state["status"] in ("empty", "production_complete", "dead"):
            # The engine stops the simulation at completion/death. Use that
            # event's timestamp so an unattended refresh cannot extend a vote.
            terminal_at = state.get("died_at") if state["status"] == "dead" else state.get("production_completed_at")
            finished_at = _date(terminal_at or state["last_advanced_at"])
            if not terminal_at and events:
                finished_at = max(_date(e["at"]) for e in events)
            plot.state_json = None
            _open_vote(db, plot, world, finished_at)
            if finished_at + timedelta(hours=12) <= now:
                continue
        return
    raise GardenError(503, "菜園正在補算長期離線進度，請稍後重試", "catchup_limit")


def _clock(world, now):
    epoch = time_service.aware(world.epoch_at)
    virtual = datetime(2026, 1, 1, tzinfo=timezone.utc) + (now - epoch) * 7
    return {"server_now": now.isoformat(), "garden_time": virtual.isoformat(),
            "garden_month": garden_engine.garden_month(now, epoch), "epoch_at": epoch.isoformat(),
            "time_multiplier": 7, "vote_duration_real_hours": 12}


def _plot_out(db, plot, actor, now):
    state = _load(plot.state_json)
    cards = _crop_cards()
    if state and state.get("status") == "empty":
        state = None
    logs = db.scalars(select(GardenLog).where(GardenLog.plot_id == plot.id)
                      .order_by(GardenLog.id.desc()).limit(20)).all()
    vote = _load(plot.vote_json)
    vote_out = None
    if vote:
        counts = {c: 0 for c in vote["candidates"]}
        for ballot in vote["ballots"].values():
            counts[ballot["crop_id"]] += 1
        vote_out = {k: vote[k] for k in ("id", "opened_at", "closes_at", "candidates", "status")}
        vote_out["counts"] = counts
        vote_out["my_vote"] = vote["ballots"].get(actor.key)
    ready = [b for b in (state or {}).get("batches", {}).values() if b["status"] == "ready"]
    needs = []
    if state:
        if state["moisture"] < 40:
            needs.append("water")
        if state["nutrients"] < 35:
            needs.append("nutrients")
        if state.get("random_problem"):
            needs.append("care")
    name = cards[state["crop_id"]]["name"] if state else None
    actions = []
    if plot.scope == "public":
        if vote and actor.key not in vote["ballots"] and now < _date(vote["closes_at"]):
            actions.append("vote")
        if state and state["status"] not in ("dead", "empty", "production_complete"):
            actions.extend(["water", "care"])
    elif state is None:
        if actor.kind == "agent":
            actions.append("plant")
    else:
        if state["status"] not in ("dead", "empty"):
            actions.append("water" if actor.kind == "user" else "care")
            if actor.kind == "user" and any(not b["stolen"] and b["remaining_g"] > 0 for b in ready):
                actions.append("steal")
            if actor.kind == "agent" and ready:
                actions.append("harvest")
        if actor.kind == "agent" and state["status"] == "dead":
            actions.append("clear_dead_crop")
        proposal = state.get("clear_proposal")
        if proposal:
            if actor.key not in proposal["approved_by"]:
                actions.append("consent_clear")
            actions.append("revoke_clear")
        else:
            actions.append("propose_clear")
    if state:
        for batch in state["batches"].values():
            available = plot.scope == "private" and batch["status"] == "ready" and batch["remaining_g"] > 0
            batch["steal_available"] = available and actor.kind == "user" and not batch["stolen"]
            batch["harvest_available"] = available and actor.kind == "agent"
    return {"id": plot.id, "scope": plot.scope, "number": plot.number, "revision": plot.revision,
            "planting": state, "crop_name": name, "vote": vote_out,
            "need": needs, "allowed_actions": actions,
            "steal_available": plot.scope == "private" and actor.kind == "user" and
                               any(not b["stolen"] and b["remaining_g"] > 0 for b in ready),
            "short_status": f"{'私田' if plot.scope == 'private' else '公田'}{plot.number}｜{name or '空地'}｜"
                            f"{state['status'] if state else ('投票中' if vote else '待種植')}",
            "contributors": list(_load(plot.contributors_json, {}).values()) if plot.scope == "public" else [],
            "care_logs": [{"id": row.id, "kind": row.kind, "actor_key": row.actor_key,
                           "planting_id": row.planting_id, "detail": _load(row.detail_json),
                           "created_at": time_service.aware(row.created_at).isoformat()} for row in logs]}


def _read_garden(db, actor, scope):
    def work():
        _validate_actor(db, actor)
        now = _now()
        world = _world(db, now)
        plots = _ensure_private(db, actor) if scope == "private" else [_ensure_public(db, world, now)]
        for plot in plots:
            _advance_plot(db, plot, world, now)
        db.flush()
        return {**_clock(world, now), "plots": [_plot_out(db, p, actor, now) for p in plots],
                "crops": [{"id": c["id"], "name": c["name"], "category": c["category"],
                           "tier": 1, "timing": c["timing"], "harvest": c["harvest"], "care": c["care"],
                           "capacity": c["capacity"]} for c in _crop_cards().values()],
                "public_area": {"gross_m2": 667, "productive_m2": world.public_productive_area_m2},
                "actor": {"kind": actor.kind, "id": actor.id, "household_id": actor.household_id}}
    return _transaction(db, work)


def get_private(db, actor):
    return _read_garden(db, actor, "private")


def get_public(db, actor):
    return _read_garden(db, actor, "public")


def get_inventory(db, actor, owner="user", limit=100, offset=0):
    def work():
        _validate_actor(db, actor)
        if owner not in ("user", "agent") or not 1 <= limit <= 100 or offset < 0:
            raise GardenError(400, "無效的倉庫查詢", "invalid_inventory_query")
        target = (actor_for_user if owner == "user" else actor_for_agent)(db, actor.household_id)
        rows = db.scalars(select(GardenStock).where(GardenStock.owner_key == target.key)
                          .order_by(GardenStock.crop_id).offset(offset).limit(limit + 1)).all()
        items = [{"crop_id": r.crop_id, "crop_name": _crop_cards()[r.crop_id]["name"],
                  "quantity_g": str(Fraction(int(r.quantity_numerator), int(r.quantity_denominator)))}
                 for r in rows[:limit]]
        return {"owner": owner, "owner_id": target.id, "items": items, "has_more": len(rows) > limit,
                "next_offset": offset + limit if len(rows) > limit else None, "unit": "g"}
    return _transaction(db, work)


def get_progress(db, actor):
    def work():
        _validate_actor(db, actor)
        completed = list(db.scalars(select(GardenProgress.crop_id)
                                   .where(GardenProgress.household_id == actor.household_id)
                                   .order_by(GardenProgress.crop_id)))
        count = len(set(completed).intersection(_crop_cards()))
        return {"completed_crop_ids": completed, "completed_count": count, "required_count": 12,
                "unlocked_tier": 2 if count == 12 else 1, "available_tiers": [1]}
    return _transaction(db, work)


def _losses_on_clear(db, plot, state, now):
    for batch in state["batches"].values():
        if batch["status"] == "ready" and batch["remaining_g"] > 0:
            _ledger(db, source_key=f"clear:{batch['id']}", crop_id=state["crop_id"],
                    planting_id=state["planting_id"], batch_id=batch["id"], kind="clear_loss",
                    amount=batch["remaining_g"], now=now)


def _perform(db, actor, plot, world, now, args):
    action = args["action"]
    known_actions = {"water", "care", "vote", "plant", "steal", "harvest", "propose_clear",
                     "consent_clear", "revoke_clear", "clear_dead_crop"}
    if action not in known_actions:
        raise GardenError(400, "不支援這個菜園操作", "unknown_action")
    state = _load(plot.state_json)
    if state and state["status"] == "empty":
        state = None
    if plot.scope == "private":
        allowed = ({"water", "steal", "propose_clear", "consent_clear", "revoke_clear"} if actor.kind == "user" else
                   {"plant", "care", "harvest", "propose_clear", "consent_clear", "revoke_clear", "clear_dead_crop"})
    else:
        allowed = {"water", "care", "vote"}
    if action not in allowed:
        raise GardenError(403, "這個身分不能執行此菜園操作", "action_forbidden")
    extra = {}
    if action == "vote":
        vote = _load(plot.vote_json)
        if not vote or vote["id"] != args["vote_id"]:
            raise GardenError(409, "投票已結束或不是目前這輪", "stale_vote")
        crop_id = args["crop_id"]
        if crop_id not in vote["candidates"]:
            raise GardenError(400, "請選擇這輪的候選作物", "invalid_crop")
        if actor.key in vote["ballots"]:
            raise GardenError(409, "這個身分本輪已投過票", "already_voted")
        vote["ballots"][actor.key] = {"crop_id": crop_id, "sequence": _sequence(world), "at": now.isoformat()}
        plot.vote_json = _dump(vote)
    elif action == "plant":
        if state:
            raise GardenError(409, "這塊地已有作物，請先完成採收或共同清除", "plot_occupied")
        if args["crop_id"] not in _crop_cards():
            raise GardenError(400, "目前只提供第一級十二種作物", "invalid_crop")
        if args["planting_id"]:
            raise GardenError(409, "舊種植編號不能用於新播種", "stale_planting")
        state = garden_engine.new_planting(args["crop_id"], str(uuid.uuid4()), now,
                                           epoch=time_service.aware(world.epoch_at), seed=world.seed)
        plot.state_json = _dump(state)
    else:
        if not state:
            raise GardenError(409, "這塊地目前沒有作物", "empty_plot")
        if args["planting_id"] != state["planting_id"]:
            raise GardenError(409, "作物已更換，請重新載入菜園", "stale_planting")
        if action in ("water", "care"):
            if state["status"] == "dead":
                raise GardenError(409, "作物已死亡，請依清除流程處理", "plant_dead")
            garden_engine.care(state, action, now)
            if plot.scope == "public":
                contributors = _load(plot.contributors_json, {})
                contributors[actor.key] = {"kind": actor.kind, "id": actor.id, "household_id": actor.household_id}
                plot.contributors_json = _dump(contributors)
        elif action in ("steal", "harvest"):
            batch = state["batches"].get(args["batch_id"])
            if not batch or batch["status"] != "ready" or batch["remaining_g"] <= 0:
                raise GardenError(409, "這批尚未成熟或已收完", "batch_not_ready")
            if action == "steal":
                if batch["stolen"]:
                    raise GardenError(409, "這批已經偷取過一次", "already_stolen")
                quantity = batch["yield_g"] // 2
                batch["stolen"] = True
                batch["remaining_g"] -= quantity
            else:
                quantity = garden_engine.harvest(state, args["batch_id"], now)
            _ledger(db, source_key=f"{action}:{batch['id']}", crop_id=state["crop_id"],
                    planting_id=state["planting_id"], batch_id=batch["id"], kind=action,
                    amount=quantity, now=now, owner=actor)
            if action == "harvest" and quantity > 0 and db.get(GardenProgress, (actor.household_id, state["crop_id"])) is None:
                db.add(GardenProgress(household_id=actor.household_id, crop_id=state["crop_id"], created_at=now))
            extra["credited_g"] = str(quantity)
            extra["batch_id"] = batch["id"]
        elif action == "clear_dead_crop":
            if state["status"] != "dead":
                raise GardenError(409, "健康或生產結束的作物仍須雙方同意清除", "joint_consent_required")
            _losses_on_clear(db, plot, state, now)
            state = None
        elif action == "propose_clear":
            reason = (args["reason"] or "").strip()
            if not reason or len(reason) > 500:
                raise GardenError(400, "請填寫 1–500 字清除原因", "clear_reason_required")
            if state.get("clear_proposal"):
                raise GardenError(409, "已有待回覆清除提案，請先同意、拒絕或撤回", "proposal_exists")
            proposal = {"id": str(uuid.uuid4()), "planting_id": state["planting_id"], "reason": reason,
                        "proposed_by": actor.key, "approved_by": [actor.key], "created_at": now.isoformat()}
            state["clear_proposal"] = proposal
            extra["proposal_id"] = proposal["id"]
        else:
            proposal = state.get("clear_proposal")
            if not proposal or proposal["id"] != args["proposal_id"] or proposal["planting_id"] != state["planting_id"]:
                raise GardenError(409, "清除提案已失效", "stale_proposal")
            if action == "revoke_clear" or not args["accept"]:
                state["clear_proposal"] = None
            else:
                approved = set(proposal["approved_by"])
                approved.add(actor.key)
                proposal["approved_by"] = sorted(approved)
                expected = {actor_for_user(db, actor.household_id).key, actor_for_agent(db, actor.household_id).key}
                if expected <= approved:
                    _losses_on_clear(db, plot, state, now)
                    state = None
                    extra["cleared"] = True
        plot.state_json = _dump(state) if state else None
    plot.revision += 1
    _log(db, plot, action, now, actor, args["planting_id"] or ((state or {}).get("planting_id")),
         batch_id=args["batch_id"], proposal_id=extra.get("proposal_id") or args["proposal_id"],
         crop_id=args["crop_id"], reason=args["reason"] if action == "propose_clear" else None)
    db.flush()
    return {"plot": _plot_out(db, plot, actor, now), **extra, "server_now": now.isoformat()}


def mutate(db, actor, *, plot_id, action, request_id, planting_id=None, batch_id=None,
           crop_id=None, proposal_id=None, reason=None, accept=True, vote_id=None):
    if not isinstance(request_id, str) or not request_id.strip() or len(request_id) > 128:
        raise GardenError(400, "每個菜園操作都需要 1–128 字 request_id", "request_id_required")
    args = dict(plot_id=plot_id, action=action, planting_id=planting_id, batch_id=batch_id,
                crop_id=crop_id, proposal_id=proposal_id, reason=reason, accept=accept, vote_id=vote_id)
    fingerprint = hashlib.sha256(_dump(args).encode()).hexdigest()

    def work():
        _validate_actor(db, actor)
        prior = db.get(GardenOperation, (actor.key, request_id))
        if prior:
            if prior.request_hash != fingerprint:
                raise GardenError(409, "request_id 已用於不同內容，請重新產生", "idempotency_conflict")
            return _load(prior.response_json)
        now = _now()
        world = _world(db, now)
        _ensure_private(db, actor)
        plot = db.get(GardenPlot, plot_id)
        if plot is None or (plot.scope == "private" and plot.household_id != actor.household_id):
            outcome = {"error": {"status_code": 404, "detail": "找不到這塊菜園", "code": "plot_not_found"}}
        else:
            _advance_plot(db, plot, world, now)
            db.flush()
            try:
                with db.begin_nested():
                    result = _perform(db, actor, plot, world, now, args)
                outcome = {"result": result}
            except GardenError as exc:
                outcome = {"error": {"status_code": exc.status_code, "detail": exc.detail, "code": exc.code}}
                _log(db, plot, "rejected_attempt", now, actor, planting_id,
                     action=action, code=exc.code)
            except ValueError as exc:
                outcome = {"error": {"status_code": 409, "detail": str(exc), "code": "invalid_garden_state"}}
        db.add(GardenOperation(actor_key=actor.key, request_id=request_id, request_hash=fingerprint,
                               response_json=_dump(outcome), created_at=now))
        return outcome
    outcome = _transaction(db, work)
    if "error" in outcome:
        error = outcome["error"]
        raise GardenError(error["status_code"], error["detail"], error["code"])
    return outcome["result"]


def tick_all(db):
    """Timer catch-up: never invoke an agent, spend model tokens or send webhooks."""
    def work():
        now = _now()
        world = _world(db, now)
        _ensure_public(db, world, now)
        plots = db.scalars(select(GardenPlot).order_by(GardenPlot.id)).all()
        changed = 0
        for plot in plots:
            before = plot.revision
            _advance_plot(db, plot, world, now)
            changed += plot.revision != before
        return {"server_now": now.isoformat(), "plots_checked": len(plots), "plots_changed": changed}
    return _transaction(db, work)
