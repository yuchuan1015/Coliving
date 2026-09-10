import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { getMyAgent } from "../api/agents";
import { getMessages, sendMessage } from "../api/chat";
import type { AgentPublic, ChatMessage } from "../types";
import { ChatUsageDialog } from "../components/ChatUsageDialog";
import "../chat-layout.css";

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
  const messagesRef = useRef<HTMLDivElement>(null);
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
    // Scroll this conversation, never the page or an open usage dialog.
    const panel = messagesRef.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [input, agent]);

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
      <div className="cabin-chat">
        <div className="chat-window chat-load-state">
          {loadError ? <div><p role="alert">{uiText(loadError)}</p><button type="button" onClick={() => { setLoadError(""); setRetry(value => value + 1); }}>{uiText("重新讀取對話")}</button><p><Link to="/">{uiText("返回艙室")}</Link></p></div> : <p role="status">{uiText("載入中...")}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="cabin-chat">
      <section className="chat-window" aria-label={uiText("與室友聊天")}>
        <header className="chat-header">
          <button
            type="button"
            onClick={() => navigate("/")}
            aria-label={uiText("返回艙室")}
            className="chat-back"
          >
            &larr;
          </button>
          <span className="chat-avatar chat-header-avatar" aria-hidden="true">{agent.avatar_emoji}</span>
          <h1 className="chat-name">{agent.name}</h1>
          <button type="button" className="chat-usage-trigger" aria-haspopup="dialog" onClick={() => { usageOpenRef.current = true; setUsageOpen(true); }}>{uiText("用量")}</button>
        </header>

        {/* Messages */}
        <div className="chat-messages" ref={messagesRef} role="region" aria-label={uiText("聊天紀錄")} tabIndex={0}>
          {messages.length === 0 && !sending && (
            <div className="chat-empty"><span className="chat-empty-avatar" aria-hidden="true">{agent.avatar_emoji}</span><p>{uiText("跟 ")}{agent.name}{uiText(" 說聲嗨吧")}</p></div>
          )}

          <div className="chat-message-list">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} agentEmoji={agent.avatar_emoji} />
            ))}

            {sending && (
              <div className="chat-message-row chat-message-incoming" role="status">
                <span className="chat-avatar" aria-hidden="true">{agent.avatar_emoji}</span>
                <div className="chat-bubble chat-thinking">{uiText("正在思考...")}</div>
              </div>
            )}
          </div>

        </div>

        <footer className="chat-composer">
          {error && (
            <div role="alert" className="chat-send-error">
              {uiText(error)}
              {needsMemory && <p><Link to="/agent/edit#editor-note">{uiText("前往鏡子，寫下「給室友的話」 →")}</Link></p>}
              {memoryOffline && <p>{uiText("記憶庫目前連不上，請稍後再試或檢查外部記憶連線設定；不需要重寫原有記憶。")}</p>}
            </div>
          )}

          <div className="chat-compose-row">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={uiText("說點什麼...")}
              aria-label={uiText("聊天訊息")}
              rows={1}
              readOnly={sending}
              className="chat-input"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="chat-send"
              aria-label={uiText("送出")}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5m-6 6 6-6 6 6" />
              </svg>
              <span className="chat-sr-only">{uiText("送出")}</span>
            </button>
          </div>
        </footer>
      </section>
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
      <div className="chat-message-row chat-message-outgoing">
        <div className="chat-bubble">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-message-row chat-message-incoming">
      <span className="chat-avatar" aria-hidden="true">{agentEmoji}</span>
      <div className="chat-bubble">
        {msg.content}
      </div>
    </div>
  );
}
