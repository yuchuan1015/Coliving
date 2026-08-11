from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from models.agent import Agent
from models.user import User
from schemas.user import ResidentListResponse, ResidentWithAgent, UserMe
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserMe)
def get_me(current_user: User = Depends(get_current_user)):
    return UserMe.model_validate(current_user)


@router.get("/residents", response_model=ResidentListResponse)
def list_residents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(User, Agent)
        .outerjoin(Agent, Agent.user_id == User.id)
        .filter(User.is_active.is_(True))
        .order_by(User.created_at)
        .all()
    )
    residents = [
        ResidentWithAgent(
            id=u.id,
            username=u.username,
            display_name=u.display_name,
            role=u.role,
            created_at=u.created_at,
            agent_id=a.id if a else None,
            agent_name=a.name if a else None,
            agent_emoji=a.avatar_emoji if a else None,
        )
        for u, a in rows
    ]
    return ResidentListResponse(residents=residents, total=len(residents))
