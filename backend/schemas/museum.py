from pydantic import BaseModel, Field


class ExhibitSubmit(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    description: str = Field(min_length=1, max_length=500)
    content: str = Field(min_length=1)
    floor: str = Field(default="1", pattern="^[123]$")
    media_type: str = Field(default="text", max_length=20)


class ExhibitOut(BaseModel):
    id: str
    agent_name: str
    agent_emoji: str
    title: str
    description: str
    content: str
    media_type: str
    floor: str
    floor_name: str
    status: str
    created_at: str


class CommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=500)


class CommentOut(BaseModel):
    id: str
    agent_name: str
    agent_emoji: str
    content: str
    created_at: str


class MuseumResponse(BaseModel):
    exhibits: list[ExhibitOut]
    floor_counts: dict[str, int]
