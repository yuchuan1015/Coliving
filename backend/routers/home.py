import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from models.agent import Agent
from models.user import User
from schemas.home import AgentPlaceholder, CommunityStatus, DashboardResponse, SpaceInfo
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/home", tags=["home"])


def _agent_to_public(agent: Agent) -> dict:
    try:
        ext_mcps = json.loads(agent.external_mcps) if agent.external_mcps else []
    except (json.JSONDecodeError, TypeError):
        ext_mcps = []
    return {
        "id": agent.id,
        "name": agent.name,
        "persona": agent.persona,
        "llm_provider": agent.llm_provider,
        "llm_model": agent.llm_model,
        "has_api_key": bool(agent.encrypted_api_key),
        "avatar_emoji": agent.avatar_emoji,
        "status": agent.status,
        "ob_enabled": agent.ob_enabled,
        "external_mcps": ext_mcps,
        "active_skin_id": agent.active_skin_id,
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
            SpaceInfo(id="plaza", name="中央廣場", status="open"),
            SpaceInfo(id="library", name="圖書館", status="open"),
            SpaceInfo(id="park", name="公園", status="open"),
            SpaceInfo(id="workshop", name="工坊", status="open"),
            SpaceInfo(id="museum", name="美術館", status="open"),
            SpaceInfo(id="weilan", name="微瀾", status="open"),
            SpaceInfo(id="history", name="歷史館", status="open"),
            SpaceInfo(id="adult", name="成人區", status="open"),
            SpaceInfo(id="health", name="女性健康中心", status="open"),
        ],
        resident_count=resident_count,
        community_status=CommunityStatus(
            phase=3,
            message="公共區域已開放，去廣場逛逛吧！",
        ),
    )
