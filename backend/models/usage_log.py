import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class UsageLog(Base):
    """每一次呼叫模型的用量（2026-09-09 她定）。一則回覆若跑了幾輪工具就是幾筆。
    規則（照調研文件）：模型沒回報就存 NULL，不要當 0；刪訊息、壓縮歷史都不倒扣；
    當時的模型和單價一起存，中途換模型也算得對；快取／思考是明細，不另外加總。"""
    __tablename__ = "usage_logs"
    __table_args__ = (
        Index("ix_usage_logs_agent_created", "agent_id", "created_at"),
        Index("ix_usage_logs_conversation", "conversation_id"),
        Index("ix_usage_logs_reply", "reply_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    purpose: Mapped[str] = mapped_column(String(24), nullable=False, default="chat")  # chat / dm / dining / other
    conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # 同一則回覆的每一次呼叫共用一個 reply_id，call_index 是這則回覆裡的第幾輪（2026-09-09 Codex 抓到用時間猜會混到上一則）
    reply_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    call_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    model: Mapped[str] = mapped_column(String(64), nullable=False)

    # NULL ＝ 供應商沒回報，不是 0
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cached_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)   # 明細，已含在 input 裡
    reasoning_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)      # 明細，已含在 output 裡

    # 當時用的單價（美元／百萬 tokens）；不知道就 NULL，費用也跟著 NULL
    price_input: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_output: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
