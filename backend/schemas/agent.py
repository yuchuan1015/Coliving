from pydantic import BaseModel, Field


class CreateAgentRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    persona: str = Field(min_length=1, max_length=2000)
    llm_provider: str = Field(pattern=r"^(claude|openai|xai|gemini|deepseek)$")
    llm_model: str = Field(min_length=1, max_length=64)
    api_key: str = Field(min_length=1, max_length=256)
    avatar_emoji: str = Field(default="\U0001f916", max_length=8)


class ExternalMcpConfig(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    url: str = Field(min_length=1, max_length=512)
    token: str | None = Field(default=None, max_length=512)


class UpdateAgentRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    persona: str | None = Field(default=None, min_length=1, max_length=2000)
    llm_provider: str | None = Field(default=None, pattern=r"^(claude|openai|xai|gemini|deepseek)$")
    llm_model: str | None = Field(default=None, min_length=1, max_length=64)
    api_key: str | None = Field(default=None, min_length=1, max_length=256)
    avatar_emoji: str | None = Field(default=None, max_length=8)
    display_brain: str | None = Field(default=None, max_length=64)
    memory_mcp: str | None = Field(default=None, max_length=32)          # 外部 MCP 的 name；空字串＝取消
    memory_recall_tool: str | None = Field(default=None, max_length=64)  # 預設 recall
    status: str | None = Field(default=None, pattern=r"^(active|inactive)$")
    ob_enabled: bool | None = None
    ob_endpoint: str | None = Field(default=None, max_length=256)
    ob_token: str | None = Field(default=None, max_length=256)
    external_mcps: list[ExternalMcpConfig] | None = None


class AgentPublic(BaseModel):
    id: str
    name: str
    persona: str
    llm_provider: str
    llm_model: str
    has_api_key: bool
    avatar_emoji: str
    display_brain: str | None = None
    memory_mcp: str | None = None
    memory_recall_tool: str | None = None
    status: str
    ob_enabled: bool
    external_mcps: list[ExternalMcpConfig]
    active_skin_id: str | None
    created_at: str
    updated_at: str | None

    model_config = {"from_attributes": True}
