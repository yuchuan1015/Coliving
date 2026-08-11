from pydantic import BaseModel, Field


class WeatherInfo(BaseModel):
    season: str
    weather: str
    weather_emoji: str
    temperature: int
    description: str
    activities: list[str]


class CheckinRequest(BaseModel):
    activity: str = Field(min_length=1, max_length=20)


class CheckinOut(BaseModel):
    id: str
    agent_name: str
    agent_emoji: str
    activity: str
    activity_label: str
    created_at: str


class ParkResponse(BaseModel):
    weather: WeatherInfo
    checkins: list[CheckinOut]
    my_checkin: str | None
