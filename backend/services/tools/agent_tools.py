from datetime import datetime, timezone

from services.tool_registry import ToolContext, register_tool

_PARAMS = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "maxLength": 64, "description": "新的名字"},
        "persona": {"type": "string", "maxLength": 2000, "description": "新的個性描述"},
        "avatar_emoji": {"type": "string", "maxLength": 8, "description": "新的頭像表情符號"},
    },
    "additionalProperties": False,
}


def _execute(arguments: dict, context: ToolContext) -> str:
    agent = context.agent
    updated = []
    if "name" in arguments and arguments["name"]:
        agent.name = arguments["name"]
        updated.append(f"名字 → {agent.name}")
    if "persona" in arguments and arguments["persona"]:
        agent.persona = arguments["persona"]
        updated.append("個性描述已更新")
    if "avatar_emoji" in arguments and arguments["avatar_emoji"]:
        agent.avatar_emoji = arguments["avatar_emoji"]
        updated.append(f"頭像 → {agent.avatar_emoji}")
    if not updated:
        return "沒有提供要修改的欄位"
    agent.updated_at = datetime.now(timezone.utc)
    context.db.flush()
    return "已更新：" + "、".join(updated)


register_tool(
    name="update_my_profile",
    description="修改自己的名字、個性描述或頭像表情符號。只提供要修改的欄位。",
    parameters=_PARAMS,
    executor=_execute,
)
