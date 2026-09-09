"""時間：社區時間 vs 住戶當地時間。

2026-09-07 喻墨定：艙室（我的家）裡除了「社區時間」那欄全部用住戶當地時間；公共場域用社區時間＝台北。
- DB 存的一律 UTC（SQLite 讀回是 naive，用 aware() 補 tzinfo）。
- 排程的 cron 表達式照住戶的時區解讀，算出來再轉 UTC 存。
"""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter
from sqlalchemy.orm import Session

from models.agent import Agent
from models.schedule import Schedule
from models.user import User

COMMUNITY_TZ_NAME = "Asia/Taipei"
COMMUNITY_TZ = ZoneInfo(COMMUNITY_TZ_NAME)


def validate_timezone(name: str) -> str:
    """只收 IANA 名（Asia/Taipei、America/New_York…）。壞的 raise ValueError。"""
    name = (name or "").strip()
    if not name or "/" not in name and name != "UTC":
        raise ValueError("時區要用 IANA 名稱，例如 Asia/Taipei")
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(f"不認得的時區：{name}")
    return name


def aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def tz_name_of(user: User | None) -> str:
    return (user.timezone if user and user.timezone else COMMUNITY_TZ_NAME)


def tz_of(user: User | None) -> ZoneInfo:
    return ZoneInfo(tz_name_of(user))


def community_now() -> datetime:
    return now_utc().astimezone(COMMUNITY_TZ)


def user_now(user: User | None) -> datetime:
    return now_utc().astimezone(tz_of(user))


def clock_info(user: User | None) -> dict:
    """給 /me 和家具時鐘：三個時間一起回。"""
    return {
        "utc": now_utc().isoformat(),
        "timezone": tz_name_of(user),
        "local_time": user_now(user).isoformat(),
        "community_timezone": COMMUNITY_TZ_NAME,
        "community_time": community_now().isoformat(),
    }


def next_cron_run(cron_expr: str, tz: ZoneInfo, base_utc: datetime | None = None) -> datetime:
    """cron 照 tz 解讀（「0 8 * * *」＝那個時區的早上八點），回 UTC aware。"""
    base = aware(base_utc or now_utc()).astimezone(tz)
    nxt = croniter(cron_expr, base).get_next(datetime)
    if nxt.tzinfo is None:
        nxt = nxt.replace(tzinfo=tz)
    return nxt.astimezone(timezone.utc)


def owner_of_agent(db: Session, agent_id: str) -> User | None:
    return db.query(User).join(Agent, Agent.user_id == User.id).filter(Agent.id == agent_id).first()


def recompute_schedules_for_user(db: Session, user: User) -> int:
    """住戶改時區後，他名下所有排程的 next_run 用新時區重算。回幾筆。不 commit。"""
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        return 0
    tz = tz_of(user)
    n = 0
    for s in db.query(Schedule).filter(Schedule.agent_id == agent.id).all():
        s.next_run = next_cron_run(s.cron_expr, tz)
        n += 1
    return n
