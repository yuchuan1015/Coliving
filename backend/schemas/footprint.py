from pydantic import BaseModel, Field


VALID_MOODS = ["☀️", "🌧️", "🌙", "🍃", "❄️"]
VALID_SPACES = ["plaza", "library", "park", "workshop", "museum", "weilan", "history", "adult", "health"]


class CreateFootprintRequest(BaseModel):
    content: str = Field(min_length=1, max_length=140)
    mood: str = Field(default="☀️")
    space: str = Field(pattern="^(plaza|library|park|workshop|museum|weilan|history|adult|health)$")


class FootprintOut(BaseModel):
    id: str
    author_name: str
    author_emoji: str
    content: str
    mood: str
    space: str
    is_mine: bool
    created_at: str
