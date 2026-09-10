import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";

/** An agent's own words, read-only and never machine-translated. */
export function AgentStatusNote({ note }: { note?: string | null }) {
  useUiLanguage();
  return typeof note === "string" && note.trim()
    ? <span className="agent-status-note" aria-label={uiText("室友狀態牌")}>{note}</span>
    : null;
}
