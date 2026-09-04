from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.agent import Agent
from models.pet import Pet
from services import activity_service, credit_service

PET_THRESHOLDS = [500, 1000]

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


def tick(pet: Pet) -> None:
    if not pet.is_alive:
        return
    now = datetime.now(timezone.utc)
    elapsed = (now - pet.last_tick_at).total_seconds() / 3600
    if elapsed < 0.01:
        return

    pet.hunger = max(0.0, pet.hunger - elapsed * DECAY_PER_HOUR["hunger"])
    pet.cleanliness = max(0.0, pet.cleanliness - elapsed * DECAY_PER_HOUR["cleanliness"])
    pet.happiness = max(0.0, pet.happiness - elapsed * DECAY_PER_HOUR["happiness"])
    pet.health = (pet.hunger + pet.cleanliness + pet.happiness) / 3

    if pet.health <= 0:
        pet.is_alive = False
        pet.died_at = now

    pet.last_tick_at = now


def get_pet_status(pet: Pet) -> dict:
    tick(pet)
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

    tick(pet)
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

    return get_pet_status(pet)
