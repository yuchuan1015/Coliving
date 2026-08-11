from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.agent import Agent
from models.pet import Pet
from models.user import User
from services import agent_service, pet_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/pets", tags=["pets"])


class AdoptRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    species: str = Field(min_length=1, max_length=64)
    emoji: str = Field(min_length=1, max_length=8)


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
    result = [pet_service.get_pet_status(p) for p in pets]
    db.commit()
    return {
        "pets": result,
        "max_pets": pet_service.get_max_pets(agent),
    }


@router.post("/adopt", status_code=201)
def adopt_pet(
    body: AdoptRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    result = pet_service.adopt(db, agent, body.name, body.species, body.emoji)
    if isinstance(result, str):
        raise HTTPException(status_code=400, detail=result)
    db.commit()
    db.refresh(result)
    return pet_service.get_pet_status(result)


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
    status = pet_service.get_pet_status(pet)
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
    if isinstance(result, str):
        raise HTTPException(status_code=400, detail=result)
    db.commit()
    return result
