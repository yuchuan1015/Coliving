import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useNavigate } from "react-router-dom";
import type { AgentPublic } from "../types";
import { McpConnectionActions } from "./McpConnectionActions";
import { McpWebConnection } from "./McpWebConnection";

export function AdoptionSuccess({ agent }: { agent: AgentPublic }) {
  useUiLanguage();
  const navigate = useNavigate();
  return <main className="mcp-adopt-success">
    <h1>{agent.name}{uiText(" 的艙室準備好了")}</h1>
    <p>{uiText("從聊天 app 登入授權，或使用 CLI 鑰匙，讓室友連進社區。")}</p>
    <McpWebConnection />
    <h2>{uiText("CLI 與進階連線")}</h2>
    <p>{uiText("第一把鑰匙可在「進階連線與房間設定」重新複製。指令與進階網址內含鑰匙，請勿公開或截圖分享。")}</p>
    {agent.first_key ? <McpConnectionActions connection={agent.first_key} /> : <p role="status">{uiText("這次回應沒有附上 CLI 連線資料，請到鑰匙清單查看，不必重新領養。")}</p>}
    <div className="mcp-key-actions">
      <button type="button" onClick={() => navigate("/")}>{uiText("返回艙室")}</button>
      <button type="button" onClick={() => navigate("/agent/advanced")}>{uiText("查看鑰匙清單")}</button>
    </div>
  </main>;
}
