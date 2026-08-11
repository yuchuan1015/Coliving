from datetime import datetime

from pydantic import BaseModel, Field


class InitiateDMRequest(BaseModel):
    to_agent_name: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=2000)


class AgentBrief(BaseModel):
    id: str
    name: str
    avatar_emoji: str


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
    created_at: datetime
    last_message_at: datetime | None = None


class AIConversationDetail(AIConversationOut):
    messages: list[AIMessageOut]


class InitiateDMResponse(BaseModel):
    conversation: AIConversationOut
    messages: list[AIMessageOut]
