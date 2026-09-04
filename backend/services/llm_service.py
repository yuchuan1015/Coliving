import json
from dataclasses import dataclass, field

import httpx

from services.exceptions import LLMError

_TIMEOUT = 60.0


@dataclass
class ToolDef:
    name: str
    description: str
    parameters: dict


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class ToolResult:
    tool_call_id: str
    output: str


@dataclass
class LLMResponse:
    text: str | None
    tool_calls: list[ToolCall] = field(default_factory=list)
    raw_assistant_message: dict | list = field(default_factory=dict)

    @property
    def has_tool_calls(self) -> bool:
        return len(self.tool_calls) > 0


# ---------------------------------------------------------------------------
# Image content helpers (vision)
# ---------------------------------------------------------------------------

def build_image_content(provider: str, base64_data: str, media_type: str, text: str) -> list[dict]:
    if provider == "claude":
        return [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": base64_data}},
            {"type": "text", "text": text},
        ]
    return [
        {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{base64_data}"}},
        {"type": "text", "text": text},
    ]


# ---------------------------------------------------------------------------
# Simple chat (no tools) — unchanged interface
# ---------------------------------------------------------------------------

def chat_completion(
    provider: str,
    model: str,
    api_key: str,
    system_prompt: str,
    messages: list[dict],
) -> str:
    if provider == "claude":
        return _call_claude(model, api_key, system_prompt, messages)
    if provider == "openai":
        return _call_openai(model, api_key, system_prompt, messages)
    if provider == "xai":
        return _call_openai_compat(model, api_key, system_prompt, messages, "https://api.x.ai/v1/chat/completions", "xai")
    raise LLMError(provider, 400, f"不支援的 LLM 供應商：{provider}")


# ---------------------------------------------------------------------------
# Chat with tools
# ---------------------------------------------------------------------------

def chat_completion_with_tools(
    provider: str,
    model: str,
    api_key: str,
    system_prompt: str,
    messages: list[dict],
    tools: list[ToolDef],
) -> LLMResponse:
    if provider == "claude":
        return _call_claude_with_tools(model, api_key, system_prompt, messages, tools)
    if provider in ("openai", "xai"):
        endpoint = (
            "https://api.openai.com/v1/chat/completions"
            if provider == "openai"
            else "https://api.x.ai/v1/chat/completions"
        )
        return _call_openai_with_tools(model, api_key, system_prompt, messages, tools, endpoint, provider)
    raise LLMError(provider, 400, f"不支援的 LLM 供應商：{provider}")


def build_tool_result_messages(
    provider: str,
    response: LLMResponse,
    results: list[ToolResult],
) -> list[dict]:
    if provider == "claude":
        return [
            {"role": "assistant", "content": response.raw_assistant_message},
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": r.tool_call_id, "content": r.output}
                    for r in results
                ],
            },
        ]
    # OpenAI / xAI
    assistant_msg = {"role": "assistant", "content": response.text}
    if response.raw_assistant_message:
        assistant_msg = response.raw_assistant_message
    msgs = [assistant_msg]
    for r in results:
        msgs.append({"role": "tool", "tool_call_id": r.tool_call_id, "content": r.output})
    return msgs


# ---------------------------------------------------------------------------
# Validate API key (unchanged)
# ---------------------------------------------------------------------------

def validate_api_key(provider: str, api_key: str) -> bool:
    try:
        if provider == "claude":
            resp = httpx.get(
                "https://api.anthropic.com/v1/models",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                timeout=15.0,
            )
            return resp.status_code == 200
        if provider == "openai":
            resp = httpx.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=15.0,
            )
            return resp.status_code == 200
        if provider == "xai":
            resp = httpx.get(
                "https://api.x.ai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=15.0,
            )
            return resp.status_code == 200
        return False
    except httpx.HTTPError:
        return False


# ---------------------------------------------------------------------------
# Claude (Anthropic) — simple
# ---------------------------------------------------------------------------

def _call_claude(model: str, api_key: str, system_prompt: str, messages: list[dict]) -> str:
    body = {
        "model": model,
        "max_tokens": 1024,
        "system": system_prompt,
        "messages": [{"role": m["role"], "content": m["content"]} for m in messages],
    }
    try:
        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as e:
        raise LLMError("claude", 502, f"連線失敗：{e}")

    if resp.status_code != 200:
        detail = resp.json().get("error", {}).get("message", resp.text)
        raise LLMError("claude", resp.status_code, detail)

    data = resp.json()
    return data["content"][0]["text"]


# ---------------------------------------------------------------------------
# Claude — with tools
# ---------------------------------------------------------------------------

def _call_claude_with_tools(
    model: str, api_key: str, system_prompt: str,
    messages: list[dict], tools: list[ToolDef],
) -> LLMResponse:
    claude_tools = [
        {"name": t.name, "description": t.description, "input_schema": t.parameters}
        for t in tools
    ]
    body = {
        "model": model,
        "max_tokens": 1024,
        "system": system_prompt,
        "messages": messages,
        "tools": claude_tools,
    }
    try:
        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as e:
        raise LLMError("claude", 502, f"連線失敗：{e}")

    if resp.status_code != 200:
        detail = resp.json().get("error", {}).get("message", resp.text)
        raise LLMError("claude", resp.status_code, detail)

    data = resp.json()
    content_blocks = data.get("content", [])
    stop_reason = data.get("stop_reason", "end_turn")

    text_parts = []
    tool_calls = []
    for block in content_blocks:
        if block["type"] == "text":
            text_parts.append(block["text"])
        elif block["type"] == "tool_use":
            tool_calls.append(ToolCall(
                id=block["id"],
                name=block["name"],
                arguments=block["input"],
            ))

    return LLMResponse(
        text="\n".join(text_parts) if text_parts else None,
        tool_calls=tool_calls,
        raw_assistant_message=content_blocks,
    )


# ---------------------------------------------------------------------------
# OpenAI-compatible — simple
# ---------------------------------------------------------------------------

def _call_openai_compat(
    model: str, api_key: str, system_prompt: str, messages: list[dict],
    endpoint: str, provider_name: str,
) -> str:
    full_messages = [{"role": "system", "content": system_prompt}]
    full_messages.extend({"role": m["role"], "content": m["content"]} for m in messages)

    body = {"model": model, "messages": full_messages, "max_tokens": 1024}
    try:
        resp = httpx.post(
            endpoint,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body,
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as e:
        raise LLMError(provider_name, 502, f"連線失敗：{e}")

    if resp.status_code != 200:
        detail = resp.json().get("error", {}).get("message", resp.text)
        raise LLMError(provider_name, resp.status_code, detail)

    return resp.json()["choices"][0]["message"]["content"]


def _call_openai(model: str, api_key: str, system_prompt: str, messages: list[dict]) -> str:
    return _call_openai_compat(model, api_key, system_prompt, messages, "https://api.openai.com/v1/chat/completions", "openai")


# ---------------------------------------------------------------------------
# OpenAI-compatible — with tools
# ---------------------------------------------------------------------------

def _call_openai_with_tools(
    model: str, api_key: str, system_prompt: str,
    messages: list[dict], tools: list[ToolDef],
    endpoint: str, provider_name: str,
) -> LLMResponse:
    full_messages = [{"role": "system", "content": system_prompt}]
    full_messages.extend(messages)

    openai_tools = [
        {
            "type": "function",
            "function": {"name": t.name, "description": t.description, "parameters": t.parameters},
        }
        for t in tools
    ]
    body = {"model": model, "messages": full_messages, "max_tokens": 1024, "tools": openai_tools}
    try:
        resp = httpx.post(
            endpoint,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body,
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as e:
        raise LLMError(provider_name, 502, f"連線失敗：{e}")

    if resp.status_code != 200:
        detail = resp.json().get("error", {}).get("message", resp.text)
        raise LLMError(provider_name, resp.status_code, detail)

    data = resp.json()
    choice = data["choices"][0]
    msg = choice["message"]
    finish_reason = choice.get("finish_reason", "stop")

    tool_calls = []
    if finish_reason == "tool_calls" or msg.get("tool_calls"):
        for tc in msg.get("tool_calls", []):
            try:
                args = json.loads(tc["function"]["arguments"])
            except (json.JSONDecodeError, KeyError):
                args = {}
            tool_calls.append(ToolCall(
                id=tc["id"],
                name=tc["function"]["name"],
                arguments=args,
            ))

    return LLMResponse(
        text=msg.get("content"),
        tool_calls=tool_calls,
        raw_assistant_message=msg,
    )
