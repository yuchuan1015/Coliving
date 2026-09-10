from datetime import datetime

from pydantic import BaseModel, Field, field_validator
from schemas.auth import validate_new_password


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
    note_to_agent: str | None = None   # 住戶留給室友的一段話（最多 1000 字），室友醒來一定讀到
    anchor_date_1: str | None = None
    anchor_date_2: str | None = None
    coordinate: dict | None = None     # {l, b, r, rank, partial}；None＝漂流中；partial＝只有第一個日子，b 暫定 0
    drifting: bool = True
    partial: bool = False              # 定了經度、還在找緯度
    label: str | None = None           # 「星空漂流中」／「定了經度、還在找緯度」／None
    timezone: str | None = None        # 住戶填的 IANA 名；空＝Asia/Taipei
    location_name: str | None = None   # 住戶填的城市；空＝用時區推
    clock: dict | None = None          # {utc, timezone, local_time, community_timezone, community_time}


class UpdateMeRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=64)
    note_to_agent: str | None = Field(default=None, max_length=1000)  # 給室友的話；空字串＝清掉
    timezone: str | None = Field(default=None, max_length=64)
    location_name: str | None = Field(default=None, max_length=64)  # 城市名，空字串清掉（回到用時區推）
    birth_year: int | None = Field(default=None, ge=1900, le=2026)   # 只能補填一次（舊帳號沒填的用）；填了鎖死，18+ 門檻靠它

    @field_validator("display_name")
    @classmethod
    def nonblank_name(cls, value):
        if value is None or not value.strip():
            raise ValueError("顯示名稱不能空白")
        return value.strip()


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(min_length=1, max_length=128, repr=False)
    new_password: str = Field(min_length=6, max_length=72, repr=False)

    _password_bytes = field_validator("new_password")(validate_new_password)


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
    agent_avatar_url: str | None = None
    agent_brain: str | None = None  # 對外顯示的腦型號（住戶自填）
    agent_dm_code: str | None = None  # 這位室友的私訊碼；他選擇不公開就是 None
    agent_status_note: str | None = None  # 室友自己掛的牌子（勿擾、外出中…），沒掛就是 None
    coordinate: dict | None = None  # 這戶的星球座標；None＝漂流中
    drifting: bool = True
    partial: bool = False
    label: str | None = None
    distance_ly: float | None = None  # 從看的人的星球到這裡；自己 0；任一方漂流中 None


class ResidentListResponse(BaseModel):
    residents: list[ResidentWithAgent]
    total: int
