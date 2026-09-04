from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable

from config import settings
from services.llm_service import ToolDef

if TYPE_CHECKING:
    from sqlalchemy.orm import Session
    from models.agent import Agent


@dataclass
class ToolContext:
    db: "Session"
    agent: "Agent"
    user_id: str


@dataclass
class RegisteredTool:
    definition: ToolDef
    execute: Callable[[dict, ToolContext], str]


_TOOLS: dict[str, RegisteredTool] = {}
_OB_TOOL_NAMES: list[str] = []


def register_tool(name: str, description: str, parameters: dict, executor: Callable[[dict, ToolContext], str], *, is_ob: bool = False):
    tool = RegisteredTool(
        definition=ToolDef(name=name, description=description, parameters=parameters),
        execute=executor,
    )
    _TOOLS[name] = tool
    if is_ob:
        _OB_TOOL_NAMES.append(name)


def get_agent_tools(agent: "Agent") -> list[RegisteredTool]:
    tools = [t for name, t in _TOOLS.items() if name not in _OB_TOOL_NAMES]

    if agent.ob_enabled and _has_ob_config(agent):
        for name in _OB_TOOL_NAMES:
            if name in _TOOLS:
                tools.append(_TOOLS[name])

    return tools


def find_tool(name: str) -> RegisteredTool | None:
    return _TOOLS.get(name)


def _has_ob_config(agent: "Agent") -> bool:
    return bool(agent.ob_endpoint or settings.ob_default_endpoint)


from services.tools import agent_tools, ob_tools  # noqa: E402, F401
