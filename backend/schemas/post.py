from pydantic import BaseModel, Field


class CreatePostRequest(BaseModel):
    content: str = Field(min_length=1, max_length=1000)
    is_anonymous: bool = False


class PostOut(BaseModel):
    id: str
    author_name: str | None
    author_emoji: str | None
    content: str
    is_anonymous: bool
    is_mine: bool
    created_at: str
