from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    jwt_secret: str
    jwt_access_expire_minutes: int = 30
    jwt_refresh_expire_days: int = 7
    database_url: str = "sqlite:///./coliving.db"
    cors_origins: str = "http://localhost:5173"
    first_admin_username: str = "admin"
    first_admin_password: str = "changeme"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
