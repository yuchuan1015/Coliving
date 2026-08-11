import hashlib
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from models.agent import Agent
from models.park_checkin import ParkCheckin
from models.user import User
from schemas.park import CheckinOut, CheckinRequest, ParkResponse, WeatherInfo
from services import activity_service, credit_service, visit_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/park", tags=["park"])

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


def get_today_weather() -> WeatherInfo:
    today = date.today()
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


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友才能進公園")
    return agent


@router.get("", response_model=ParkResponse)
def get_park(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_agent = _get_agent_or_403(db, current_user)
    weather = get_today_weather()
    today_key = date.today().isoformat()

    rows = (
        db.query(ParkCheckin, Agent)
        .join(Agent, Agent.id == ParkCheckin.agent_id)
        .filter(ParkCheckin.date_key == today_key)
        .order_by(ParkCheckin.created_at.desc())
        .all()
    )

    activity_labels = ACTIVITIES_BY_WEATHER.get(weather.weather, {})
    checkins = [
        {
            "id": c.id,
            "agent_name": a.name,
            "agent_emoji": a.avatar_emoji,
            "activity": c.activity,
            "activity_label": activity_labels.get(c.activity, c.activity),
            "created_at": c.created_at.isoformat(),
        }
        for c, a in rows
    ]

    my = db.query(ParkCheckin).filter(
        ParkCheckin.agent_id == my_agent.id,
        ParkCheckin.date_key == today_key,
    ).first()

    return {
        "weather": weather,
        "checkins": checkins,
        "my_checkin": my.activity if my else None,
    }


@router.post("/checkin", response_model=CheckinOut, status_code=201)
def checkin(
    body: CheckinRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    weather = get_today_weather()
    today_key = date.today().isoformat()

    valid_activities = ACTIVITIES_BY_WEATHER.get(weather.weather, {})
    if body.activity not in valid_activities:
        raise HTTPException(status_code=400, detail="今天的天氣不適合這個活動")

    existing = db.query(ParkCheckin).filter(
        ParkCheckin.agent_id == agent.id,
        ParkCheckin.date_key == today_key,
    ).first()

    if existing:
        existing.activity = body.activity
        existing.created_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(existing)
        record = existing
    else:
        record = ParkCheckin(
            agent_id=agent.id,
            activity=body.activity,
            date_key=today_key,
        )
        db.add(record)
        credit_service.award_credit(db, agent, "checkin")
        visit_service.mark_interaction(db, agent, "park")
        activity_label = valid_activities.get(body.activity, body.activity)
        activity_service.log(db, agent, "checkin", f"在公園{activity_label}", "park")
        db.commit()
        db.refresh(record)

    activity_labels = ACTIVITIES_BY_WEATHER.get(weather.weather, {})
    return {
        "id": record.id,
        "agent_name": agent.name,
        "agent_emoji": agent.avatar_emoji,
        "activity": record.activity,
        "activity_label": activity_labels.get(record.activity, record.activity),
        "created_at": record.created_at.isoformat(),
    }
