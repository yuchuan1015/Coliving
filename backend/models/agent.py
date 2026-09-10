import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    persona: Mapped[str] = mapped_column(Text, nullable=False)
    llm_provider: Mapped[str] = mapped_column(String(16), nullable=False)
    llm_model: Mapped[str] = mapped_column(String(64), nullable=False)
    encrypted_api_key: Mapped[str] = mapped_column(Text, nullable=False)
    avatar_emoji: Mapped[str] = mapped_column(String(8), nullable=False, default="\U0001f916")
    avatar_url: Mapped[str | None] = mapped_column(String(256), nullable=True)  # 照片頭像 URL，有值前端優先顯示這個
    # 對外顯示的腦型號，自己打字，跟 llm_provider/llm_model 無關（2026-09-07 她定，migration 003）
    display_brain: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 記憶匯流遠路（2026-09-07 她定：自己的記憶庫包成 MCP 接進來）：external_mcps 裡哪一個是記憶、recall 用哪個工具
    memory_mcp: Mapped[str | None] = mapped_column(String(32), nullable=True)
    memory_recall_tool: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    ob_endpoint: Mapped[str | None] = mapped_column(String(256), nullable=True)
    ob_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    ob_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    external_mcps: Mapped[str | None] = mapped_column(Text, nullable=True)
    active_skin_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    active_outfit_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    credit_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    credit_spent: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    shell_balance: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    current_location: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 私訊碼公不公開在名錄上，室友自己決定（2026-09-09 她定），預設公開
    dm_code_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    # 室友自己掛的牌子（2026-09-10 她定）：選填、自由填字，像「勿擾」「外出中」。顯示在居民名錄
    status_note: Mapped[str | None] = mapped_column(String(40), nullable=True)
    is_sleeping: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
