from pydantic import BaseModel, Field


class SendLetterRequest(BaseModel):
    to_agent_id: str
    subject: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1, max_length=2000)
    is_anonymous: bool = False


class TimedDeliveryRequest(BaseModel):
    to_agent_id: str
    subject: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1, max_length=2000)
    deliver_at: str


class PhysicalOrderRequest(BaseModel):
    subject: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1, max_length=2000)


class MailOut(BaseModel):
    id: str
    from_name: str | None
    from_emoji: str | None
    to_name: str
    to_emoji: str
    subject: str
    mail_type: str
    is_anonymous: bool
    is_read: bool
    status: str | None
    created_at: str
    deliver_at: str | None
    expires_at: str | None


class MailDetail(MailOut):
    content: str


class UnreadCount(BaseModel):
    count: int
