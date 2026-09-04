import hashlib
import random
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.agent import Agent
from models.mail import Mail
from models.pet import Pet
from services import activity_service, credit_service

PET_THRESHOLDS = [500, 1000]

# 壽命：不存欄位，用 id 的 hash 定，每隻固定。90～180 天
LIFESPAN_MIN_DAYS = 90
LIFESPAN_RANGE_DAYS = 91

# 隨機事件：每經過一整小時擲一次，一次 tick 最多發生幾件、最多擲幾次（離線太久不爆量）
EVENT_CHANCE_PER_HOUR = 0.05
MAX_EVENTS_PER_TICK = 3
MAX_ROLLS_PER_TICK = 72
_rng = random.Random()

RANDOM_EVENTS = [
    {"key": "found_shiny", "text": "{name}撿到一顆亮晶晶的東西，開心得轉圈", "effects": {"happiness": 10}},
    {"key": "rain", "text": "{name}淋了一場雨，毛都濕了", "effects": {"cleanliness": -15}},
    {"key": "snack", "text": "{name}不知道從哪偷到零食吃掉了", "effects": {"hunger": 15}},
    {"key": "mud", "text": "{name}在泥地裡打滾，很髒但很開心", "effects": {"cleanliness": -20, "happiness": 10}},
    {"key": "nightmare", "text": "{name}做了惡夢，有點不安", "effects": {"happiness": -10}},
    {"key": "bird", "text": "有隻鳥停在窗台，{name}盯著看了一下午", "effects": {"happiness": 8}},
    {"key": "cold", "text": "{name}有點沒精神，可能著涼了", "effects": {"hunger": -10, "happiness": -10}},
    {"key": "sunnap", "text": "{name}曬著太陽睡了個好覺", "effects": {"happiness": 12, "hunger": -5}},
]

DECAY_PER_HOUR = {
    "hunger": 2.0,
    "cleanliness": 1.0,
    "happiness": 1.5,
}

ACTIONS = {
    "feed": {"hunger": 40},
    "clean": {"cleanliness": 40},
    "play": {"happiness": 30},
    "walk": {"happiness": 20, "health": 5},
    "rest": {"health": 10},
}


def get_max_pets(agent: Agent) -> int:
    count = 0
    for threshold in PET_THRESHOLDS:
        if agent.credit_total >= threshold:
            count += 1
    return count


def get_alive_pets(db: Session, agent: Agent) -> list[Pet]:
    return db.query(Pet).filter(Pet.agent_id == agent.id, Pet.is_alive.is_(True)).all()


def _aware(dt: datetime) -> datetime:
    """SQLite 存的是 naive UTC，讀回來補上 tzinfo 才能跟 datetime.now(timezone.utc) 相減。"""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def lifespan_days(pet: Pet) -> int:
    """壽命唯一出處。目前不存欄位，用 id 的 hash 定（每隻固定）。
    若之後改成 pets.lifespan_days 欄位，只改這個函式。"""
    h = int(hashlib.md5(pet.id.encode()).hexdigest(), 16)
    return LIFESPAN_MIN_DAYS + h % LIFESPAN_RANGE_DAYS


def _age_days(pet: Pet, now: datetime | None = None) -> float:
    now = _aware(now) if now else datetime.now(timezone.utc)
    return (now - _aware(pet.born_at)).total_seconds() / 86400


def cause_of_death(pet: Pet) -> str | None:
    """死因不存欄位，事後推：活到壽命就是老死，否則是照顧不周。"""
    if pet.is_alive or not pet.died_at:
        return None
    return "old_age" if _age_days(pet, pet.died_at) >= lifespan_days(pet) else "neglect"


def _apply_effects(pet: Pet, effects: dict) -> None:
    for stat, amount in effects.items():
        setattr(pet, stat, max(0.0, min(100.0, getattr(pet, stat) + amount)))


def _roll_events(pet: Pet, elapsed_hours: float) -> list[dict]:
    rolls = min(int(elapsed_hours), MAX_ROLLS_PER_TICK)
    events = []
    for _ in range(rolls):
        if len(events) >= MAX_EVENTS_PER_TICK:
            break
        if _rng.random() < EVENT_CHANCE_PER_HOUR:
            ev = _rng.choice(RANDOM_EVENTS)
            _apply_effects(pet, ev["effects"])
            events.append({"key": ev["key"], "text": ev["text"].format(name=pet.name), "effects": ev["effects"]})
    return events


def _owner(db: Session, pet: Pet) -> Agent | None:
    return db.query(Agent).filter(Agent.id == pet.agent_id).first()


def _mail_owner(db: Session, pet: Pet, subject: str, content: str) -> None:
    db.add(Mail(to_agent_id=pet.agent_id, subject=subject[:100], content=content, mail_type="system"))


def tick(db: Session, pet: Pet) -> list[dict]:
    """懶更新：衰減、隨機事件、老死／照顧不周判定。回這次發生的事件。
    事件和死亡會寫 activity_log 並寄系統信給主人。不 commit。"""
    if not pet.is_alive:
        return []
    now = datetime.now(timezone.utc)
    elapsed = (now - _aware(pet.last_tick_at)).total_seconds() / 3600
    if elapsed < 0.01:
        return []

    pet.hunger = max(0.0, pet.hunger - elapsed * DECAY_PER_HOUR["hunger"])
    pet.cleanliness = max(0.0, pet.cleanliness - elapsed * DECAY_PER_HOUR["cleanliness"])
    pet.happiness = max(0.0, pet.happiness - elapsed * DECAY_PER_HOUR["happiness"])
    pet.health = (pet.hunger + pet.cleanliness + pet.happiness) / 3
    pet.last_tick_at = now

    owner = _owner(db, pet)
    age = _age_days(pet, now)

    # 先判死，再擲事件：隨機事件不能把快死的救回來
    if age >= lifespan_days(pet):
        pet.is_alive = False
        pet.died_at = now
        activity_service.log(db, owner, "pet_death", f"{pet.name}壽終正寢，陪了你 {int(age)} 天")
        _mail_owner(db, pet, f"{pet.emoji} {pet.name}走了",
                    f"{pet.name}今天安靜地走了。牠活了 {int(age)} 天，是壽終正寢。謝謝你一直照顧牠。")
        return []
    if pet.health <= 0:
        pet.is_alive = False
        pet.died_at = now
        activity_service.log(db, owner, "pet_death", f"{pet.name}因為沒人照顧而離開了")
        _mail_owner(db, pet, f"{pet.emoji} {pet.name}走了",
                    f"{pet.name}因為太久沒人照顧，離開了。牠陪了你 {int(age)} 天。")
        return []

    events = _roll_events(pet, elapsed)
    if events:
        pet.health = (pet.hunger + pet.cleanliness + pet.happiness) / 3
        lines = [e["text"] for e in events]
        for line in lines:
            activity_service.log(db, owner, "pet_event", line)
        _mail_owner(db, pet, f"{pet.emoji} {pet.name}的近況", "\n".join(lines))

    return events


def get_pet_status(db: Session, pet: Pet) -> dict:
    events = tick(db, pet)
    return {
        "id": pet.id,
        "name": pet.name,
        "species": pet.species,
        "emoji": pet.emoji,
        "hunger": round(pet.hunger, 1),
        "cleanliness": round(pet.cleanliness, 1),
        "happiness": round(pet.happiness, 1),
        "health": round(pet.health, 1),
        "is_alive": pet.is_alive,
        "born_at": pet.born_at.isoformat(),
        "died_at": pet.died_at.isoformat() if pet.died_at else None,
        "age_days": int(_age_days(pet, pet.died_at or None)),
        "lifespan_days": lifespan_days(pet),
        "cause_of_death": cause_of_death(pet),
        "events": events,
    }


def adopt(db: Session, agent: Agent, name: str, species: str, emoji: str) -> Pet | str:
    max_pets = get_max_pets(agent)
    if max_pets == 0:
        return "信用不足，需要累積 500 信用才能養寵物"

    alive = get_alive_pets(db, agent)
    if len(alive) >= max_pets:
        if max_pets == 1:
            return "你已經有一隻寵物了，累積 1000 信用可以養第二隻"
        return "你已經有兩隻寵物了"

    pet = Pet(
        agent_id=agent.id,
        name=name,
        species=species,
        emoji=emoji,
    )
    db.add(pet)
    activity_service.log(db, agent, "pet_adopt", f"領養了{species}「{name}」{emoji}")
    return pet


def interact(db: Session, agent: Agent, pet: Pet, action: str) -> dict | str:
    if action not in ACTIONS:
        return f"無效的動作，可選：{', '.join(ACTIONS.keys())}"
    if not pet.is_alive:
        return f"{pet.name}已經不在了"

    tick(db, pet)
    if not pet.is_alive:
        return f"{pet.name}已經不在了"

    effects = ACTIONS[action]
    for stat, amount in effects.items():
        current = getattr(pet, stat)
        setattr(pet, stat, min(100.0, current + amount))

    pet.health = (pet.hunger + pet.cleanliness + pet.happiness) / 3

    ACTION_LABELS = {
        "feed": "餵食",
        "clean": "清潔",
        "play": "陪玩",
        "walk": "散步",
        "rest": "休息",
    }
    label = ACTION_LABELS.get(action, action)
    activity_service.log(db, agent, "pet_interact", f"幫{pet.name}{label}")

    return get_pet_status(db, pet)
