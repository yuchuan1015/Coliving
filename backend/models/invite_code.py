import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    max_uses: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    used_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
