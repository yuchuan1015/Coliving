from config import settings
from services import crypto_service
from services.ob_client import OBClient
from services.tool_registry import ToolContext, register_tool


def _get_ob_client(context: ToolContext) -> OBClient:
    agent = context.agent
    endpoint = agent.ob_endpoint or settings.ob_default_endpoint
    if agent.ob_token:
        token = crypto_service.decrypt_api_key(agent.ob_token)
    else:
        token = settings.ob_default_token
    if not endpoint or not token:
        raise ValueError("OB 記憶系統未設定")
    return OBClient(endpoint, token)


def _execute_remember(arguments: dict, context: ToolContext) -> str:
    content = arguments.get("content", "")
    if not content:
        return "沒有提供要記住的內容"
    client = _get_ob_client(context)
    return client.hold(content)


def _execute_recall(arguments: dict, context: ToolContext) -> str:
    query = arguments.get("query", "")
    client = _get_ob_client(context)
    if query:
        return client.breath_search(query)
    return client.breath()


def _execute_self_reflect(arguments: dict, context: ToolContext) -> str:
    content = arguments.get("content", "")
    client = _get_ob_client(context)
    if content:
        return client.I_write(content)
    return client.I_read()


register_tool(
    name="remember",
    description="記住一件重要的事情，存入長期記憶。",
    parameters={
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "要記住的內容"},
        },
        "required": ["content"],
    },
    executor=_execute_remember,
    is_ob=True,
)

register_tool(
    name="recall",
    description="回憶過去的事情。可以給一個關鍵詞來搜尋，或不給關鍵詞來回顧最近的記憶。",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "搜尋關鍵詞（可選）"},
        },
    },
    executor=_execute_recall,
    is_ob=True,
)

register_tool(
    name="self_reflect",
    description="閱讀或更新自我認識。不傳 content 時閱讀現有內容，傳 content 時更新。",
    parameters={
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "新的自我認識（可選，不傳時閱讀）"},
        },
    },
    executor=_execute_self_reflect,
    is_ob=True,
)
