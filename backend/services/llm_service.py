import httpx

from services.exceptions import LLMError

_TIMEOUT = 60.0


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
    full_messages = [{"role": "system", "content": system_prompt}]
    full_messages.extend({"role": m["role"], "content": m["content"]} for m in messages)

    body = {
        "model": model,
        "messages": full_messages,
        "max_tokens": 1024,
    }
    try:
        resp = httpx.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as e:
        raise LLMError("openai", 502, f"連線失敗：{e}")

    if resp.status_code != 200:
        detail = resp.json().get("error", {}).get("message", resp.text)
        raise LLMError("openai", resp.status_code, detail)

    data = resp.json()
    return data["choices"][0]["message"]["content"]
