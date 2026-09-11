"""Explicit crop sales: quote and debit exact FIFO lots under the garden lock.

No growing, harvesting, model invocation or automatic sale happens here. A quote
binds the actor, quantity and chosen inventory lots; execution must match it.
"""
from fractions import Fraction
import hashlib
import re

from sqlalchemy import select

from models.garden import GardenStock, GardenLedger
from models.garden_market import GardenMarketBatch, GardenMarketLot
from models.garden_sale import GardenSale
from services import garden_service as garden, garden_lots, shell_wallet


def quantity(value):
    # Strings preserve fractional public shares and reject JSON float rounding.
    if not isinstance(value, str) or len(value) > 128 or not re.fullmatch(r"(?:[0-9]+(?:\.[0-9]+)?|[0-9]+/[0-9]+)", value):
        raise garden.GardenError(422, "數量請使用正數克數字串，可用小數或分數", "invalid_quantity")
    try:
        result = Fraction(value)
    except (ValueError, ZeroDivisionError):
        raise garden.GardenError(422, "數量必須大於零且分母不得為零", "invalid_quantity") from None
    if result <= 0:
        raise garden.GardenError(422, "出售數量必須大於零", "invalid_quantity")
    return result


def display(value):
    """Round a positive rational only for display, never for stored accounting."""
    value = Fraction(value)
    cents = (value.numerator * 200 + value.denominator) // (2 * value.denominator)
    return f"{cents // 100}.{cents % 100:02d}"


def _amount(row):
    return Fraction(int(row.remaining_numerator), int(row.remaining_denominator))


def _stock_amount(row):
    return Fraction(int(row.quantity_numerator), int(row.quantity_denominator)) if row else Fraction(0)


def _lots(db, target, crop_id):
    try:
        garden_lots.ensure_legacy_lots(db, target.key, crop_id=crop_id)
    except ValueError as exc:
        raise garden.GardenError(409, "這份庫存的來源需要核對，暫時無法出售", "inventory_source_unverified") from exc
    rows = db.scalars(select(GardenMarketLot).where(
        GardenMarketLot.owner_key == target.key, GardenMarketLot.crop_id == crop_id,
    ).order_by(GardenMarketLot.created_at, GardenMarketLot.id).with_for_update()).all()
    rows = [row for row in rows if _amount(row) > 0]
    stock = db.get(GardenStock, (target.key, crop_id))
    total = sum((_amount(row) for row in rows), Fraction())
    if total != _stock_amount(stock):
        raise garden.GardenError(409, "庫存數量與來源不一致，請稍後再試", "inventory_source_mismatch")
    return rows, stock, total


def _quote(db, actor, crop_id, amount):
    if crop_id not in garden._crop_cards():
        raise garden.GardenError(400, "未知作物", "invalid_crop")
    rows, stock, total = _lots(db, actor, crop_id)
    if amount > total:
        raise garden.GardenError(409, "倉庫沒有這麼多收成", "insufficient_stock")
    remaining, value, allocations = amount, Fraction(), []
    for row in rows:
        taken = min(remaining, _amount(row))
        batch = db.get(GardenMarketBatch, row.batch_id)
        if batch is None:
            raise garden.GardenError(409, "這批收成尚無售價", "batch_price_missing")
        rate = Fraction(int(batch.price_numerator), int(batch.price_denominator))
        value += taken * rate
        allocations.append({"lot_id": row.id, "batch_id": row.batch_id, "quantity_g": str(taken),
                            "shells_per_g": str(rate), "pricing_version": batch.pricing_version})
        remaining -= taken
        if remaining == 0:
            break
    fingerprint = hashlib.sha256(garden._dump({"actor_key": actor.key, "crop_id": crop_id,
        "quantity_g": str(amount), "allocations": allocations}).encode()).hexdigest()
    return {"quote_id": fingerprint, "owner": actor.kind, "owner_id": actor.id,
            "crop_id": crop_id, "crop_name": garden._crop_cards()[crop_id]["name"],
            "quantity_g": str(amount), "shells_exact": str(value), "shells_display": display(value),
            "allocations": allocations}, stock


def quote(db, actor, *, crop_id, quantity_g):
    amount = quantity(quantity_g)
    def work():
        garden._validate_actor(db, actor)
        result, _ = _quote(db, actor, crop_id, amount)
        return result
    return garden._transaction(db, work)


def get_market(db, actor, *, owner=None, limit=100, offset=0):
    def work():
        garden._validate_actor(db, actor)
        selected = owner or actor.kind
        if selected not in ("user", "agent") or not 1 <= limit <= 100 or offset < 0:
            raise garden.GardenError(400, "無效的倉庫查詢", "invalid_inventory_query")
        target = (garden.actor_for_user if selected == "user" else garden.actor_for_agent)(db, actor.household_id)
        stocks = db.scalars(select(GardenStock).where(GardenStock.owner_key == target.key)
                           .order_by(GardenStock.crop_id).offset(offset).limit(limit + 1)).all()
        items = []
        for stock in stocks[:limit]:
            amount = _stock_amount(stock)
            item = {"crop_id": stock.crop_id, "crop_name": garden._crop_cards()[stock.crop_id]["name"],
                    "quantity_g": str(amount), "can_sell": target == actor and amount > 0}
            if amount:
                try:
                    # An unavailable item must not leave partial legacy-lot
                    # reconstruction committed by this otherwise valid view.
                    with db.begin_nested():
                        quoted, _ = _quote(db, target, stock.crop_id, amount)
                    item.update(shells_exact=quoted["shells_exact"], shells_display=quoted["shells_display"])
                except garden.GardenError as exc:
                    item.update(can_sell=False, unavailable_reason=exc.code)
            else:
                item.update(shells_exact="0", shells_display="0.00")
            items.append(item)
        return {"owner": selected, "owner_id": target.id, "can_sell": target == actor,
                "wallet": shell_wallet.summary(db, target), "items": items,
                "has_more": len(stocks) > limit, "next_offset": offset + limit if len(stocks) > limit else None,
                "unit": "g"}
    return garden._transaction(db, work)


def sell(db, actor, *, crop_id, quantity_g, quote_id, request_id):
    amount = quantity(quantity_g)
    if not isinstance(request_id, str) or not request_id.strip() or len(request_id) > 128:
        raise garden.GardenError(422, "出售需要 1–128 字 request_id", "request_id_required")
    if not isinstance(quote_id, str) or not re.fullmatch(r"[0-9a-f]{64}", quote_id):
        raise garden.GardenError(422, "請先取得有效售價", "quote_required")
    request_hash = hashlib.sha256(garden._dump({"crop_id": crop_id, "quantity_g": str(amount),
                                               "quote_id": quote_id}).encode()).hexdigest()
    def work():
        garden._validate_actor(db, actor)
        prior = db.get(GardenSale, (actor.key, request_id))
        if prior:
            if prior.request_hash != request_hash:
                raise garden.GardenError(409, "request_id 已用於另一筆出售", "idempotency_conflict")
            return garden._load(prior.response_json)
        quoted, stock = _quote(db, actor, crop_id, amount)
        if quoted["quote_id"] != quote_id:
            raise garden.GardenError(409, "這份報價的庫存已改變，請重新確認售價", "stale_quote")
        now = garden._now()
        for allocation in quoted["allocations"]:
            lot = db.get(GardenMarketLot, allocation["lot_id"])
            taken = Fraction(allocation["quantity_g"])
            remaining = _amount(lot) - taken
            lot.remaining_numerator, lot.remaining_denominator = str(remaining.numerator), str(remaining.denominator)
            batch = db.get(GardenMarketBatch, lot.batch_id)
            debit = -taken
            db.add(GardenLedger(source_key=f"sale:{actor.key}:{request_id}:{lot.id}",
                owner_key=actor.key, household_id=actor.household_id, crop_id=crop_id,
                planting_id=batch.planting_id, batch_id=lot.batch_id, kind="sale",
                quantity_numerator=str(debit.numerator), quantity_denominator=str(debit.denominator), created_at=now))
        left = _stock_amount(stock) - amount
        stock.quantity_numerator, stock.quantity_denominator = str(left.numerator), str(left.denominator)
        shell_wallet.credit(db, actor, Fraction(quoted["shells_exact"]),
            source_key=f"garden-sale:{actor.key}:{request_id}", action="crop_sale", note=quoted["crop_name"], now=now)
        db.flush()
        result = {**quoted, "request_id": request_id, "remaining_g": str(left),
                  "wallet": shell_wallet.summary(db, actor), "sold_at": now.isoformat()}
        db.add(GardenSale(actor_key=actor.key, request_id=request_id, request_hash=request_hash,
                          response_json=garden._dump(result), created_at=now))
        return result
    return garden._transaction(db, work)
