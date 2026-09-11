import fixtures from "./fixtures.json";
import { privateCommand, type PrivateCommand, type PrivateGarden, type PrivateGardenGateway, type GardenInventory } from "../../src/api/private-garden";

export const previewModes = ["growing", "ready", "four-plots", "own-proposal", "agent-proposal", "harvested", "cleared", "fractions", "unknown", "stale", "no-agent", "denied", "unavailable"] as const;
export type PreviewMode = typeof previewModes[number];
export function createPrivatePreview(mode: PreviewMode) {
  const start = mode === "own-proposal" ? fixtures.ownProposal : mode === "agent-proposal" ? fixtures.agentProposal : mode === "cleared" ? fixtures.cleared : mode === "harvested" ? fixtures.harvested : mode === "growing" ? fixtures.growing : fixtures.ready;
  // These are isolated backend fixtures, never production snapshots. Additional
  // layout states (four-plots/fractions) are explicitly synthetic examples.
  let data = structuredClone(start) as unknown as PrivateGarden;
  const userId = data.actor.id;
  const inventory: Record<"user" | "agent", GardenInventory> = {
    user: { ...structuredClone(fixtures.inventoryUser), unit: "g", owner: "user", owner_id: userId, items: mode === "harvested" ? fixtures.inventoryUser.items : [] },
    agent: { ...structuredClone(fixtures.inventoryAgent), unit: "g", owner: "agent", items: mode === "harvested" ? fixtures.inventoryAgent.items : [] },
  };
  if (["own-proposal", "agent-proposal", "cleared"].includes(mode)) {
    inventory.user = structuredClone(fixtures.clearUserInventory) as GardenInventory;
    inventory.agent = structuredClone(fixtures.clearAgentInventory) as GardenInventory;
  }
  if (mode === "fractions") {
    inventory.user.items = [{ crop_id: "pak_choi", crop_name: "小白菜", quantity_g: "200/3" }];
    inventory.user.has_more = true; inventory.user.next_offset = 100;
    inventory.agent.items = [{ crop_id: "tomato", crop_name: "番茄", quantity_g: "1/1000000" }];
  }
  if (mode === "four-plots") {
    const example = structuredClone(data.plots[0]);
    data.plots = data.plots.map((p, i) => {
      if (!i) return p;
      const copy = structuredClone(example), crop = data.crops[i];
      copy.id = p.id; copy.number = p.number; copy.crop_name = crop.name;
      copy.planting!.planting_id = `isolated-layout-${i}`; copy.planting!.crop_id = crop.id;
      copy.planting!.status = i === 3 ? "production_complete" : "growing";
      copy.planting!.batches = {}; copy.planting!.moisture = 26 + i * 13;
      copy.allowed_actions = ["water", "propose_clear"]; copy.steal_available = false; copy.care_logs = [];
      return copy;
    });
  }
  const writes: PrivateCommand[][] = [], cache = new Map<string, { command: string; receipt: unknown }>();
  let failOnce = mode === "unknown";
  const gateway: PrivateGardenGateway = {
    async read(signal) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (mode === "denied") throw { response: { status: 403 } };
      if (mode === "no-agent") throw { response: { status: 403, data: { error: { code: "agent_required", detail: "需要先有室友才能使用菜園" } } } };
      if (mode === "unavailable") throw { response: { status: 503 } };
      return structuredClone(data);
    },
    async inventory(owner, offset, signal) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (offset && mode === "fractions") return { ...inventory[owner], items: [{ crop_id: "carrot", crop_name: "胡蘿蔔", quantity_g: "3000" }], has_more: false, next_offset: null };
      return structuredClone(inventory[owner]);
    },
    async progress() { return structuredClone(mode === "harvested" ? fixtures.progress : fixtures.progressBefore); },
    async act(commands) {
      writes.push(structuredClone([...commands]));
      const results = commands.map(c => {
        const cached = cache.get(c.request_id);
        if (cached) return cached.command === JSON.stringify(c) ? structuredClone(cached.receipt) : { ok: false, error: { code: "idempotency_conflict", detail: "隔離示範：操作識別碼內容不同。", status_code: 409 } };
        const plot = data.plots.find(p => p.id === c.plot_id)!;
        const intent = c.action === "steal" ? { plotId: c.plot_id, action: c.action, batchId: c.batch_id } : c.action === "propose_clear" ? { plotId: c.plot_id, action: c.action, reason: c.reason, consent: true } : c.action === "consent_clear" ? { plotId: c.plot_id, action: c.action, proposalId: c.proposal_id, accept: c.accept } : c.action === "revoke_clear" ? { plotId: c.plot_id, action: c.action, proposalId: c.proposal_id } : { plotId: c.plot_id, action: c.action };
        const valid = privateCommand(data, intent, c.request_id);
        if (mode === "stale" || !valid || valid.planting_id !== c.planting_id) return { ok: false, error: { code: "stale_planting", detail: "隔離示範：這一株已更換，請更新田地。", status_code: 409 } };
        let credited: string | undefined, cleared = false;
        if (c.action === "water") { plot.planting!.moisture = Math.max(plot.planting!.moisture, 80); plot.planting!.needs = plot.planting!.needs.filter(n => n !== "water"); }
        if (c.action === "steal") {
          const b = plot.planting!.batches[c.batch_id]; credited = String(b.yield_g / 2);
          b.remaining_g -= Number(credited); b.stolen = true; b.steal_available = false;
          plot.steal_available = Object.values(plot.planting!.batches).some(b => b.steal_available);
          inventory.user.items = [{ crop_id: plot.planting!.crop_id, crop_name: plot.crop_name!, quantity_g: credited }];
        }
        if (c.action === "propose_clear") {
          plot.planting!.clear_proposal = { id: "isolated-ui-proposal", planting_id: c.planting_id, reason: c.reason, proposed_by: `user:${userId}`, approved_by: [`user:${userId}`], created_at: data.server_now };
          plot.allowed_actions = ["water", "revoke_clear"];
        }
        if (c.action === "revoke_clear" || (c.action === "consent_clear" && !c.accept)) { plot.planting!.clear_proposal = null; plot.allowed_actions = ["water", "propose_clear"]; }
        if (c.action === "consent_clear" && c.accept) { data = structuredClone(fixtures.cleared) as unknown as PrivateGarden; cleared = true; }
        const receipt = { ok: true, result: { plot: structuredClone(data.plots.find(p => p.id === c.plot_id)), server_now: data.server_now, ...(credited ? { credited_g: credited } : {}), cleared } };
        cache.set(c.request_id, { command: JSON.stringify(c), receipt }); return receipt;
      });
      if (failOnce) { failOnce = false; throw Error("Isolated lost response after commit"); }
      return { results };
    },
  };
  return { gateway, userId, writes };
}
