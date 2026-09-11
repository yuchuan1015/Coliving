from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from models.agent import Agent
from models.pet import Pet
from models.user import User
from services import pet_service, pet_assets, pet_capacity
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/pets", tags=["pets"])
asset_router = APIRouter(prefix="/api/pet-assets", tags=["pets"])


class AdoptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: str = Field(min_length=1, max_length=64)
    species: str = Field(default="", max_length=64)
    emoji: str = Field(default="", max_length=8)
    asset_key: str | None = Field(default=None, min_length=1, max_length=128)


@asset_router.get("")
def list_assets(current_user: User = Depends(get_current_user)):
    return pet_assets.catalog()


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友")
    return agent


@router.get("")
def list_pets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    pets = pet_service.get_alive_pets(db, agent)
    result = [pet_service.get_pet_status(db, p) for p in pets]
    capacity = pet_capacity.get_capacity(db, agent)
    db.commit()
    return {
        "pets": result,
        "max_pets": capacity["max_pets"],
        "capacity": capacity,
    }


@router.post("/adopt", status_code=201)
def adopt_pet(
    body: AdoptRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    identity = current_user.id, current_user.auth_version
    agent = _get_agent_or_403(db, current_user)
    result = pet_service.adopt(db, agent, body.name, body.species, body.emoji, body.asset_key)
    if isinstance(result, str):
        raise HTTPException(status_code=400, detail=result)
    status = pet_service.get_pet_status(db, result)
    fresh_user = db.get(User, identity[0], populate_existing=True)
    if fresh_user is None or not fresh_user.is_active or fresh_user.auth_version != identity[1]:
        db.rollback()
        raise HTTPException(status_code=401, detail="登入已失效，請重新登入")
    db.commit()
    return status


@router.get("/{pet_id}")
def get_pet(
    pet_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    pet = db.query(Pet).filter(Pet.id == pet_id, Pet.agent_id == agent.id).first()
    if not pet:
        raise HTTPException(status_code=404, detail="找不到這隻寵物")
    status = pet_service.get_pet_status(db, pet)
    db.commit()
    return status


@router.post("/{pet_id}/interact")
def interact_pet(
    pet_id: str,
    action: str = Query(pattern="^(feed|clean|play|walk|rest)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    pet = db.query(Pet).filter(Pet.id == pet_id, Pet.agent_id == agent.id).first()
    if not pet:
        raise HTTPException(status_code=404, detail="找不到這隻寵物")
    result = pet_service.interact(db, agent, pet, action)
    # An attempted interaction can settle an existing pet's death. Keep that
    # settlement even when the requested care can no longer be performed.
    db.commit()
    if isinstance(result, str):
        raise HTTPException(status_code=400, detail=result)
    return result
