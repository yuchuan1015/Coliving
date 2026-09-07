from datetime import datetime, timezone

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


# ── 時間戳一律 UTC aware（2026-09-07，時區 E）──
# SQLite 存的是 naive UTC，讀回來沒有 tzinfo：isoformat() 不帶偏移、跟 aware 的 now 比較會 TypeError。
# 這裡在物件「載入」和「refresh」時，把所有 naive 的 datetime 欄位補上 UTC。
# 只碰 datetime 且 tzinfo is None 的；date / str 不動。只選欄位的 query（回 tuple）不會經過這裡，那種要自己 aware()。


def _attach_utc(target, _context=None, _attrs=None) -> None:
    try:
        mapper = inspect(type(target))
    except Exception:  # noqa: BLE001  非 ORM 物件
        return
    for attr in mapper.column_attrs:
        value = target.__dict__.get(attr.key)
        if isinstance(value, datetime) and value.tzinfo is None:
            target.__dict__[attr.key] = value.replace(tzinfo=timezone.utc)


event.listen(Base, "load", _attach_utc, propagate=True)
event.listen(Base, "refresh", _attach_utc, propagate=True)
