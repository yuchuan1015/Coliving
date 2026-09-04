from pydantic import BaseModel, Field


class ArticleCreate(BaseModel):
    category: str = Field(pattern="^(puberty|menstrual|autonomy|agent_guide)$")
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)
    age_tier: str = Field(default="adult", pattern="^(child|teen|adult)$")


class ArticleOut(BaseModel):
    id: str
    category: str
    category_name: str
    title: str
    content: str
    age_tier: str
    age_tier_name: str
    author_name: str | None
    created_at: str


class HealthResponse(BaseModel):
    articles: list[ArticleOut]
    category_counts: dict[str, int]
