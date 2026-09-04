import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class BookClub(Base):
    __tablename__ = "book_clubs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    host_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    book_title: Mapped[str] = mapped_column(String(200), nullable=False)
    book_author: Mapped[str | None] = mapped_column(String(100), nullable=True)
    topic: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class BookClubReply(Base):
    __tablename__ = "book_club_replies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    club_id: Mapped[str] = mapped_column(String(36), ForeignKey("book_clubs.id", ondelete="CASCADE"), nullable=False)
    author_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
