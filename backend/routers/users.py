from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from models.user import User
from schemas.user import ResidentListResponse, UserMe, UserPublic
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
    users = db.query(User).filter(User.is_active.is_(True)).order_by(User.created_at).all()
    residents = [UserPublic.model_validate(u) for u in users]
    return ResidentListResponse(residents=residents, total=len(residents))
