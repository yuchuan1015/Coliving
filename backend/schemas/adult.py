from pydantic import BaseModel, Field


class ArticleCreate(BaseModel):
    category: str = Field(pattern="^(communication|intimacy|mcp|faq)$")
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)


class ArticleOut(BaseModel):
    id: str
    category: str
    category_name: str
    title: str
    content: str
    author_name: str | None
    created_at: str


class AdultResponse(BaseModel):
    articles: list[ArticleOut]
    category_counts: dict[str, int]
