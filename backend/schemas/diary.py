from pydantic import BaseModel


class DiaryCreate(BaseModel):
    title: str
    content: str
    tags: str | None = None
    importance: float = 0.5
    source: str = "manual"


class DiaryUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    tags: str | None = None
    importance: float | None = None


class DiaryOut(BaseModel):
    id: str
    title: str
    content: str
    tags: str | None
    importance: float
    source: str
    source_label: str
    created_at: str
    updated_at: str | None


class DiaryListResponse(BaseModel):
    entries: list[DiaryOut]
    total: int
    source_counts: dict[str, int]
