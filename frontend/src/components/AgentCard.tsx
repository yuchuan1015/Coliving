import { useNavigate } from "react-router-dom";
import type { AgentPublic } from "../types";

export function AgentCard({ agent }: { agent: AgentPublic }) {
  const navigate = useNavigate();

  return (
    <section
      className="mb-6 rounded-xl p-5"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="mb-3 flex items-center gap-3">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full text-2xl"
          style={{ background: "var(--accent-light)" }}
        >
          {agent.avatar_emoji}
        </div>
        <div>
          <h2 className="text-base font-medium" style={{ color: "var(--ink)" }}>
            {agent.name}
          </h2>
          <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
            {agent.llm_provider === "claude" ? "Claude" : agent.llm_provider === "xai" ? "Grok" : "GPT"} · {agent.llm_model}
          </span>
        </div>
      </div>
      <p
        className="mb-4 line-clamp-2 text-sm"
        style={{ color: "var(--ink-soft)" }}
      >
        {agent.persona}
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => navigate(`/chat/${agent.id}`)}
          className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
        >
          聊天
        </button>
        <button
          onClick={() => navigate(`/agent/edit`)}
          className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--surface-dim)", color: "var(--ink-soft)", border: "1px solid var(--border)" }}
        >
          編輯
        </button>
        <button
          onClick={() => navigate(`/schedules`)}
          className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--surface-dim)", color: "var(--ink-soft)", border: "1px solid var(--border)" }}
        >
          排程
        </button>
      </div>
    </section>
  );
}
