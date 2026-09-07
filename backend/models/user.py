import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(64), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="resident")
    invite_code_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("invite_codes.id"), nullable=True)
    birth_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 兩個重要的日子（YYYY-MM-DD），填了鎖死、可先不填；兩個都有才有星球座標，否則「星空漂流中」（2026-09-07 她定，migration 004）
    anchor_date_1: Mapped[str | None] = mapped_column(String(10), nullable=True)
    anchor_date_2: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # 住戶當地時區（IANA 名，空＝Asia/Taipei）。艙室內用它，公共場域用社區時間台北（2026-09-07 她定，migration 005）
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
