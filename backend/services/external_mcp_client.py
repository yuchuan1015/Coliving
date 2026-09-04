from __future__ import annotations

import json

import httpx

from services.llm_service import ToolDef


class ExternalMCPClient:
    def __init__(self, name: str, url: str, token: str | None = None):
        self.name = name
        self.url = url
        self.token = token
        self.session_id: str | None = None
        self._request_id = 0

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
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
                "clientInfo": {"name": "coliving", "version": "1.0"},
            },
        }
        resp = httpx.post(self.url, json=body, headers=self._headers(), timeout=10.0)
        self.session_id = resp.headers.get("mcp-session-id")

    def list_tools(self) -> list[ToolDef]:
        if not self.session_id:
            self.initialize()
        body = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tools/list",
            "params": {},
        }
        resp = httpx.post(self.url, json=body, headers=self._headers(), timeout=10.0)
        data = self._parse_response(resp)
        tools = []
        if data and "result" in data and "tools" in data["result"]:
            for t in data["result"]["tools"]:
                tools.append(ToolDef(
                    name=t["name"],
                    description=t.get("description", ""),
                    parameters=t.get("inputSchema", {}),
                ))
        return tools

    def call_tool(self, tool_name: str, arguments: dict) -> str:
        if not self.session_id:
            self.initialize()
        body = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }
        resp = httpx.post(self.url, json=body, headers=self._headers(), timeout=30.0)
        data = self._parse_response(resp)
        if data and "result" in data:
            content = data["result"].get("content", [])
            texts = [c["text"] for c in content if isinstance(c, dict) and c.get("type") == "text"]
            return "\n".join(texts) if texts else str(data["result"])
        if data and "error" in data:
            return f"外部 MCP 錯誤：{data['error'].get('message', str(data['error']))}"
        return str(data)

    def _parse_response(self, resp: httpx.Response) -> dict | None:
        ct = resp.headers.get("content-type", "")
        if "text/event-stream" in ct:
            for line in resp.text.splitlines():
                if line.startswith("data:"):
                    payload = line[5:].strip()
                    if payload and payload != "[DONE]":
                        try:
                            return json.loads(payload)
                        except json.JSONDecodeError:
                            continue
            return None
        if "application/json" in ct:
            return resp.json()
        return None
