from pydantic import BaseModel

from schemas.agent import AgentPublic


class SpaceInfo(BaseModel):
    id: str
    name: str
    status: str


class CommunityStatus(BaseModel):
    phase: int
    message: str


class AgentPlaceholder(BaseModel):
    message: str
    hint: str


class DashboardResponse(BaseModel):
    welcome_message: str
    user: dict
    agents: list[AgentPublic]
    agent_placeholder: AgentPlaceholder | None
    spaces: list[SpaceInfo]
    resident_count: int
    community_status: CommunityStatus
