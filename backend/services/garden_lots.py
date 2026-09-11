"""Credit-source lots, including explicit reconstruction of pre-market harvests.

Neither this module nor pricing changes GardenStock or commits. The caller must
hold its garden transaction lock; a source_key unique constraint guards replay.
"""

from fractions import Fraction

from sqlalchemy import select

from models.garden import GardenLedger
from models.garden_market import GardenMarketBatch, GardenMarketLot
from services import garden_pricing, time_service


CREDIT_KINDS = frozenset({"harvest", "steal", "public_share"})
LOSS_KINDS = frozenset({"clear_loss", "plant_failure", "unallocated_loss"})


class GardenLotError(ValueError):
    def __init__(self, detail: str, code: str = "invalid_market_lot"):
        super().__init__(detail)
        self.detail = detail
        self.code = code


def _fraction(numerator, denominator) -> Fraction:
    try:
        n, d = int(numerator), int(denominator)
        if d <= 0:
            raise ValueError("non-positive denominator")
        return Fraction(n, d)
    except (ValueError, TypeError, ZeroDivisionError) as exc:
        raise GardenLotError("收成帳本的精確數量無效", "invalid_ledger_quantity") from exc


def _credit_quantity(ledger: GardenLedger) -> Fraction | None:
    amount = _fraction(ledger.quantity_numerator, ledger.quantity_denominator)
    if ledger.kind == "sale":
        if amount > 0:
            raise GardenLotError("出售帳本不能增加作物庫存", "invalid_sale_ledger")
        return None
    if ledger.kind in LOSS_KINDS and ledger.owner_key is None:
        return None
    if ledger.kind not in CREDIT_KINDS:
        raise GardenLotError("此帳本來源不是可重建的收成收入", "unknown_lot_source")
    if not ledger.owner_key:
        return None
    if amount <= 0:
        return None
    if not ledger.household_id or not ledger.source_key or not ledger.batch_id or not ledger.planting_id:
        raise GardenLotError("收成帳本缺少身分或批次來源", "incomplete_lot_source")
    kind, separator, identity = ledger.owner_key.partition(":")
    if kind not in {"user", "agent"} or not separator or not identity:
        raise GardenLotError("收成帳本的擁有人身分無效", "invalid_lot_owner")
    if kind == "user" and identity != ledger.household_id:
        raise GardenLotError("收成帳本的住戶與家戶不一致", "invalid_lot_owner")
    garden_pricing.parse_batch_id(ledger.batch_id, ledger.planting_id)
    if ledger.created_at is None:
        raise GardenLotError("收成帳本缺少入倉時間", "incomplete_lot_source")
    return amount


def _check_existing(lot: GardenMarketLot, ledger: GardenLedger, original: Fraction) -> None:
    if (lot.owner_key, lot.household_id, lot.crop_id, lot.batch_id) != (
        ledger.owner_key, ledger.household_id, ledger.crop_id, ledger.batch_id
    ):
        raise GardenLotError("同一來源帳本已對應不同的庫存批次", "lot_source_conflict")
    remaining = _fraction(lot.remaining_numerator, lot.remaining_denominator)
    if remaining < 0 or remaining > original:
        raise GardenLotError("既有可售批次剩餘量不合法", "invalid_lot_balance")


def register_lot(db, ledger: GardenLedger) -> GardenMarketLot | None:
    """Register an owned positive credit against an already frozen batch.

An existing source, even completely sold, is returned without restoring grams.
Sale debits and ownerless losses do not produce lots.
"""
    amount = _credit_quantity(ledger)
    if amount is None:
        return None
    existing = db.scalar(select(GardenMarketLot).where(GardenMarketLot.source_key == ledger.source_key))
    if existing is not None:
        _check_existing(existing, ledger, amount)
        return existing
    batch = db.get(GardenMarketBatch, ledger.batch_id)
    if batch is None:
        raise GardenLotError("收成批次尚未保存價格，不能直接估算入倉價", "batch_price_missing")
    if (batch.planting_id, batch.crop_id) != (ledger.planting_id, ledger.crop_id):
        raise GardenLotError("收成帳本與定價批次來源不一致", "lot_source_conflict")
    garden_pricing.batch_unit_price(batch)
    row = GardenMarketLot(source_key=ledger.source_key, owner_key=ledger.owner_key,
                          household_id=ledger.household_id, crop_id=ledger.crop_id, batch_id=ledger.batch_id,
                          remaining_numerator=str(amount.numerator), remaining_denominator=str(amount.denominator),
                          created_at=time_service.aware(ledger.created_at))
    db.add(row)
    db.flush()
    return row


def _legacy_maturity(db, ledger: GardenLedger):
    candidates = db.scalars(select(GardenLedger).where(
        GardenLedger.batch_id == ledger.batch_id, GardenLedger.kind.in_(CREDIT_KINDS),
        GardenLedger.owner_key.is_not(None),
    )).all()
    times = []
    for candidate in candidates:
        amount = _credit_quantity(candidate)
        if amount is None:
            continue
        if (candidate.crop_id, candidate.planting_id) != (ledger.crop_id, ledger.planting_id):
            raise GardenLotError("同批歷史帳本的作物或種植來源不一致", "legacy_batch_conflict")
        times.append(time_service.aware(candidate.created_at))
    if not times:
        raise GardenLotError("找不到這一批的有效歷史入倉來源", "legacy_source_missing")
    return min(times)


def ensure_legacy_lots(db, owner_key: str, crop_id: str | None = None) -> list[GardenMarketLot]:
    """Rebuild missing original credits; skip sales and never replenish old lots.

Legacy records predate market sales. We retain their source_key and event grams,
mark the price's timestamp provenance, and use the earliest owned positive credit
for that batch across all owners. A caller can reconcile lot totals with stock.
"""
    query = select(GardenLedger).where(GardenLedger.owner_key == owner_key)
    if crop_id is not None:
        query = query.where(GardenLedger.crop_id == crop_id)
    ledgers = db.scalars(query.order_by(GardenLedger.created_at, GardenLedger.id)).all()
    # Validate the entire source set before adding reconstruction rows.
    credits = [(ledger, amount) for ledger in ledgers if (amount := _credit_quantity(ledger)) is not None]
    created = []
    for ledger, amount in credits:
        existing = db.scalar(select(GardenMarketLot).where(GardenMarketLot.source_key == ledger.source_key))
        if existing is not None:
            _check_existing(existing, ledger, amount)
            continue
        # Legacy credits predate selling. Once this owner/batch has a sale
        # debit, a missing lot may have been partly or fully consumed; restoring
        # its original credit would invent inventory. Existing zero lots above
        # remain valid and are never reset, and another owner's sale is separate.
        sales = db.scalars(select(GardenLedger).where(
            GardenLedger.owner_key == ledger.owner_key, GardenLedger.batch_id == ledger.batch_id,
            GardenLedger.kind == "sale",
        )).all()
        if any(_fraction(row.quantity_numerator, row.quantity_denominator) <= 0 for row in sales):
            raise GardenLotError("此批已有出售歷史但可售批次缺失，不能從原收成量重建", "legacy_sale_without_lot")
        if db.get(GardenMarketBatch, ledger.batch_id) is None:
            garden_pricing.freeze_legacy_batch(db, crop_id=ledger.crop_id, planting_id=ledger.planting_id,
                batch_id=ledger.batch_id, matured_at=_legacy_maturity(db, ledger))
        created.append(register_lot(db, ledger))
    return created
