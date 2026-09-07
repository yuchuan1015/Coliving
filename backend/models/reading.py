import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Book(Base):
    """共讀書架上的一本書。一戶（user）一個書架，人和室友共讀。私人的，別人看不到。"""
    __tablename__ = "books"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    author: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source_format: Mapped[str] = mapped_column(String(8), nullable=False, default="txt")  # txt / md
    total_pages: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    total_paragraphs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_page: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # 讀到哪（一戶共用）
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class BookParagraph(Base):
    __tablename__ = "book_paragraphs"
    __table_args__ = (Index("ix_book_paragraphs_book_page", "book_id", "page"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    book_id: Mapped[str] = mapped_column(String(36), ForeignKey("books.id", ondelete="CASCADE"), nullable=False)
    page: Mapped[int] = mapped_column(Integer, nullable=False)
    idx: Mapped[int] = mapped_column(Integer, nullable=False)  # 全書段落編號，1 起
    text: Mapped[str] = mapped_column(Text, nullable=False)


class BookHighlight(Base):
    """劃線：某段裡的一句原文。author_kind human / agent；bed 記哪張床劃的。"""
    __tablename__ = "book_highlights"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    book_id: Mapped[str] = mapped_column(String(36), ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    paragraph_idx: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    author_kind: Mapped[str] = mapped_column(String(8), nullable=False)  # human / agent
    bed: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class BookNote(Base):
    """批注：掛在某段，可選掛在某條劃線上。"""
    __tablename__ = "book_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    book_id: Mapped[str] = mapped_column(String(36), ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    paragraph_idx: Mapped[int] = mapped_column(Integer, nullable=False)
    highlight_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("book_highlights.id", ondelete="SET NULL"), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    author_kind: Mapped[str] = mapped_column(String(8), nullable=False)
    bed: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
