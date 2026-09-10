from pydantic import BaseModel, Field, field_validator


def validate_new_password(value: str) -> str:
    if len(value.encode("utf-8")) > 72:
        raise ValueError("密碼最多 72 個 UTF-8 位元組，中文字會佔多個位元組")
    return value


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = Field(default=None, max_length=64)
    invite_code: str = Field(min_length=1, max_length=16)
    birth_year: int = Field(ge=1900, le=2026)
    anchor_date_1: str | None = Field(default=None, pattern=r"^\d{2}-\d{2}$")  # 月-日
    anchor_date_2: str | None = Field(default=None, pattern=r"^\d{2}-\d{2}$")
    timezone: str | None = Field(default=None, max_length=64)  # IANA 名，前端用 Intl 自動帶；空＝Asia/Taipei

    _password_bytes = field_validator("password")(validate_new_password)


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class CreateInviteCodeRequest(BaseModel):
    label: str | None = None
    max_uses: int = Field(default=1, ge=1, le=50)
