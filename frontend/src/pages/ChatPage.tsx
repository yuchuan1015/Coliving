import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { getMyAgent } from "../api/agents";
import { getMessages, sendMessage } from "../api/chat";
import type { AgentPublic, ChatMessage } from "../types";
import { ChatUsageDialog } from "../components/ChatUsageDialog";

export function ChatPage() {
  useUiLanguage();
  const { agentId } = useParams<{ agentId: string }>();
  return agentId ? <ChatSession key={agentId} agentId={agentId} /> : <p role="alert">{uiText("找不到這段對話。")}<Link to="/">{uiText("返回艙室")}</Link></p>;
}

export function ChatSession({ agentId }: { agentId: string }) {
  useUiLanguage();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentPublic | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [needsMemory, setNeedsMemory] = useState(false);
  const [memoryOffline, setMemoryOffline] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [usageOpen, setUsageOpen] = useState(false);
  const usageOpenRef = useRef(false);
  const [usageRevision, setUsageRevision] = useState(0);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;
    getMyAgent().then(async (a) => {
      if (cancelled) return;
      if (!a || a.id !== agentId) {
        navigate("/");
        return;
      }
      const res = await getMessages(agentId);
      if (cancelled) return;
      setAgent(a);
      setMessages(res.messages);
    }).catch(() => { if (!cancelled) setLoadError("對話暫時無法載入，請重新讀取。"); });
    return () => { cancelled = true; mountedRef.current = false; };
  }, [agentId, navigate, retry]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || !agent || sendingRef.current) return;
    sendingRef.current = true;
    const content = input.trim();
    setInput("");
    setSending(true);
    setError("");
    setNeedsMemory(false);
    setMemoryOffline(false);

    setMessages((prev) => [
      ...prev,
      { id: "temp-user", role: "user", content, created_at: new Date().toISOString() },
    ]);

    try {
      const res = await sendMessage(agentId, content);
      if (!mountedRef.current) return;
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== "temp-user"),
        res.user_message,
        res.assistant_message,
      ]);
      setUsageRevision(value => value + 1);
    } catch (err) {
      if (!mountedRef.current) return;
      const detail = isAxiosError(err) ? err.response?.data?.detail : undefined;
      const conflict = isAxiosError(err) && err.response?.status === 409;
      setError(typeof detail === "string" ? detail : "發送失敗");
      setNeedsMemory(conflict && detail === "還沒讀到記憶");
      setMemoryOffline(conflict && detail === "還沒讀到記憶（記憶庫連不上）");
      setMessages((prev) => prev.filter((m) => m.id !== "temp-user"));
      setInput(content);
    } finally {
      sendingRef.current = false;
      if (mountedRef.current) {
        setSending(false);
        // Do not steal focus from the modal when a reply finishes behind it.
        if (!usageOpenRef.current) inputRef.current?.focus();
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!agent) {
    return (
      <div className="cabin-chat flex min-h-dvh items-center justify-center" style={{ color: "var(--ink-soft)", background: "var(--bg)" }}>
        {loadError ? <div><p role="alert">{loadError}</p><button type="button" onClick={() => { setLoadError(""); setRetry(value => value + 1); }}>{uiText("重新讀取對話")}</button><p><Link to="/">{uiText("返回艙室")}</Link></p></div> : <p role="status">{uiText("載入中...")}</p>}
      </div>
    );
  }

  return (
    <div className="cabin-chat flex min-h-dvh flex-col" style={{ background: "var(--bg)" }}>
      {/* Chat header */}
      <header
        className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3"
        style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
      >
        <button
          onClick={() => navigate("/")}
          aria-label={uiText("返回艙室")}
          className="text-lg"
          style={{ color: "var(--ink-soft)" }}
        >
          &larr;
        </button>
        <span className="text-xl">{agent.avatar_emoji}</span>
        <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
          {agent.name}
        </span>
        <button type="button" className="chat-usage-trigger" aria-haspopup="dialog" onClick={() => { usageOpenRef.current = true; setUsageOpen(true); }}>{uiText("用量")}</button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !sending && (
          <div className="py-12 text-center text-sm" style={{ color: "var(--ink-soft)" }}>{uiText("跟 ")}{agent.name}{uiText(" 說聲嗨吧")}</div>
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
              >{uiText("正在思考...")}</div>
            </div>
          )}
        </div>

        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="px-4 py-2 text-center text-xs"
          style={{ background: "var(--error)", color: "#fff" }}
        >
          {uiText(error)}
          {needsMemory && <p><Link to="/agent/edit#editor-note">{uiText("前往鏡子，寫下「給室友的話」 →")}</Link></p>}
          {memoryOffline && <p>{uiText("記憶庫目前連不上，請稍後再試或檢查外部記憶連線設定；不需要重寫原有記憶。")}</p>}
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
            placeholder={uiText("說點什麼...")}
            aria-label={uiText("聊天訊息")}
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
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >{uiText("送出")}</button>
        </div>
      </div>
      {usageOpen && <ChatUsageDialog agentId={agentId} revision={usageRevision} onClose={() => { usageOpenRef.current = false; setUsageOpen(false); }} />}
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
          style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
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
