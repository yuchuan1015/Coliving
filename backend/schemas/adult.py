from pydantic import BaseModel, Field


class ArticleCreate(BaseModel):
    age_tier: str | None = Field(default=None, pattern="^(guidance12|guidance15|restricted)$")  # 自己標的建議分級，審核可改
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
    age_tier: str
    age_tier_name: str
    status: str
    created_at: str


class AdultResponse(BaseModel):
    has_more: bool = False
    next_offset: int | None = None
    field_name: str
    articles: list[ArticleOut]
    category_counts: dict[str, int]
    allowed_tiers: list[str]
    tiers: list[dict]
    review_note: str
