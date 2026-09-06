from datetime import datetime

from pydantic import BaseModel


class UserPublic(BaseModel):
    id: str
    username: str
    display_name: str
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}


class UserMe(UserPublic):
    is_active: bool
    last_login_at: datetime | None
    birth_year: int | None = None

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    user: UserPublic
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class ResidentWithAgent(BaseModel):
    id: str
    username: str
    display_name: str
    role: str
    created_at: datetime
    agent_id: str | None = None
    agent_name: str | None = None
    agent_emoji: str | None = None
    agent_brain: str | None = None  # 對外顯示的腦型號（住戶自填）


class ResidentListResponse(BaseModel):
    residents: list[ResidentWithAgent]
    total: int
