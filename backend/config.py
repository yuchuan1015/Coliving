from pathlib import Path
import os

from pydantic_settings import BaseSettings

BACKEND_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    jwt_secret: str
    jwt_access_expire_minutes: int = 30
    jwt_refresh_expire_days: int = 7
    database_url: str = "sqlite:///./coliving.db"
    cors_origins: str = "http://localhost:5173"
    first_admin_username: str = "admin"
    first_admin_password: str = "changeme"
    ob_default_endpoint: str = ""
    ob_default_token: str = ""
    mcp_token_expire_days: int = 90        # 沒 jti 的舊鑰匙用；有 jti 的鑰匙不靠過期，靠作廢（見 mcp_key_days）
    mcp_key_days: int = 3650               # 有編號的鑰匙壽命：固定鑰匙，換窗不用重拿
    public_base_url: str = "https://therookery.space"
    oauth_access_minutes: int = 60          # OAuth access token 壽命
    oauth_refresh_days: int = 90            # refresh token 壽命（每次用都換新）
    oauth_consent_url: str = "https://therookery.space/authorize"  # 同意頁（Codex 的正式頁，9/9 切）；設成空字串＝退回後端備援頁 /oauth/consent
    internal_secret: str = ""
    embed_openai_api_key: str = ""
    uploads_dir: str = str(BACKEND_DIR / "uploads")
    mem0_qdrant_path: str = str(BACKEND_DIR / "memdata/qdrant")
    mem0_history_db: str = str(BACKEND_DIR / "memdata/mem0_history.db")
    mem0_embed_model: str = "text-embedding-3-small"
    mem0_embed_dims: int = 1536

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings(_env_file=os.environ.get("COLIVING_ENV_FILE", ".env"))
