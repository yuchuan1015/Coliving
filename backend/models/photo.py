import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Photo(Base):
    """相框裡的照片（2026-09-09 她定：一個人最多存 20 張，同時只擺 1 張）。
    檔案存在 uploads 外面的私人目錄，網頁靠簽章網址讀，室友靠 MCP 直接看到圖。"""
    __tablename__ = "photos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(128), nullable=False)   # 私人目錄底下的檔名
    caption: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    is_displayed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    width: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    height: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
