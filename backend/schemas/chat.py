from pydantic import BaseModel, Field


class SendMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    created_at: str

    model_config = {"from_attributes": True}


class SendMessageResponse(BaseModel):
    user_message: MessageOut
    assistant_message: MessageOut
    conversation_id: str


class MessageHistoryResponse(BaseModel):
    messages: list[MessageOut]
    conversation_id: str
    has_more: bool
