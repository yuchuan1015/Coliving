from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from models.agent import Agent
from models.user import User
from schemas.home import AgentPlaceholder, CommunityStatus, DashboardResponse, SpaceInfo
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/home", tags=["home"])


def _agent_to_public(agent: Agent) -> dict:
    return {
        "id": agent.id,
        "name": agent.name,
        "persona": agent.persona,
        "llm_provider": agent.llm_provider,
        "llm_model": agent.llm_model,
        "has_api_key": bool(agent.encrypted_api_key),
        "avatar_emoji": agent.avatar_emoji,
        "status": agent.status,
        "created_at": agent.created_at.isoformat(),
        "updated_at": agent.updated_at.isoformat() if agent.updated_at else None,
    }


@router.get("/dashboard", response_model=DashboardResponse)
def get_dashboard(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resident_count = db.query(User).filter(User.is_active.is_(True)).count()
    agent = db.query(Agent).filter(Agent.user_id == current_user.id).first()

    if agent:
        agents_list = [_agent_to_public(agent)]
        placeholder = None
    else:
        agents_list = []
        placeholder = AgentPlaceholder(
            message="你還沒有 AI 室友",
            hint="領養一位室友陪你吧",
        )

    return DashboardResponse(
        welcome_message=f"歡迎回家，{current_user.display_name}",
        user={
            "id": current_user.id,
            "display_name": current_user.display_name,
            "role": current_user.role,
        },
        agents=agents_list,
        agent_placeholder=placeholder,
        spaces=[
            SpaceInfo(id="plaza", name="中央廣場", status="coming_soon"),
            SpaceInfo(id="library", name="圖書館", status="coming_soon"),
            SpaceInfo(id="park", name="公園", status="coming_soon"),
            SpaceInfo(id="workshop", name="工坊", status="coming_soon"),
        ],
        resident_count=resident_count,
        community_status=CommunityStatus(
            phase=2,
            message="社區正在成長中，AI 室友已開放領養！",
        ),
    )
