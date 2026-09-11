import api from "./client";
import type { GardenPlanting } from "./garden";

export type WarehouseOwner = "user" | "agent";
export type PrivateAction = "water" | "steal" | "propose_clear" | "consent_clear" | "revoke_clear";
export interface PrivateBatch {
  id: string; cycle_index: number; batch_index: number; status: string;
  remaining_g: number; yield_g: number; stolen: boolean; steal_available: boolean; matured_at: string;
}
export interface ClearProposal { id: string; planting_id: string; reason: string; proposed_by: string; approved_by: string[]; created_at: string }
export interface PrivatePlanting extends GardenPlanting {
  planted_at: string; batches: Record<string, PrivateBatch>; clear_proposal?: ClearProposal | null;
}
export interface PrivateCrop { id: string; name: string; tier: number; category: string; care: { note: string }; harvest: { mode: string }; timing: { first_harvest_days: number } }
export interface PrivatePlot {
  id: string; scope: "private"; number: number; planting: PrivatePlanting | null;
  crop_name: string | null; allowed_actions: string[]; steal_available: boolean; short_status: string;
  care_logs: { id: number; kind: string; actor_key: string | null; created_at: string }[];
}
export interface PrivateGarden {
  server_now: string; garden_time: string; garden_month: number; time_multiplier: number;
  actor: { kind: "user"; id: string; household_id: string }; plots: PrivatePlot[]; crops: PrivateCrop[];
}
export interface GardenInventory { owner: WarehouseOwner; owner_id: string; items: { crop_id: string; crop_name: string; quantity_g: string }[]; has_more: boolean; next_offset: number | null; unit: "g" }
export interface GardenProgress { completed_crop_ids: string[]; completed_count: number; required_count: number; unlocked_tier: number; available_tiers: number[] }
export type PrivateIntent = { plotId: string } & (
  { action: "water" } | { action: "steal"; batchId: string } |
  { action: "propose_clear"; reason: string; consent: boolean } |
  { action: "consent_clear"; proposalId: string; accept: boolean } |
  { action: "revoke_clear"; proposalId: string }
);
export type PrivateCommand = Readonly<{ plot_id: string; planting_id: string; request_id: string } & (
  { action: "water" } | { action: "steal"; batch_id: string } |
  { action: "propose_clear"; reason: string } |
  { action: "consent_clear"; proposal_id: string; accept: boolean } |
  { action: "revoke_clear"; proposal_id: string }
)>;
export interface PrivateGardenGateway {
  read(signal: AbortSignal): Promise<unknown>;
  inventory(owner: WarehouseOwner, offset: number, signal: AbortSignal): Promise<unknown>;
  progress(signal: AbortSignal): Promise<unknown>;
  act(commands: readonly PrivateCommand[]): Promise<unknown>;
}
export const privateGardenApi: PrivateGardenGateway = {
  async read(signal) { return (await api.get("/garden/private", { signal })).data; },
  async inventory(owner, offset, signal) { return (await api.get("/garden/inventory", { params: { owner, limit: 100, offset }, signal })).data; },
  async progress(signal) { return (await api.get("/garden/progress", { signal })).data; },
  async act(commands) { return (await api.post("/garden/actions", { actions: commands })).data; },
};

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const score = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
const states = ["growing", "regrowing", "harvest_ready", "production_complete", "dead"];
export function privateGardenHttpError(error: unknown): { status: number; detail?: string; code?: string } {
  if (!record(error) || !record(error.response)) return { status: 0 };
  const response = error.response, data = record(response.data) ? response.data : {};
  const nested = record(data.error) ? data.error : {};
  return { status: typeof response.status === "number" ? response.status : 0,
    code: typeof nested.code === "string" ? nested.code : undefined,
    detail: typeof nested.detail === "string" ? nested.detail : typeof data.detail === "string" ? data.detail : undefined };
}

export function parsePrivateGarden(value: unknown, owner: string): PrivateGarden {
  if (!record(value) || !date(value.server_now) || !date(value.garden_time) || !record(value.actor)
    || value.actor.kind !== "user" || value.actor.id !== owner || value.actor.household_id !== owner
    || !integer(value.time_multiplier) || value.time_multiplier < 1 || !integer(value.garden_month) || value.garden_month < 1 || value.garden_month > 12
    || !Array.isArray(value.plots) || value.plots.length !== 4 || !Array.isArray(value.crops) || value.crops.length !== 12
    || !value.crops.every(c => record(c) && id(c.id) && typeof c.name === "string" && c.tier === 1 && typeof c.category === "string" && record(c.care) && typeof c.care.note === "string" && record(c.harvest) && typeof c.harvest.mode === "string" && record(c.timing) && integer(c.timing.first_harvest_days))) throw Error("Invalid private garden");
  const plotIds = new Set(), numbers = new Set();
  for (const p of value.plots) {
    if (!record(p) || !id(p.id) || p.scope !== "private" || !integer(p.number) || p.number < 1 || p.number > 4 || plotIds.has(p.id) || numbers.has(p.number)
      || !strings(p.allowed_actions) || typeof p.steal_available !== "boolean" || typeof p.short_status !== "string"
      || !(p.crop_name === null || typeof p.crop_name === "string") || !Array.isArray(p.care_logs)
      || !p.care_logs.every(l => record(l) && integer(l.id) && typeof l.kind === "string" && (l.actor_key === null || typeof l.actor_key === "string") && date(l.created_at))) throw Error("Invalid private plot");
    plotIds.add(p.id); numbers.add(p.number);
    if (p.planting === null) continue;
    const plant = p.planting;
    if (!record(plant) || !id(plant.planting_id) || !id(plant.crop_id) || !states.includes(String(plant.status)) || !date(plant.planted_at)
      || !score(plant.health) || !score(plant.moisture) || !score(plant.nutrients) || !strings(plant.needs) || !record(plant.batches)
      || !(plant.random_problem === null || (record(plant.random_problem) && typeof plant.random_problem.label === "string"))) throw Error("Invalid private planting");
    for (const [key, batch] of Object.entries(plant.batches)) {
      if (!record(batch) || !id(batch.id) || key !== batch.id || !integer(batch.cycle_index) || !integer(batch.batch_index)
        || !["ready", "harvested", "failed", "lost"].includes(String(batch.status)) || !integer(batch.remaining_g) || !integer(batch.yield_g)
        || typeof batch.stolen !== "boolean" || typeof batch.steal_available !== "boolean" || !date(batch.matured_at)) throw Error("Invalid batch");
    }
    const proposal = plant.clear_proposal;
    if (proposal != null && (!record(proposal) || !id(proposal.id) || proposal.planting_id !== plant.planting_id || typeof proposal.reason !== "string"
      || typeof proposal.proposed_by !== "string" || !strings(proposal.approved_by) || !date(proposal.created_at))) throw Error("Invalid proposal");
  }
  return value as unknown as PrivateGarden;
}

export function quantityFraction(value: string): [bigint, bigint] | null {
  if (!/^\d{1,80}(\/\d{1,80})?$/.test(value)) return null;
  const [n, d = "1"] = value.split("/");
  return BigInt(d) > 0n ? [BigInt(n), BigInt(d)] : null;
}
// Exact fraction arithmetic until presentation. No parseFloat, ledger writes or
// assignment of rounding remainders; even tiny nonzero shares remain visible.
export function formatGardenQuantity(value: string): string {
  const fraction = quantityFraction(value);
  if (!fraction) return "—";
  const [n, d] = fraction, kg = n >= d * 1000n, divisor = kg ? d * 1000n : d;
  const rounded = (n * 1000n * 2n + divisor) / (2n * divisor), unit = kg ? "kg" : "g";
  if (n > 0n && rounded === 0n) return `< 0.001 ${unit}`;
  const decimal = String(rounded % 1000n).padStart(3, "0").replace(/0+$/, "");
  return `${rounded / 1000n}${decimal ? `.${decimal}` : ""} ${unit}`;
}
export function parseGardenInventory(value: unknown, who: WarehouseOwner, owner: string, offset: number): GardenInventory {
  if (!record(value) || value.owner !== who || !id(value.owner_id) || (who === "user" && value.owner_id !== owner) || value.unit !== "g"
    || !Array.isArray(value.items) || !value.items.every(i => record(i) && id(i.crop_id) && typeof i.crop_name === "string" && typeof i.quantity_g === "string" && quantityFraction(i.quantity_g))
    || typeof value.has_more !== "boolean" || (value.has_more ? !integer(value.next_offset) || value.next_offset <= offset : value.next_offset !== null)) throw Error("Invalid inventory");
  return value as unknown as GardenInventory;
}
export function parseGardenProgress(value: unknown): GardenProgress {
  if (!record(value) || !strings(value.completed_crop_ids) || new Set(value.completed_crop_ids).size !== value.completed_crop_ids.length
    || value.completed_count !== value.completed_crop_ids.length || value.required_count !== 12 || !integer(value.unlocked_tier) || value.unlocked_tier < 1
    || !Array.isArray(value.available_tiers) || !value.available_tiers.every(t => integer(t) && t >= 1)) throw Error("Invalid progress");
  return value as unknown as GardenProgress;
}
export function privateCommand(data: PrivateGarden, intent: PrivateIntent, requestId: string): PrivateCommand | null {
  const plot = data.plots.find(p => p.id === intent.plotId), plant = plot?.planting;
  if (!id(requestId) || !plot || !plant || !["water", "steal", "propose_clear", "consent_clear", "revoke_clear"].includes(intent.action) || !plot.allowed_actions.includes(intent.action)) return null;
  const base = { plot_id: plot.id, planting_id: plant.planting_id, request_id: requestId };
  const actor = `${data.actor.kind}:${data.actor.id}`, proposal = plant.clear_proposal;
  if (intent.action === "water") return plant.status !== "dead" ? Object.freeze({ ...base, action: "water" }) : null;
  if (intent.action === "steal") {
    const batch = plant.batches[intent.batchId];
    return plot.steal_available && !!batch?.steal_available && batch.status === "ready" && !batch.stolen && batch.remaining_g > 0
      ? Object.freeze({ ...base, action: "steal", batch_id: batch.id }) : null;
  }
  if (intent.action === "propose_clear") {
    const reason = intent.reason.trim();
    return intent.consent && !proposal && reason.length > 0 && [...reason].length <= 500
      ? Object.freeze({ ...base, action: "propose_clear", reason }) : null;
  }
  if (!proposal || proposal.id !== intent.proposalId || proposal.planting_id !== plant.planting_id) return null;
  if (intent.action === "revoke_clear") return proposal.proposed_by === actor ? Object.freeze({ ...base, action: "revoke_clear", proposal_id: proposal.id }) : null;
  return proposal.proposed_by !== actor && !proposal.approved_by.includes(actor)
    ? Object.freeze({ ...base, action: "consent_clear", proposal_id: proposal.id, accept: intent.accept }) : null;
}

export type PrivateReceipt = { ok: true; cleared: boolean; credited?: string } | { ok: false; detail: string; status: number; code: string } | { ok: null };
export function privateReceipts(value: unknown, commands: readonly PrivateCommand[]): PrivateReceipt[] {
  if (!record(value) || !Array.isArray(value.results) || value.results.length !== commands.length) return commands.map(() => ({ ok: null }));
  return value.results.map((r, i) => {
    if (!record(r)) return { ok: null };
    if (r.ok === true && record(r.result) && record(r.result.plot) && r.result.plot.id === commands[i].plot_id && r.result.plot.scope === "private" && date(r.result.server_now)
      && (r.result.credited_g === undefined || (typeof r.result.credited_g === "string" && quantityFraction(r.result.credited_g)))) return { ok: true, cleared: r.result.cleared === true, credited: r.result.credited_g as string | undefined };
    if (r.ok === false && record(r.error) && typeof r.error.detail === "string" && integer(r.error.status_code) && typeof r.error.code === "string") return { ok: false, detail: r.error.detail, status: r.error.status_code, code: r.error.code };
    return { ok: null };
  });
}
