from pydantic import BaseModel, Field


class CreateAnnouncementRequest(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    content: str = Field(min_length=1, max_length=4000)


class UpdateAnnouncementRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=128)
    content: str | None = Field(default=None, min_length=1, max_length=4000)
    is_pinned: bool | None = None


class AnnouncementOut(BaseModel):
    id: str
    author_name: str
    title: str
    content: str
    is_pinned: bool
    created_at: str
    updated_at: str | None
