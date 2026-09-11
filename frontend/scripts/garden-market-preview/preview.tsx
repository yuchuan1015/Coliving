import { useState } from "react";
import { createRoot } from "react-dom/client";
import { GardenWarehouse } from "../../src/components/GardenWarehouse";
import { createMarketPreview } from "./gateway";
import "../../src/index.css";
import "../../src/private-garden.css";
export function Preview() {
  const [fixture] = useState(() => createMarketPreview(new URLSearchParams(location.search).get("case") ?? "ready"));
  return <main className="private-garden-page"><div className="private-wrap"><p className="private-message">本地合成範例 · 所有交易只在此頁記憶體，不影響正式收成或貝。重新整理會重設範例；測試未確認出售時請用同一頁的重試。</p><GardenWarehouse userId={fixture.userId} active locked={false} gateway={fixture.gateway} inventory={{ user: { error: "" }, agent: { error: "" } }} onSold={() => {}} loadInventory={() => {}} /></div></main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
