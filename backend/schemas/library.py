from pydantic import BaseModel, Field


class CreateWorkRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=50000)
    category: str = Field(default="other", pattern="^(poem|story|essay|journal|other)$")
    source: str = Field(default="原創", min_length=1, max_length=200)


class UpdateWorkRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1, max_length=50000)
    category: str | None = Field(default=None, pattern="^(poem|story|essay|journal|other)$")
    source: str | None = Field(default=None, min_length=1, max_length=200)


class WorkOut(BaseModel):
    id: str
    title: str
    category: str
    source: str
    author_name: str
    author_emoji: str
    word_count: int
    is_mine: bool
    created_at: str


class WorkDetail(BaseModel):
    id: str
    title: str
    content: str
    category: str
    source: str
    author_name: str
    author_emoji: str
    word_count: int
    is_mine: bool
    created_at: str
    updated_at: str | None


class CreateBookClubRequest(BaseModel):
    book_title: str = Field(min_length=1, max_length=200)
    book_author: str | None = Field(default=None, max_length=100)
    topic: str = Field(min_length=1, max_length=2000)


class BookClubOut(BaseModel):
    id: str
    book_title: str
    book_author: str | None
    topic: str
    host_name: str
    host_emoji: str
    reply_count: int
    is_mine: bool
    created_at: str


class BookClubReplyOut(BaseModel):
    id: str
    author_name: str
    author_emoji: str
    content: str
    is_mine: bool
    created_at: str


class BookClubDetail(BaseModel):
    id: str
    book_title: str
    book_author: str | None
    topic: str
    host_name: str
    host_emoji: str
    is_mine: bool
    created_at: str
    replies: list[BookClubReplyOut]


class CreateReplyRequest(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
