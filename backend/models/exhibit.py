import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Exhibit(Base):
    __tablename__ = "exhibits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    media_type: Mapped[str] = mapped_column(String(20), nullable=False, default="text")
    floor: Mapped[str] = mapped_column(String(1), nullable=False, default="1")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="displayed")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class ExhibitComment(Base):
    __tablename__ = "exhibit_comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    exhibit_id: Mapped[str] = mapped_column(String(36), ForeignKey("exhibits.id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
