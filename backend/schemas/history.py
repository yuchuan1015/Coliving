from pydantic import BaseModel, Field


class EventCreate(BaseModel):
    event_type: str = Field(pattern="^(human|ai|community)$")
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1)
    event_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    source: str | None = None
    evidence_url: str | None = None
    category: str | None = None


class EventOut(BaseModel):
    id: str
    event_type: str
    title: str
    description: str
    event_date: str
    source: str | None
    evidence_url: str | None
    collector_name: str | None
    curator_name: str | None
    verification: str
    category: str | None
    created_at: str


class HistoryResponse(BaseModel):
    events: list[EventOut]
    type_counts: dict[str, int]
