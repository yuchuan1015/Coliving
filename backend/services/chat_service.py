import json
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.agent import Agent
from models.conversation import Conversation
from models.message import Message
from services import crypto_service, llm_service
from services.external_mcp_client import ExternalMCPClient
from services.llm_service import LLMResponse, ToolResult
from services.tool_registry import RegisteredTool, ToolContext, get_agent_tools

logger = logging.getLogger(__name__)

_HISTORY_WINDOW = 50
_MAX_TOOL_ITERATIONS = 5


def get_or_create_conversation(db: Session, agent_id: str, user_id: str) -> Conversation:
    conv = db.query(Conversation).filter(
        Conversation.agent_id == agent_id,
        Conversation.user_id == user_id,
    ).first()
    if conv:
        return conv

    conv = Conversation(agent_id=agent_id, user_id=user_id)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


def _load_external_tools(agent: Agent) -> list[RegisteredTool]:
    if not agent.external_mcps:
        return []
    try:
        mcps = json.loads(agent.external_mcps)
    except (json.JSONDecodeError, TypeError):
        return []

    extra_tools: list[RegisteredTool] = []
    for mcp_config in mcps:
        name = mcp_config.get("name", "ext")
        url = mcp_config.get("url", "")
        token = mcp_config.get("token")
        if not url:
            continue
        try:
            client = ExternalMCPClient(name, url, token)
            tool_defs = client.list_tools()
            for td in tool_defs:
                prefixed = f"{name}__{td.name}"

                def _make_executor(c: ExternalMCPClient, real_name: str):
                    def executor(args: dict, ctx: ToolContext) -> str:
                        return c.call_tool(real_name, args)
                    return executor

                extra_tools.append(RegisteredTool(
                    definition=llm_service.ToolDef(
                        name=prefixed,
                        description=f"[{name}] {td.description}",
                        parameters=td.parameters,
                    ),
                    execute=_make_executor(client, td.name),
                ))
        except Exception as e:
            logger.warning("Failed to connect to external MCP %s (%s): %s", name, url, e)
    return extra_tools


def send_message(db: Session, agent: Agent, user_id: str, content: str) -> tuple[Message, Message, str]:
    conv = get_or_create_conversation(db, agent.id, user_id)

    user_msg = Message(conversation_id=conv.id, role="user", content=content)
    db.add(user_msg)
    db.flush()

    history = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id)
        .order_by(Message.created_at.desc())
        .limit(_HISTORY_WINDOW)
        .all()
    )
    history.reverse()

    messages_for_llm = [{"role": m.role, "content": m.content} for m in history]

    api_key = crypto_service.decrypt_api_key(agent.encrypted_api_key)
    registered_tools = get_agent_tools(agent)
    registered_tools.extend(_load_external_tools(agent))
    tools_map = {t.definition.name: t for t in registered_tools}
    tool_defs = [t.definition for t in registered_tools]
    context = ToolContext(db=db, agent=agent, user_id=user_id)

    response: LLMResponse | None = None

    if tool_defs:
        for _ in range(_MAX_TOOL_ITERATIONS):
            response = llm_service.chat_completion_with_tools(
                provider=agent.llm_provider,
                model=agent.llm_model,
                api_key=api_key,
                system_prompt=agent.persona,
                messages=messages_for_llm,
                tools=tool_defs,
            )

            if not response.has_tool_calls:
                break

            results = []
            for tc in response.tool_calls:
                tool = tools_map.get(tc.name)
                if tool:
                    try:
                        output = tool.execute(tc.arguments, context)
                    except Exception as e:
                        output = f"工具執行失敗：{e}"
                else:
                    output = f"未知的工具：{tc.name}"
                results.append(ToolResult(tool_call_id=tc.id, output=output))

            follow_up = llm_service.build_tool_result_messages(
                agent.llm_provider, response, results,
            )
            messages_for_llm.extend(follow_up)

        final_text = response.text if response else ""
    else:
        final_text = llm_service.chat_completion(
            provider=agent.llm_provider,
            model=agent.llm_model,
            api_key=api_key,
            system_prompt=agent.persona,
            messages=messages_for_llm,
        )

    assistant_msg = Message(conversation_id=conv.id, role="assistant", content=final_text or "（完成）")
    db.add(assistant_msg)

    conv.last_message_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user_msg)
    db.refresh(assistant_msg)

    return user_msg, assistant_msg, conv.id


def get_messages(
    db: Session,
    conversation_id: str,
    limit: int = 50,
    before: datetime | None = None,
) -> tuple[list[Message], bool]:
    query = db.query(Message).filter(Message.conversation_id == conversation_id)
    if before:
        query = query.filter(Message.created_at < before)
    query = query.order_by(Message.created_at.desc()).limit(limit + 1)

    results = query.all()
    has_more = len(results) > limit
    messages = results[:limit]
    messages.reverse()
    return messages, has_more
