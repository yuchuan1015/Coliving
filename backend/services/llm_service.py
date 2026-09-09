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

# ───────── 用量收集（2026-09-09 她定）─────────
# 不改任何函式簽名：呼叫端用 collect() 包起來，這一段期間所有模型呼叫的用量都會被接住。
# 一則回覆跑幾輪工具就會有幾筆。供應商沒回報就存 None，不要當 0。

import contextlib  # noqa: E402
from contextvars import ContextVar  # noqa: E402

_usage_sink: ContextVar[list | None] = ContextVar("llm_usage_sink", default=None)


@contextlib.contextmanager
def collect():
    """with llm_service.collect() as calls: ... 之後 calls 裡是這段期間每一次呼叫的用量。"""
    calls: list[dict] = []
    token = _usage_sink.set(calls)
    try:
        yield calls
    finally:
        _usage_sink.reset(token)


def _record(provider: str, model: str, data: dict) -> None:
    sink = _usage_sink.get()
    if sink is None:
        return
    sink.append({"provider": provider, "model": model, **_extract_usage(provider, data)})


def _extract_usage(provider: str, data: dict) -> dict:
    """把各家的用量欄位收斂成同一組。抓不到就 None（未取得），不要填 0。
    快取與思考是明細，已經含在 input／output 裡，不另外加總。"""
    out = {"input_tokens": None, "output_tokens": None, "cached_input_tokens": None, "reasoning_tokens": None}
    if not isinstance(data, dict):
        return out
    if provider == "claude":
        u = data.get("usage") or {}
        out["input_tokens"] = u.get("input_tokens")
        out["output_tokens"] = u.get("output_tokens")
        cached = u.get("cache_read_input_tokens")
        created = u.get("cache_creation_input_tokens")
        if cached is not None or created is not None:
            out["cached_input_tokens"] = (cached or 0) + (created or 0)
        return out
    if provider == "gemini":
        u = data.get("usageMetadata") or {}
        out["input_tokens"] = u.get("promptTokenCount")
        out["output_tokens"] = u.get("candidatesTokenCount")
        out["cached_input_tokens"] = u.get("cachedContentTokenCount")
        out["reasoning_tokens"] = u.get("thoughtsTokenCount")
        return out
    # OpenAI 相容（openai / xai / deepseek）
    u = data.get("usage") or {}
    out["input_tokens"] = u.get("prompt_tokens")
    out["output_tokens"] = u.get("completion_tokens")
    out["cached_input_tokens"] = (u.get("prompt_tokens_details") or {}).get("cached_tokens")
    out["reasoning_tokens"] = (u.get("completion_tokens_details") or {}).get("reasoning_tokens")
    return out


# ── 供應商列表與免責 ──

PROVIDERS = {
    "claude": {"name": "Claude (Anthropic)", "endpoint": "https://api.anthropic.com"},
    "openai": {"name": "OpenAI", "endpoint": "https://api.openai.com/v1/chat/completions"},
    "xai": {"name": "xAI (Grok)", "endpoint": "https://api.x.ai/v1/chat/completions"},
    "gemini": {"name": "Gemini (Google)", "endpoint": "https://generativelanguage.googleapis.com"},
    "deepseek": {"name": "DeepSeek", "endpoint": "https://api.deepseek.com/v1/chat/completions"},
}

PRIVACY_DISCLAIMER = "你的對話經由社區伺服器轉送到你選的 AI 供應商，並存在社區資料庫裡，讓你的室友記得你。社區不會把這些資料交給任何第三方，也不會拿去做別的用途。各供應商的隱私政策不同，請自行評估。"


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
    if provider == "gemini":
        return _call_gemini_with_tools(model, api_key, system_prompt, messages, tools)
    if provider in ("openai", "xai", "deepseek"):
        endpoint = {
            "openai": "https://api.openai.com/v1/chat/completions",
            "xai": "https://api.x.ai/v1/chat/completions",
            "deepseek": "https://api.deepseek.com/v1/chat/completions",
        }[provider]
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
        if provider == "gemini":
            resp = httpx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}",
                json={"contents": [{"parts": [{"text": "hi"}]}]},
                timeout=10.0,
            )
            return resp.status_code < 400
        if provider == "deepseek":
            resp = httpx.post(
                "https://api.deepseek.com/v1/chat/completions",
                json={"model": "deepseek-chat", "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1},
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10.0,
            )
            return resp.status_code < 400
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
    _record("claude", model, data)
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
    _record("claude", model, data)
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

    data = resp.json()
    _record(provider_name, model, data)
    return data["choices"][0]["message"]["content"]


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
    _record(provider_name, model, data)
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


# ── Gemini ──


def _gemini_messages(system_prompt: str, messages: list[dict]) -> tuple[dict, list[dict]]:
    system = {"parts": [{"text": system_prompt}]}
    contents = []
    for m in messages:
        role = "model" if m["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": m.get("content", "")}]})
    return system, contents


def _call_gemini(model: str, api_key: str, system_prompt: str, messages: list[dict]) -> str:
    system, contents = _gemini_messages(system_prompt, messages)
    resp = httpx.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
        json={"system_instruction": system, "contents": contents},
        timeout=60.0,
    )
    if resp.status_code >= 400:
        raise LLMError("gemini", resp.status_code, resp.text[:200])
    data = resp.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        raise LLMError("gemini", 500, f"Unexpected response: {str(data)[:200]}")


def _call_gemini_with_tools(
    model: str, api_key: str, system_prompt: str,
    messages: list[dict], tools: list[ToolDef],
) -> "LLMResponse":
    system, contents = _gemini_messages(system_prompt, messages)
    gemini_tools = [{"function_declarations": [
        {"name": t.name, "description": t.description, "parameters": t.parameters or {"type": "object", "properties": {}}}
        for t in tools
    ]}]
    resp = httpx.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
        json={"system_instruction": system, "contents": contents, "tools": gemini_tools},
        timeout=60.0,
    )
    if resp.status_code >= 400:
        raise LLMError("gemini", resp.status_code, resp.text[:200])
    data = resp.json()
    _record("gemini", model, data)
    try:
        parts = data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError):
        return LLMResponse(text="", raw_assistant_message=data)
    text_parts = [p["text"] for p in parts if "text" in p]
    tool_calls = [
        ToolCall(id=p["functionCall"]["name"], name=p["functionCall"]["name"], arguments=p["functionCall"].get("args", {}))
        for p in parts if "functionCall" in p
    ]
    return LLMResponse(text=" ".join(text_parts), tool_calls=tool_calls, raw_assistant_message=data)


def _build_gemini_tool_results(response: "LLMResponse", results: list["ToolResult"]) -> list[dict]:
    msgs = [{"role": "assistant", "content": response.text or "(tool call)"}]
    for r in results:
        msgs.append({"role": "user", "content": f"[Tool result for {r.tool_call_id}]: {r.output}"})
    return msgs
