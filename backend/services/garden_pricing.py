"""Per-gram shell value from standard batch intervals, never actual waiting time.

The v1 crop cards give cultivation-day offsets and nominal grams per private
plot. Ten shells per ideal real growing day are divided by that batch's nominal
grams. Reduced output lowers total proceeds without changing unit price.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from fractions import Fraction
import re
from uuid import UUID

from models.garden_market import GardenMarketBatch
from services import garden_catalog, time_service


PRICING_VERSION = "tier1-standard-interval-v1"
LEGACY_PRICING_VERSION = "tier1-standard-interval-v1:legacy-ledger"
SHELLS_PER_REAL_GROWING_DAY = Fraction(10)
_BATCH_RE = re.compile(r"(?P<planting>[0-9a-fA-F-]{36}):cycle(?P<cycle>0|[1-9][0-9]*):batch(?P<batch>0|[1-9][0-9]*)\Z")


class GardenPricingError(ValueError):
    def __init__(self, detail: str, code: str = "invalid_batch_price"):
        super().__init__(detail)
        self.detail = detail
        self.code = code


@dataclass(frozen=True)
class BatchIdentity:
    planting_id: str
    cycle_index: int
    batch_index: int


def parse_batch_id(batch_id: str, planting_id: str | None = None) -> BatchIdentity:
    if not isinstance(batch_id, str) or len(batch_id) > 150:
        raise GardenPricingError("批次編號不是正式菜園格式", "invalid_batch_id")
    match = _BATCH_RE.fullmatch(batch_id)
    if not match:
        raise GardenPricingError("批次編號不是正式菜園格式", "invalid_batch_id")
    parsed = match.group("planting")
    try:
        canonical = str(UUID(parsed))
    except ValueError as exc:
        raise GardenPricingError("種植編號不是 UUID", "invalid_batch_id") from exc
    if parsed != canonical or (planting_id is not None and planting_id != canonical):
        raise GardenPricingError("批次與種植編號不一致", "invalid_batch_id")
    return BatchIdentity(canonical, int(match.group("cycle")), int(match.group("batch")))


def _positive_fraction(numerator: str, denominator: str) -> Fraction:
    try:
        n, d = int(numerator), int(denominator)
        if n <= 0 or d <= 0:
            raise ValueError("non-positive price")
        return Fraction(n, d)
    except (ValueError, TypeError, ZeroDivisionError) as exc:
        raise GardenPricingError("保存的批次價格無效", "invalid_stored_price") from exc


def price_per_gram(crop_id: str, *, cycle_index: int, batch_index: int) -> Fraction:
    if type(cycle_index) is not int or type(batch_index) is not int or cycle_index < 0 or batch_index < 0:
        raise GardenPricingError("生產周期與批次序號必須是非負整數", "invalid_batch_index")
    try:
        card = garden_catalog.get_crop(crop_id)
    except ValueError as exc:
        raise GardenPricingError("找不到可估價的正式作物資料", "unknown_pricing_crop") from exc
    harvest = card["harvest"]
    try:
        offsets = [Fraction(str(value)) for value in harvest["maturity_offsets_days"]]
        yields = [Fraction(str(value)) for value in harvest["yield_g_per_plot_by_batch"]]
        if not offsets or len(offsets) != len(yields) or batch_index >= len(offsets):
            raise GardenPricingError("批次超出作物的正式採收排程", "invalid_batch_index")
        if cycle_index > 0 and harvest["end_behavior"] != "repeat_perennial_cycle":
            raise GardenPricingError("有限採收作物沒有下一個生產周期", "invalid_batch_index")
        if batch_index:
            interval = offsets[batch_index] - offsets[batch_index - 1]
        elif cycle_index:
            interval = Fraction(str(harvest["repeat_cycle_days"])) + offsets[0] - offsets[-1]
        else:
            interval = offsets[0]
        nominal = yields[batch_index]
        if interval <= 0 or nominal <= 0:
            raise GardenPricingError("批次標準生長間隔與名目產量必須大於零", "invalid_pricing_card")
        return SHELLS_PER_REAL_GROWING_DAY * interval / 7 / nominal
    except (KeyError, ValueError, TypeError, ZeroDivisionError) as exc:
        if isinstance(exc, GardenPricingError):
            raise
        raise GardenPricingError("正式作物資料缺少可估價的批次數值", "invalid_pricing_card") from exc


def batch_unit_price(batch: GardenMarketBatch) -> Fraction:
    """Read the saved price without recalculating from a possibly newer card."""
    return _positive_fraction(batch.price_numerator, batch.price_denominator)


def _timestamp(value: datetime | str) -> datetime:
    try:
        value = datetime.fromisoformat(value) if isinstance(value, str) else value
        if not isinstance(value, datetime):
            raise TypeError("datetime required")
        return time_service.aware(value).astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError) as exc:
        raise GardenPricingError("批次缺少有效的成熟時間", "invalid_matured_at") from exc


def _freeze(db, *, crop_id, planting_id, batch_id, matured_at, pricing_version):
    identity = parse_batch_id(batch_id, planting_id)
    existing = db.get(GardenMarketBatch, batch_id)
    if existing is not None:
        if existing.crop_id != crop_id or existing.planting_id != identity.planting_id:
            raise GardenPricingError("已定價批次的作物或種植來源不一致", "batch_price_conflict")
        batch_unit_price(existing)
        return existing
    price = price_per_gram(crop_id, cycle_index=identity.cycle_index, batch_index=identity.batch_index)
    row = GardenMarketBatch(batch_id=batch_id, planting_id=planting_id, crop_id=crop_id,
                            pricing_version=pricing_version, price_numerator=str(price.numerator),
                            price_denominator=str(price.denominator), matured_at=_timestamp(matured_at))
    db.add(row)
    db.flush()
    return row


def freeze_batch(db, *, crop_id: str, planting_id: str, batch_id: str, matured_at: datetime | str) -> GardenMarketBatch:
    """Freeze once at actual maturity; caller owns the transaction and commit."""
    return _freeze(db, crop_id=crop_id, planting_id=planting_id, batch_id=batch_id,
                   matured_at=matured_at, pricing_version=PRICING_VERSION)


def freeze_legacy_batch(db, *, crop_id: str, planting_id: str, batch_id: str, matured_at: datetime | str) -> GardenMarketBatch:
    """Same v1 value, marked because its timestamp came from legacy credit rows.

Never overwrite a price or its origin that another path froze first.
"""
    return _freeze(db, crop_id=crop_id, planting_id=planting_id, batch_id=batch_id,
                   matured_at=matured_at, pricing_version=LEGACY_PRICING_VERSION)
