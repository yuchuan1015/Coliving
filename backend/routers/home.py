from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from models.user import User
from schemas.home import AgentPlaceholder, CommunityStatus, DashboardResponse, SpaceInfo
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/home", tags=["home"])


@router.get("/dashboard", response_model=DashboardResponse)
def get_dashboard(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resident_count = db.query(User).filter(User.is_active.is_(True)).count()

    return DashboardResponse(
        welcome_message=f"歡迎回家，{current_user.display_name}",
        user={
            "id": current_user.id,
            "display_name": current_user.display_name,
            "role": current_user.role,
        },
        agents=[],
        agent_placeholder=AgentPlaceholder(
            message="你還沒有 AI 室友",
            hint="之後可以領養一位室友陪你",
        ),
        spaces=[
            SpaceInfo(id="plaza", name="中央廣場", status="coming_soon"),
            SpaceInfo(id="library", name="圖書館", status="coming_soon"),
            SpaceInfo(id="park", name="公園", status="coming_soon"),
            SpaceInfo(id="workshop", name="工坊", status="coming_soon"),
        ],
        resident_count=resident_count,
        community_status=CommunityStatus(
            phase=1,
            message="社區剛落成，一切都還在整理中⋯",
        ),
    )
