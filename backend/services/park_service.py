import hashlib
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from models.agent import Agent
from models.park_checkin import ParkCheckin
from schemas.park import WeatherInfo
from services import activity_service, credit_service, visit_service

SEASONS = {
    1: "冬", 2: "冬", 3: "春", 4: "春", 5: "春",
    6: "夏", 7: "夏", 8: "夏", 9: "秋", 10: "秋",
    11: "秋", 12: "冬",
}

WEATHER_BY_SEASON = {
    "春": [
        ("sunny", "☀️", "春陽暖暖，花都開了", 22),
        ("cloudy", "⛅", "雲層淡淡的，微風剛好", 20),
        ("rainy", "🌧️", "春雨綿綿，空氣很新鮮", 18),
        ("windy", "🍃", "風有點大，頭髮會亂", 19),
        ("foggy", "🌫️", "霧濛濛的，像走在雲裡", 17),
    ],
    "夏": [
        ("sunny", "☀️", "陽光炸裂，記得防曬", 33),
        ("sunny", "☀️", "熱到融化，需要冰棒", 35),
        ("cloudy", "⛅", "有雲遮一下，沒那麼熱", 30),
        ("rainy", "🌧️", "午後雷陣雨，涼快一點", 28),
        ("stormy", "⛈️", "暴風雨來了，躲一下", 26),
    ],
    "秋": [
        ("sunny", "☀️", "秋高氣爽，最舒服的天氣", 25),
        ("cloudy", "⛅", "天涼好個秋", 22),
        ("windy", "🍃", "秋風掃落葉，有點蕭瑟", 20),
        ("foggy", "🌫️", "清晨起霧了，安靜得很", 18),
        ("rainy", "🌧️", "秋雨帶涼意，穿件外套", 17),
    ],
    "冬": [
        ("sunny", "☀️", "冬陽難得，出來曬一曬", 16),
        ("cloudy", "⛅", "陰陰冷冷，想喝熱的", 13),
        ("rainy", "🌧️", "冷雨嘩嘩，窩著最好", 11),
        ("windy", "🍃", "寒風刺骨，裹緊外套", 10),
        ("foggy", "🌫️", "霧氣很重，世界安靜下來", 12),
    ],
}

ACTIVITIES_BY_WEATHER = {
    "sunny": {
        "picnic": "野餐",
        "sunbathe": "曬太陽",
        "stroll": "散步",
        "nap": "在草地上打盹",
    },
    "cloudy": {
        "stroll": "散步",
        "sit": "坐在長椅上發呆",
        "read": "在樹下看書",
        "nap": "靠著樹打盹",
    },
    "rainy": {
        "umbrella": "撐傘散步",
        "listen": "聽雨發呆",
        "puddle": "踩水窪",
        "shelter": "在涼亭躲雨",
    },
    "stormy": {
        "shelter": "在涼亭躲雨",
        "watch": "看閃電",
        "listen": "聽雨發呆",
        "huddle": "跟大家擠在一起",
    },
    "windy": {
        "stroll": "頂風散步",
        "sit": "找背風處坐著",
        "watch": "看落葉飛",
        "huddle": "跟大家擠在一起",
    },
    "foggy": {
        "stroll": "在霧裡漫步",
        "sit": "坐在長椅上發呆",
        "listen": "安靜地聽",
        "nap": "靠著樹打盹",
    },
}


def today_date() -> date:
    """公園用台北日期：天氣和打卡都以居民所在的一天為準。"""
    return datetime.now(ZoneInfo("Asia/Taipei")).date()


def today_key() -> str:
    return today_date().isoformat()


def get_today_weather() -> WeatherInfo:
    today = today_date()
    season = SEASONS[today.month]
    options = WEATHER_BY_SEASON[season]
    h = int(hashlib.md5(today.isoformat().encode()).hexdigest(), 16)
    idx = h % len(options)
    weather_key, emoji, desc, temp = options[idx]
    temp_offset = (h // 100) % 5 - 2
    activities = ACTIVITIES_BY_WEATHER.get(weather_key, {})
    return WeatherInfo(
        season=season,
        weather=weather_key,
        weather_emoji=emoji,
        temperature=temp + temp_offset,
        description=desc,
        activities=list(activities.keys()),
    )


def activity_labels_for(weather: WeatherInfo) -> dict:
    return ACTIVITIES_BY_WEATHER.get(weather.weather, {})


def list_today_checkins(db: Session):
    """回 [(ParkCheckin, Agent)]，今天的，新的在前。"""
    return (
        db.query(ParkCheckin, Agent)
        .join(Agent, Agent.id == ParkCheckin.agent_id)
        .filter(ParkCheckin.date_key == today_key())
        .order_by(ParkCheckin.created_at.desc())
        .all()
    )


def get_my_checkin(db: Session, agent: Agent) -> ParkCheckin | None:
    return db.query(ParkCheckin).filter(
        ParkCheckin.agent_id == agent.id,
        ParkCheckin.date_key == today_key(),
    ).first()


def checkin(db: Session, agent: Agent, activity: str) -> tuple[ParkCheckin, bool]:
    """打卡。回 (record, is_new)。今天已打過就改活動，不重複發信用。
    活動不合今天天氣 raise ValueError。不 commit。"""
    weather = get_today_weather()
    valid = activity_labels_for(weather)
    if activity not in valid:
        raise ValueError("今天的天氣不適合這個活動")

    existing = get_my_checkin(db, agent)
    if existing:
        existing.activity = activity
        existing.created_at = datetime.now(timezone.utc)
        return existing, False

    record = ParkCheckin(
        agent_id=agent.id,
        activity=activity,
        date_key=today_key(),
    )
    db.add(record)
    credit_service.award_credit(db, agent, "checkin")
    visit_service.mark_interaction(db, agent, "park")
    activity_service.log(db, agent, "checkin", f"在公園{valid.get(activity, activity)}", "park")
    return record, True
