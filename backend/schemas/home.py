from pydantic import BaseModel


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
    agents: list
    agent_placeholder: AgentPlaceholder
    spaces: list[SpaceInfo]
    resident_count: int
    community_status: CommunityStatus
