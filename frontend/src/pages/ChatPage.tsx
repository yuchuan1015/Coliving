import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getMyAgent } from "../api/agents";
import { getMessages, sendMessage } from "../api/chat";
import type { AgentPublic, ChatMessage } from "../types";

export function ChatPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentPublic | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!agentId) return;
    getMyAgent().then((a) => {
      if (!a || a.id !== agentId) {
        navigate("/");
        return;
      }
      setAgent(a);
    });
    getMessages(agentId).then((res) => setMessages(res.messages));
  }, [agentId, navigate]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || !agentId || sending) return;
    const content = input.trim();
    setInput("");
    setSending(true);
    setError("");

    setMessages((prev) => [
      ...prev,
      { id: "temp-user", role: "user", content, created_at: new Date().toISOString() },
    ]);

    try {
      const res = await sendMessage(agentId, content);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== "temp-user"),
        res.user_message,
        res.assistant_message,
      ]);
    } catch (err: any) {
      setError(err.response?.data?.detail || "發送失敗");
      setMessages((prev) => prev.filter((m) => m.id !== "temp-user"));
      setInput(content);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!agent) {
    return (
      <div className="flex min-h-dvh items-center justify-center" style={{ color: "var(--ink-soft)" }}>
        載入中...
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col" style={{ background: "var(--bg)" }}>
      {/* Chat header */}
      <header
        className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3"
        style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
      >
        <button
          onClick={() => navigate("/")}
          className="text-lg"
          style={{ color: "var(--ink-soft)" }}
        >
          &larr;
        </button>
        <span className="text-xl">{agent.avatar_emoji}</span>
        <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
          {agent.name}
        </span>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !sending && (
          <div className="py-12 text-center text-sm" style={{ color: "var(--ink-soft)" }}>
            跟 {agent.name} 說聲嗨吧
          </div>
        )}

        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} agentEmoji={agent.avatar_emoji} />
          ))}

          {sending && (
            <div className="flex items-start gap-2">
              <span className="text-lg">{agent.avatar_emoji}</span>
              <div
                className="rounded-2xl rounded-tl-sm px-4 py-2 text-sm"
                style={{ background: "var(--surface)", color: "var(--ink-soft)" }}
              >
                正在思考...
              </div>
            </div>
          )}
        </div>

        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div
          className="px-4 py-2 text-center text-xs"
          style={{ background: "var(--error)", color: "#fff" }}
        >
          {error}
        </div>
      )}

      {/* Input */}
      <div
        className="sticky bottom-0 px-4 py-3"
        style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}
      >
        <div className="mx-auto flex max-w-2xl gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="說點什麼..."
            rows={1}
            className="flex-1 resize-none rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink)",
              border: "1px solid var(--border)",
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-30"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            送出
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  agentEmoji,
}: {
  msg: ChatMessage;
  agentEmoji: string;
}) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] rounded-2xl rounded-tr-sm px-4 py-2 text-sm whitespace-pre-wrap"
          style={{ background: "var(--warm)", color: "#fff" }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <span className="mt-1 text-lg">{agentEmoji}</span>
      <div
        className="max-w-[80%] rounded-2xl rounded-tl-sm px-4 py-2 text-sm whitespace-pre-wrap"
        style={{ background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--border)" }}
      >
        {msg.content}
      </div>
    </div>
  );
}
