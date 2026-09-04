from __future__ import annotations

import json

import httpx


class OBClient:
    def __init__(self, endpoint: str, token: str):
        self.endpoint = endpoint
        self.token = token
        self.session_id: str | None = None
        self._request_id = 0

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    def _headers(self) -> dict:
        h = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}",
        }
        if self.session_id:
            h["Mcp-Session-Id"] = self.session_id
        return h

    def initialize(self) -> None:
        body = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "coliving", "version": "0.1.0"},
            },
        }
        resp = httpx.post(self.endpoint, json=body, headers=self._headers(), timeout=15.0)
        self.session_id = resp.headers.get("mcp-session-id")

    def call_tool(self, tool_name: str, arguments: dict) -> str:
        if not self.session_id:
            self.initialize()

        body = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }
        resp = httpx.post(self.endpoint, json=body, headers=self._headers(), timeout=30.0)

        content_type = resp.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            return _parse_sse_result(resp.text)

        data = resp.json()
        if "result" in data:
            return _extract_text(data["result"])
        if "error" in data:
            return f"OB 錯誤：{data['error'].get('message', str(data['error']))}"
        return str(data)

    def hold(self, content: str) -> str:
        return self.call_tool("hold", {"content": content})

    def breath(self) -> str:
        return self.call_tool("breath", {})

    def breath_search(self, query: str) -> str:
        return self.call_tool("breath_search", {"query": query})

    def I_read(self) -> str:
        return self.call_tool("I", {"read": True})

    def I_write(self, content: str) -> str:
        return self.call_tool("I", {"content": content})


def _parse_sse_result(raw: str) -> str:
    for line in raw.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            data = json.loads(payload)
            if "result" in data:
                return _extract_text(data["result"])
        except json.JSONDecodeError:
            continue
    return raw


def _extract_text(result: dict) -> str:
    content = result.get("content", [])
    parts = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "\n".join(parts) if parts else str(result)
