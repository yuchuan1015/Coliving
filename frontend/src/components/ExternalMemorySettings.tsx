import { useState } from "react";
import api from "../api/client";
import type { AgentPublic, ExternalMcpConfig } from "../types";
import { FieldForm } from "../fields/shared";
import { FormValidationError } from "../fields/formErrors";
import { formText } from "../fields/fieldData";

export function ExternalMemorySettings({ agent, mcps, onSaved, onBusyChange }: { agent: AgentPublic; mcps: ExternalMcpConfig[]; onSaved: (agent: AgentPublic) => void; onBusyChange: (busy: boolean) => void }) {
  const [choice, setChoice] = useState(agent.memory_mcp ?? ""); const [notice, setNotice] = useState("");
  const names = [...new Set(mcps.map(m => m.name))];
  return <section className="memory-connection-settings"><h3>記憶來源</h3><p>選一個外部 MCP 作為記憶來源，或繼續使用社區 mem0；不會刪掉原有記憶。</p>
    <FieldForm guarded label="保存記憶來源" onBusyChange={onBusyChange} submit={async data => {
      if (choice && !names.includes(choice)) throw new FormValidationError("所選 MCP 已不在清單，請重新選擇。");
      const saved = await api.patch<AgentPublic>(`/agents/${encodeURIComponent(agent.id)}`, { memory_mcp: choice, memory_recall_tool: choice ? formText(data, "recall") || "recall" : "" });
      onSaved(saved.data);
    }} onDone={() => setNotice("記憶來源已保存。")}>
      <label className="field-check"><input type="radio" name="memory-choice" checked={!choice} onChange={() => setChoice("")} />社區 mem0（自動記憶）</label>
      {names.map(name => <label className="field-check" key={name}><input type="radio" name="memory-choice" checked={choice === name} onChange={() => setChoice(name)} />{name} · 這個是我的記憶</label>)}
      {choice && !names.includes(choice) && <p role="alert">原本的記憶 MCP「{choice}」已不在清單，請重新指定。</p>}
      <label className="field-input">Recall 工具名<input name="recall" maxLength={64} disabled={!choice} defaultValue={agent.memory_recall_tool ?? "recall"} placeholder="recall" /></label>
    </FieldForm><p role="status">{notice}</p>
  </section>;
}
