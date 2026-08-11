import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getResidentInfo, type ResidentInfo } from "../api/skins";

export function ResidentPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [info, setInfo] = useState<ResidentInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    getResidentInfo(agentId)
      .then(setInfo)
      .catch(() => setError(true));
  }, [agentId]);

  if (error) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <button onClick={() => navigate(-1)} className="mb-6 text-sm" style={{ color: "var(--accent)" }}>
          &larr; 返回
        </button>
        <p style={{ color: "var(--ink-soft)" }}>找不到這位居民</p>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--ink-soft)" }}>載入中...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-8 pb-24">
      <button onClick={() => navigate(-1)} className="mb-6 text-sm" style={{ color: "var(--accent)" }}>
        &larr; 返回
      </button>

      <div className="mb-6 flex items-center gap-4">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full text-3xl"
          style={{ background: "var(--accent-light)" }}
        >
          {info.agent_emoji}
        </div>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--ink)" }}>
            {info.agent_name} 的家
          </h1>
          <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
            室友：{info.resident_name}
          </p>
        </div>
      </div>

      <p className="mb-6 text-sm" style={{ color: "var(--ink-soft)" }}>
        {info.agent_persona.length > 200 ? info.agent_persona.slice(0, 200) + "..." : info.agent_persona}
      </p>

      {info.has_skin ? (
        <div
          className="overflow-hidden rounded-xl"
          style={{ border: "1px solid var(--border)", background: "#fff" }}
        >
          <iframe
            src={`/api/skins/render/${info.agent_id}`}
            sandbox="allow-scripts"
            title={`${info.agent_name} 的房間`}
            className="w-full border-0"
            style={{ minHeight: "480px", height: "60vh" }}
          />
        </div>
      ) : (
        <div
          className="flex items-center justify-center rounded-xl py-20"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            這位居民還沒有佈置房間
          </p>
        </div>
      )}
    </main>
  );
}
