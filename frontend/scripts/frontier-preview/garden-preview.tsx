import { useState } from "react";
import { PublicGardenPage } from "../../src/pages/PublicGardenPage";
import { gardenCommand, type GardenCommand, type GardenGateway, type PublicGarden } from "../../src/api/garden";

// Deliberately constructed illustration, NOT a captured public-growing response.
// Candidate IDs/names match the tier1-v1 public-vote fixture. Every identity and
// planting ID is synthetic. This module is excluded from the production app.
const crops = [
  ["broccoli", "青花菜"], ["carrot", "胡蘿蔔"], ["cauliflower", "花椰菜"], ["cucumber", "小黃瓜"],
  ["daikon", "白蘿蔔"], ["kohlrabi", "球莖甘藍"], ["pak_choi", "小白菜"], ["petite_oyster_mushroom", "秀珍菇"],
  ["potato", "馬鈴薯"], ["tomato", "番茄"], ["vegetable_fern", "過貓"], ["water_spinach", "空心菜"],
].map(([id, name]) => ({ id, name }));

// oxlint-disable-next-line react/only-export-components -- also exercised by the non-browser fixture contract tests.
export function createGardenPreview(mode: "growing" | "vote"): GardenGateway {
  const started = Date.now();
  const snapshot: PublicGarden = {
    server_now: new Date(started).toISOString(), garden_time: "2026-01-19T09:30:00Z", garden_month: 1,
    actor: { kind: "user", id: "frontier-preview", household_id: "preview-household" },
    crops, public_area: { gross_m2: 667, productive_m2: 480 },
    plots: [{ id: "preview-public:1", scope: "public", number: 1,
      crop_name: mode === "growing" ? "小白菜" : null,
      planting: mode === "growing" ? { planting_id: "preview-planting", crop_id: "pak_choi", status: "growing",
        health: 94, moisture: 34, nutrients: 78, needs: ["water"], random_problem: null } : null,
      allowed_actions: mode === "growing" ? ["water", "care"] : ["vote"],
      vote: mode === "vote" ? { id: "preview-vote", status: "open", closes_at: new Date(started + 12 * 3600000).toISOString(),
        candidates: crops.map(crop => crop.id), counts: Object.fromEntries(crops.map(crop => [crop.id, 0])), my_vote: null } : null,
      contributors: mode === "growing" ? Array.from({ length: 8 }, (_, index) => ({ kind: index % 2 ? "agent" : "user", id: `preview-person-${index}`, household_id: `preview-household-${index}` })) : [],
      care_logs: mode === "growing" ? [
        { id: 3, kind: "care", actor_key: "agent:preview-person-3", created_at: new Date(started - 5400000).toISOString() },
        { id: 2, kind: "water", actor_key: "user:preview-person-2", created_at: new Date(started - 9600000).toISOString() },
        { id: 1, kind: "public_plant", actor_key: null, created_at: new Date(started - 10800000).toISOString() },
      ] : [{ id: 1, kind: "public_vote", actor_key: null, created_at: new Date(started).toISOString() }],
    }],
  };
  const receipts = new Map<string, { command: string; result: unknown }>();
  return {
    async read(signal) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      snapshot.server_now = new Date().toISOString();
      return structuredClone(snapshot);
    },
    async act(command: GardenCommand) {
      const previous = receipts.get(command.request_id);
      if (previous) return previous.command === JSON.stringify(command) ? structuredClone(previous.result)
        : { results: [{ ok: false, error: { detail: "示範操作識別碼衝突。", status_code: 409 } }] };
      const plot = snapshot.plots[0];
      const valid = gardenCommand(plot, command.action, command.request_id, Date.now(), command.action === "vote" ? command.crop_id : undefined);
      if (!valid || JSON.stringify(valid) !== JSON.stringify(command)) return { results: [{ ok: false, error: { detail: "此示範狀態已無法執行操作，請更新近況。", status_code: 409 } }] };
      if (command.action === "vote") {
        plot.vote!.my_vote = { crop_id: command.crop_id };
        plot.vote!.counts[command.crop_id] += 1;
        plot.allowed_actions = [];
      } else {
        if (command.action === "water") plot.planting!.moisture = Math.max(plot.planting!.moisture, 80);
        else {
          if (plot.planting!.moisture < 40) plot.planting!.moisture = 80;
          if (plot.planting!.moisture > 90) plot.planting!.moisture = 70;
          if (plot.planting!.nutrients < 35) plot.planting!.nutrients = 80;
          plot.planting!.random_problem = null;
        }
        plot.planting!.needs = [];
        if (!plot.contributors.some(person => person.id === snapshot.actor.id)) plot.contributors.push({ ...snapshot.actor });
      }
      plot.care_logs.unshift({ id: plot.care_logs.length + 1, kind: command.action, actor_key: "user:frontier-preview", created_at: new Date().toISOString() });
      const result = { results: [{ ok: true, result: { plot: structuredClone(plot), server_now: new Date().toISOString() } }] };
      receipts.set(command.request_id, { command: JSON.stringify(command), result });
      return result;
    },
  };
}

function PreviewState({ mode }: { mode: "growing" | "vote" }) {
  const [gateway] = useState(() => createGardenPreview(mode));
  return <PublicGardenPage gateway={gateway} />;
}

export function GardenPreview() {
  const [mode, setMode] = useState<"growing" | "vote">("growing");
  return <><aside className="garden-preview-bar" aria-label="介面示範狀態">
    <span>示範資料 · 不會操作正式農田</span><div role="group" aria-label="查看不同介面狀態"><button type="button" aria-pressed={mode === "growing"} onClick={() => setMode("growing")}>生長中</button><button type="button" aria-pressed={mode === "vote"} onClick={() => setMode("vote")}>下一輪投票</button></div>
  </aside><PreviewState key={mode} mode={mode} /></>;
}
