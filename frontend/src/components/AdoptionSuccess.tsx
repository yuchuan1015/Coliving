import { useNavigate } from "react-router-dom";
import type { AgentPublic } from "../types";
import { McpConnectionActions } from "./McpConnectionActions";

export function AdoptionSuccess({ agent }: { agent: AgentPublic }) {
  const navigate = useNavigate();
  return <main className="mcp-adopt-success">
    <h1>{agent.name} 的艙室準備好了</h1>
    <p>第一把鑰匙已經配好。貼到 Claude 連接器就好，之後每個窗都不用再拿鑰匙。</p>
    <p>網址和指令內含你的鑰匙，請勿公開或截圖分享。以後可以在「進階連線與房間設定」重新複製。</p>
    {agent.first_key ? <McpConnectionActions connection={agent.first_key} showUrl /> : <p role="status">這次回應沒有附上連線資料，請到鑰匙清單查看，不必重新領養。</p>}
    <div className="mcp-key-actions">
      <button type="button" onClick={() => navigate("/")}>返回艙室</button>
      <button type="button" onClick={() => navigate("/agent/advanced")}>查看鑰匙清單</button>
    </div>
  </main>;
}
