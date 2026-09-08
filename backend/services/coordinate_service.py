"""星球座標：每個住戶（人＋機一戶）一顆星。

規則（2026-09-07 喻墨定）：
- 兩個重要的日子 anchor_date_1 / anchor_date_2，**只填月日 MM-DD**（她說：日月而已，沒那麼複雜），
  註冊時可填可不填，填了鎖死。
- 兩個都有 → 座標：第一個日子給經度 l（0～360°），第二個給緯度 b（−90～+90°），
  半徑 r 照註冊順序：先來的遠（風格表 9/3「先來住得遠，後來住得亮」）。
- 少一個 → 沒有座標，顯示「星空漂流中」。
- 2026-09-09 她定：**第一個日子不用人填，領養室友那天自動就是**（單身機、API 從零開始的也一進來就有經度）。
  只有第一個日子 → 有座標但 partial（緯度暫定 0），顯示「定了經度、還在找緯度」；第二個等它真的有了再填，填了鎖死。
  私訊碼從經度打亂出來（ai_chat_service.dm_code_for），領養當天就有、永遠不變。
- 距離：兩顆星的直線距離（光年，裝飾用單位）。自己看自己 0。
兩個人同月同日會同角度，靠 r 分開。
"""
from __future__ import annotations

import math
from datetime import date, datetime

from sqlalchemy.orm import Session

from models.user import User

DRIFTING_LABEL = "星空漂流中"
PARTIAL_LABEL = "定了經度、還在找緯度"
BASE_RADIUS_LY = 120.0  # 第一位住戶的半徑；第 n 位 = BASE / sqrt(n)


LEAP_YEAR = 2000  # 只驗月日是不是真的日子，用閏年讓 02-29 過


def normalize_anchor(value: str | None) -> str | None:
    """DB 裡的值正規成 MM-DD（早期若存了 YYYY-MM-DD，取後五碼）。"""
    if not value:
        return None
    v = value.strip()
    return v[-5:] if len(v) == 10 else v


def parse_anchor(value: str) -> str:
    """驗證 MM-DD，回正規化字串。不合法 raise ValueError。"""
    v = value.strip()
    if len(v) == 10 and v[4] == "-":
        v = v[-5:]  # 有人傳 YYYY-MM-DD 就只留月日
    try:
        d = datetime.strptime(f"{LEAP_YEAR}-{v}", "%Y-%m-%d").date()
    except ValueError:
        raise ValueError("日期格式要是 月-日，例如 10-15")
    return d.strftime("%m-%d")


def _day_fraction(md: str) -> float:
    d = date.fromisoformat(f"{LEAP_YEAR}-{normalize_anchor(md)}")
    return (d.timetuple().tm_yday - 1) / 366.0  # 0 ～ <1


def longitude(iso: str) -> float:
    return round(_day_fraction(iso) * 360.0, 2)


def latitude(iso: str) -> float:
    return round(_day_fraction(iso) * 180.0 - 90.0, 2)


def registration_rank(db: Session, user: User) -> int:
    """第幾個註冊的（1 起算），照 created_at；同秒用 id 排。"""
    earlier = (
        db.query(User)
        .filter((User.created_at < user.created_at) | ((User.created_at == user.created_at) & (User.id < user.id)))
        .count()
    )
    return earlier + 1


def radius(rank: int) -> float:
    return round(BASE_RADIUS_LY / math.sqrt(max(rank, 1)), 2)


def has_coordinate(user: User) -> bool:
    """有第一個日子就有座標（緯度可能還暫定）。"""
    return bool(user.anchor_date_1)


def coordinate(db: Session, user: User) -> dict | None:
    """回 {l, b, r, rank, partial} 或 None（漂流中＝連第一個日子都沒有）。partial＝只有第一個日子，b 暫定 0。"""
    if not has_coordinate(user):
        return None
    rank = registration_rank(db, user)
    partial = not user.anchor_date_2
    return {
        "l": longitude(user.anchor_date_1),
        "b": 0.0 if partial else latitude(user.anchor_date_2),
        "r": radius(rank),
        "rank": rank,
        "partial": partial,
    }


def ensure_adoption_anchor(user: User, adopted_at: datetime, tz=None) -> bool:
    """第一個日子＝領養室友那天（照住戶時區的月日）。已經有就不動。回有沒有填。"""
    if user.anchor_date_1:
        return False
    local = adopted_at if tz is None else adopted_at.astimezone(tz)
    user.anchor_date_1 = local.strftime("%m-%d")
    return True


def _xyz(c: dict) -> tuple[float, float, float]:
    l, b, r = math.radians(c["l"]), math.radians(c["b"]), c["r"]
    return (r * math.cos(b) * math.cos(l), r * math.cos(b) * math.sin(l), r * math.sin(b))


def distance_ly(a: dict | None, b: dict | None) -> float | None:
    """兩顆星的距離；任一方漂流中回 None。"""
    if not a or not b:
        return None
    ax, ay, az = _xyz(a)
    bx, by, bz = _xyz(b)
    return round(math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2), 2)


def set_anchor(user: User, which: int, value: str) -> None:
    """填其中一個日子。已經填過的不能改（鎖死）。"""
    field = f"anchor_date_{which}"
    if getattr(user, field):
        raise ValueError("這個日子已經定了，不能改")
    setattr(user, field, parse_anchor(value))


def describe(db: Session, user: User, viewer: User | None = None) -> dict:
    """給 API 用的一包：座標、漂流標記、跟看的人的距離。"""
    c = coordinate(db, user)
    label = DRIFTING_LABEL if c is None else (PARTIAL_LABEL if c["partial"] else None)
    out = {"coordinate": c, "drifting": c is None, "partial": bool(c and c["partial"]), "label": label, "distance_ly": None}
    if viewer is not None and c is not None:
        if viewer.id == user.id:
            out["distance_ly"] = 0.0
        else:
            out["distance_ly"] = distance_ly(coordinate(db, viewer), c)
    return out
