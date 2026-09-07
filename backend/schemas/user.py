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
    anchor_date_1: str | None = None
    anchor_date_2: str | None = None
    coordinate: dict | None = None     # {l, b, r, rank}；None＝漂流中
    drifting: bool = True
    label: str | None = None           # 漂流中時是「星空漂流中」


class AnchorRequest(BaseModel):
    anchor_date_1: str | None = None  # 月-日，例如 10-15
    anchor_date_2: str | None = None

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
    coordinate: dict | None = None  # 這戶的星球座標；None＝漂流中
    drifting: bool = True
    label: str | None = None
    distance_ly: float | None = None  # 從看的人的星球到這裡；自己 0；任一方漂流中 None


class ResidentListResponse(BaseModel):
    residents: list[ResidentWithAgent]
    total: int
