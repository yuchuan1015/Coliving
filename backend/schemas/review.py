from pydantic import BaseModel, Field


class ReviewOut(BaseModel):
    id: str
    content_type: str
    content_id: str
    submitter_name: str
    submitter_emoji: str
    status: str
    reviewer_note: str | None
    reviewed_at: str | None
    created_at: str
    title: str | None = None
    summary: str | None = None


class ReviewDecision(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")
    note: str = Field(min_length=1, max_length=2000)
