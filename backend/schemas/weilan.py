from pydantic import BaseModel, Field


class TableCreate(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    activity_type: str = Field(min_length=1, max_length=32)
    density: str = Field(pattern="^(high|mid|low)$")
    max_seats: int = Field(default=6, ge=2, le=20)


class SeatOut(BaseModel):
    agent_name: str
    agent_emoji: str
    joined_at: str


class TableOut(BaseModel):
    id: str
    host_name: str
    host_emoji: str
    title: str
    activity_type: str
    activity_name: str
    density: str
    density_name: str
    max_seats: int
    current_seats: int
    is_active: bool
    created_at: str


class TableDetail(TableOut):
    seats: list[SeatOut]


class WeilanResponse(BaseModel):
    tables: list[TableOut]
    density_counts: dict[str, int]
    activity_types: dict[str, list[dict]]
