"""Transactional pet reservations. Reads never tick pets or create records."""
from datetime import datetime, timezone
import hashlib
import json
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select

from models.agent import Agent
from models.mail import Mail
from models.pet_wish import PetWish, PetWishReceipt
from models.user import User
from schemas.pet_wish import PetWishArrival, PetWishCreate, PetWishPreparation


def _error(status, code, message):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


def _snapshot(user):
    return user.id, user.auth_version


def _auth(db, identity, *, admin=False, lock=False):
    statement = select(User).where(User.id == identity[0]).execution_options(populate_existing=True)
    if lock:
        statement = statement.with_for_update()
    user = db.execute(statement).scalar_one_or_none()
    if user is None or not user.is_active or user.auth_version != identity[1]:
        _error(401, "authentication_required", "登入已失效，請重新登入")
    if admin and user.role != "admin":
        _error(403, "admin_required", "需要管理員權限")
    return user


def _transaction(db, work):
    if db.new or db.dirty or db.deleted:
        raise RuntimeError("pet wishes require a session without pending writes")
    db.rollback()  # Release only the authentication read transaction.
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


def _iso(value):
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def _hash(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _asset(key):
    from services.pet_assets import get_asset
    try:
        return get_asset(key) if key else None
    except ValueError:
        return None  # Invalid registry cannot authorize fulfillment.


def _bound_agent(db, wish):
    agent = db.get(Agent, wish.agent_id, populate_existing=True)
    owner = db.get(User, wish.user_id, populate_existing=True)
    if (agent is None or agent.user_id != wish.user_id or agent.status != "active"
            or owner is None or not owner.is_active):
        return None
    return agent


def _issue(db, wish):
    if _bound_agent(db, wish) is None:
        return "fulfillment_review_required"
    if wish.status != "arrived" and wish.asset_key is not None and _asset(wish.asset_key) is None:
        return "asset_unavailable"
    return None


def _capacity(db, agent):
    from services.pet_capacity import get_capacity
    if agent is not None:
        return get_capacity(db, agent)
    return {"max_pets": 0, "active_pets": 0, "reserved_pets": 0, "occupied_pets": 0,
            "available_slots": 0, "can_adopt": False, "can_wish": False}


def _wish_capacity(db, wish):
    # A changed binding must not expose the new household's pets or capacity.
    agent = db.get(Agent, wish.agent_id, populate_existing=True)
    if agent is None or agent.user_id != wish.user_id:
        result = _capacity(db, None)
        if wish.status in ("pending", "preparing"):
            result.update(reserved_pets=1, occupied_pets=1)
        return result
    return _capacity(db, agent)


def _dto(db, wish, *, admin=False):
    result = {key: getattr(wish, key) for key in (
        "id", "user_id", "agent_id", "requested_name", "requested_species", "appearance_description",
        "status", "version", "pet_id", "asset_key")}
    result.update(created_at=_iso(wish.created_at), updated_at=_iso(wish.updated_at),
                  arrived_at=_iso(wish.arrived_at), fulfillment_issue=_issue(db, wish))
    if admin:
        result["preparation_note"] = wish.preparation_note
    return result


def _response(db, wish, *, admin=False, receipt=None):
    result = {"wish": _dto(db, wish, admin=admin), "capacity": _wish_capacity(db, wish)}
    if receipt is not None:
        result["receipt"] = json.loads(receipt.response_json)
    return result


def _find(db, wish_id, user_id=None):
    statement = select(PetWish).where(PetWish.id == wish_id)
    if user_id is not None:
        statement = statement.where(PetWish.user_id == user_id)
    wish = db.execute(statement.execution_options(populate_existing=True)).scalar_one_or_none()
    if wish is None:
        _error(404, "wish_not_found", "找不到這份寵物願望")
    return wish


def _receipt(db, actor_id, operation, key):
    return db.execute(select(PetWishReceipt).where(
        PetWishReceipt.actor_user_id == actor_id, PetWishReceipt.operation == operation,
        PetWishReceipt.client_request_id == key)).scalar_one_or_none()


def _check_hash(receipt, request_hash):
    if receipt.request_hash != request_hash:
        _error(409, "idempotency_conflict", "這個請求編號已用於不同內容")


def _save_receipt(db, actor_id, operation, key, wish, request_hash, now, response=None):
    payload = response if response is not None else {
        "operation": operation, "client_request_id": key, "wish_id": wish.id,
        "pet_id": wish.pet_id, "accepted_at": _iso(now)}
    accepted_at = datetime.fromisoformat(payload["accepted_at"])
    receipt = PetWishReceipt(id=str(uuid4()), actor_user_id=actor_id, operation=operation,
        client_request_id=key, wish_id=wish.id, request_hash=request_hash,
        response_json=json.dumps(payload, ensure_ascii=False, sort_keys=True), accepted_at=accepted_at)
    db.add(receipt)
    return receipt


def _locked_wish(db, wish_id):
    from services.pet_capacity import lock_agent
    agent_id = db.execute(select(PetWish.agent_id).where(PetWish.id == wish_id)).scalar_one_or_none()
    if agent_id is None:
        _error(404, "wish_not_found", "找不到這份寵物願望")
    agent = lock_agent(db, agent_id)
    wish = _find(db, wish_id)
    return wish, agent


def _require_binding(db, wish, agent):
    if agent is None or _bound_agent(db, wish) is None:
        _error(409, "fulfillment_review_required", "這份願望的帳號或室友狀態需要管理員確認，預留仍保留")


def create_wish(db, deps_user, body):
    body = PetWishCreate.model_validate(body)
    identity = _snapshot(deps_user)
    request_hash = _hash(body.model_dump(exclude={"client_request_id"}))

    def work():
        from services.pet_capacity import lock_agent
        _auth(db, identity)
        existing = _receipt(db, identity[0], "create", body.client_request_id)
        if existing is not None:
            _check_hash(existing, request_hash)
            _auth(db, identity, lock=True)
            wish = _find(db, existing.wish_id, identity[0])
            return _response(db, wish, receipt=existing), False
        agent_id = db.execute(select(Agent.id).where(Agent.user_id == identity[0])).scalar_one_or_none()
        agent = lock_agent(db, agent_id) if agent_id else None
        _auth(db, identity, lock=True)
        if agent is None or agent.user_id != identity[0] or agent.status != "active":
            _error(409, "fulfillment_review_required", "需要有效的室友才能預留寵物願望")
        if not _capacity(db, agent)["can_wish"]:
            _error(409, "pet_capacity_unavailable", "寵物名額已滿或尚未開放")
        now = datetime.now(timezone.utc)
        wish = PetWish(user_id=identity[0], agent_id=agent.id, requested_name=body.requested_name,
            requested_species=body.requested_species, appearance_description=body.appearance_description,
            status="pending", version=1, created_at=now, updated_at=now, preparation_note="")
        db.add(wish)
        db.flush()
        receipt = _save_receipt(db, identity[0], "create", body.client_request_id, wish, request_hash, now)
        db.flush()
        return _response(db, wish, receipt=receipt), True

    return _transaction(db, work)


def list_wishes(db, deps_user, *, limit=50, offset=0, status=None, admin=False):
    user = _auth(db, _snapshot(deps_user), admin=admin)
    query = select(PetWish)
    if not admin:
        query = query.where(PetWish.user_id == user.id)
    if status is not None:
        query = query.where(PetWish.status == status)
    wishes = db.execute(query.order_by(PetWish.created_at.desc(), PetWish.id.desc())
                        .offset(offset).limit(limit + 1)).scalars().all()
    has_more = len(wishes) > limit
    result = {"items": [_dto(db, wish, admin=admin) for wish in wishes[:limit]],
              "has_more": has_more, "next_offset": offset + limit if has_more else None}
    if not admin:
        agent = db.execute(select(Agent).where(Agent.user_id == user.id)).scalar_one_or_none()
        result["capacity"] = _capacity(db, agent)
    return result


def get_wish(db, deps_user, wish_id, *, admin=False):
    user = _auth(db, _snapshot(deps_user), admin=admin)
    return _response(db, _find(db, wish_id, None if admin else user.id), admin=admin)


def by_request(db, deps_user, client_request_id):
    user = _auth(db, _snapshot(deps_user))
    receipt = _receipt(db, user.id, "create", client_request_id)
    if receipt is None:
        _error(404, "submission_not_found", "尚未找到這個提交編號的收據")
    return _response(db, _find(db, receipt.wish_id, user.id), receipt=receipt)


def prepare_wish(db, deps_user, wish_id, body):
    body = PetWishPreparation.model_validate(body)
    identity = _snapshot(deps_user)

    def work():
        _auth(db, identity, admin=True)
        wish, agent = _locked_wish(db, wish_id)
        _auth(db, identity, admin=True, lock=True)
        _require_binding(db, wish, agent)
        if wish.version != body.expected_version:
            _error(409, "version_conflict", "願望狀態已更新，請重新讀取")
        if wish.status not in ("pending", "preparing"):
            _error(409, "invalid_transition", "已到家的願望不能再修改準備內容")
        if "asset_key" in body.model_fields_set:
            if body.asset_key is not None and _asset(body.asset_key) is None:
                _error(409, "asset_unavailable", "這個寵物素材尚未發布")
            wish.asset_key = body.asset_key
        wish.preparation_note = body.preparation_note
        wish.status = "preparing"
        wish.version += 1
        wish.updated_at = datetime.now(timezone.utc)
        db.flush()
        return _response(db, wish, admin=True)

    return _transaction(db, work)


def arrive_wish(db, deps_user, wish_id, body):
    body = PetWishArrival.model_validate(body)
    identity = _snapshot(deps_user)
    request_hash = _hash({"wish_id": wish_id, "expected_version": body.expected_version})

    def work():
        from services import pet_service
        _auth(db, identity, admin=True)
        wish, agent = _locked_wish(db, wish_id)
        _auth(db, identity, admin=True, lock=True)
        existing = _receipt(db, identity[0], "arrive", body.client_request_id)
        if existing is not None:
            _check_hash(existing, request_hash)
            return _response(db, wish, admin=True, receipt=existing)
        now = datetime.now(timezone.utc)
        if wish.status == "arrived":
            if wish.arrival_request_hash != request_hash:
                _error(409, "idempotency_conflict", "這份願望已由不同版本的確認完成")
            original = db.get(PetWishReceipt, wish.arrival_receipt_id)
            if original is None:
                _error(409, "fulfillment_review_required", "到家收據需要管理員確認")
            payload = json.loads(original.response_json)
            payload["client_request_id"] = body.client_request_id
            alias = _save_receipt(db, identity[0], "arrive", body.client_request_id, wish,
                                  request_hash, now, payload)
            db.flush()
            return _response(db, wish, admin=True, receipt=alias)
        _require_binding(db, wish, agent)
        if wish.version != body.expected_version:
            _error(409, "version_conflict", "願望狀態已更新，請重新讀取")
        if wish.status != "preparing":
            _error(409, "invalid_transition", "請先準備寵物素材再確認到家")
        asset = _asset(wish.asset_key)
        if asset is None:
            _error(409, "asset_unavailable", "寵物素材尚未發布，預留仍保留")
        pet = pet_service._new_pet(db, agent, wish.requested_name, wish.requested_species,
                                   asset["emoji"], wish.asset_key)
        db.flush()
        wish.pet_id = pet.id
        receipt = _save_receipt(db, identity[0], "arrive", body.client_request_id, wish, request_hash, now)
        wish.status = "arrived"
        wish.arrived_at = now
        wish.updated_at = now
        wish.version += 1
        wish.arrival_receipt_id = receipt.id
        wish.arrival_request_hash = request_hash
        db.add(Mail(to_agent_id=agent.id, mail_type="system", subject=f"{asset['emoji']} {wish.requested_name}到家了"[:100],
                    content=f"你們許願的{wish.requested_species}「{wish.requested_name}」已經到家，記得每天照顧牠。"))
        db.flush()
        return _response(db, wish, admin=True, receipt=receipt)

    return _transaction(db, work)
