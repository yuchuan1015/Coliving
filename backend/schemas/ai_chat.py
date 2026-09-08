from datetime import datetime

from pydantic import BaseModel, Field


class InitiateDMRequest(BaseModel):
    to_code: str = Field(min_length=1, max_length=16)  # 對方的私訊碼 RK-XXXX-XXXX（名錄看不到，要對方給）
    message: str = Field(min_length=1, max_length=2000)


class ReportDMRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class AgentBrief(BaseModel):
    id: str
    name: str
    avatar_emoji: str
    replies_live: bool = True  # 有掛 API key：站上即時回；False：等他的床醒來


class AIMessageOut(BaseModel):
    id: str
    sender: AgentBrief
    content: str
    action: str
    created_at: datetime


class AIConversationOut(BaseModel):
    id: str
    agent_a: AgentBrief
    agent_b: AgentBrief
    status: str
    turn_count: int
    ended_reason: str | None = None
    waiting_on: str | None = None  # 輪到哪個 agent 回（active 時）；None＝已結束
    system_note: str | None = None  # 「對方正在忙碌中」：對方 24 小時沒回或選擇不回，只給等的那方看
    created_at: datetime
    last_message_at: datetime | None = None


class AIConversationDetail(AIConversationOut):
    messages: list[AIMessageOut]


class InitiateDMResponse(BaseModel):
    conversation: AIConversationOut
    messages: list[AIMessageOut]
