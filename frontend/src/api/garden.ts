import api from "./client";

export type GardenAction = "water" | "care" | "vote";
export interface GardenCrop { id: string; name: string }
export interface GardenPlanting {
  planting_id: string; crop_id: string; status: string;
  health: number; moisture: number; nutrients: number; needs: string[];
  random_problem: { label: string } | null;
}
export interface GardenVote {
  id: string; status: string; closes_at: string; candidates: string[];
  counts: Record<string, number>; my_vote: { crop_id: string } | null;
}
export interface PublicPlot {
  id: string; scope: "public"; number: number; planting: GardenPlanting | null;
  crop_name: string | null; vote: GardenVote | null; allowed_actions: string[];
  contributors: { kind: string; id: string; household_id: string }[];
  care_logs: { id: number; kind: string; actor_key: string | null; created_at: string; detail?: { message?: string } }[];
}
export interface PublicGarden {
  server_now: string; garden_time: string; garden_month: number;
  actor: { kind: "user"; id: string; household_id: string };
  plots: PublicPlot[]; crops: GardenCrop[];
  public_area: { gross_m2: number; productive_m2: number };
}
export type GardenCommand = { plot_id: string; request_id: string } & (
  { action: "water" | "care"; planting_id: string } |
  { action: "vote"; vote_id: string; crop_id: string }
);
export interface GardenGateway {
  read(signal: AbortSignal): Promise<unknown>;
  act(command: GardenCommand): Promise<unknown>;
}
export const publicGardenApi: GardenGateway = {
  async read(signal) { return (await api.get("/garden/public", { signal })).data; },
  async act(command) { return (await api.post("/garden/actions", { actions: [command] })).data; },
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const score = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

// Fail closed on identity, scope or malformed action data. Never adapt a private
// plot into a public one, or infer permissions from a decorative phase label.
export function parsePublicGarden(value: unknown, owner: string): PublicGarden {
  if (!record(value) || !date(value.server_now) || !date(value.garden_time)
    || !record(value.actor) || value.actor.kind !== "user" || value.actor.id !== owner
    || !Array.isArray(value.plots) || !Array.isArray(value.crops)
    || !record(value.public_area) || typeof value.public_area.gross_m2 !== "number"
    || typeof value.public_area.productive_m2 !== "number"
    || !value.crops.every(crop => record(crop) && id(crop.id) && id(crop.name))) throw new Error("Invalid public garden response");
  for (const plot of value.plots) {
    if (!record(plot) || plot.scope !== "public" || !id(plot.id) || !strings(plot.allowed_actions)
      || !Array.isArray(plot.contributors) || !Array.isArray(plot.care_logs)
      || !plot.contributors.every(person => record(person) && id(person.id) && id(person.kind))
      || !plot.care_logs.every(log => record(log) && id(log.kind) && date(log.created_at))) throw new Error("Invalid public plot");
    if (plot.planting !== null) {
      const p = plot.planting;
      if (!record(p) || !id(p.planting_id) || !id(p.crop_id) || !id(p.status)
        || !score(p.health) || !score(p.moisture) || !score(p.nutrients) || !strings(p.needs)
        || !(p.random_problem === null || (record(p.random_problem) && id(p.random_problem.label)))) throw new Error("Invalid planting");
    }
    if (plot.vote !== null) {
      const v = plot.vote;
      if (!record(v) || !id(v.id) || !id(v.status) || !date(v.closes_at) || !strings(v.candidates) || !record(v.counts)
        || !Object.values(v.counts).every(count => typeof count === "number" && Number.isInteger(count) && count >= 0)
        || !(v.my_vote === null || (record(v.my_vote) && id(v.my_vote.crop_id)))) throw new Error("Invalid vote");
    }
  }
  return value as unknown as PublicGarden;
}

export function canGardenAct(plot: PublicPlot, action: GardenAction, now: number): boolean {
  if (!["water", "care", "vote"].includes(action) || !plot.allowed_actions.includes(action)) return false;
  if (action === "vote") return !!plot.vote && plot.vote.status === "open" && !plot.vote.my_vote && Date.parse(plot.vote.closes_at) > now;
  return !!plot.planting && ["growing", "regrowing", "harvest_ready"].includes(plot.planting.status);
}

export function gardenCommand(plot: PublicPlot, action: GardenAction, requestId: string, now: number, cropId?: string): GardenCommand | null {
  if (!canGardenAct(plot, action, now)) return null;
  if (action === "vote") return plot.vote!.candidates.includes(cropId ?? "")
    ? { plot_id: plot.id, action, vote_id: plot.vote!.id, crop_id: cropId!, request_id: requestId } : null;
  return { plot_id: plot.id, action, planting_id: plot.planting!.planting_id, request_id: requestId };
}

export type GardenReceipt = { ok: true } | { ok: false; detail: string; status: number };
export function parseGardenReceipt(value: unknown): GardenReceipt {
  if (!record(value) || !Array.isArray(value.results) || value.results.length !== 1 || !record(value.results[0])) throw new Error("Uncertain garden result");
  const result = value.results[0];
  if (result.ok === true && record(result.result) && record(result.result.plot) && date(result.result.server_now)) return { ok: true };
  if (result.ok === false && record(result.error) && typeof result.error.detail === "string"
    && typeof result.error.status_code === "number") return { ok: false, detail: result.error.detail, status: result.error.status_code };
  throw new Error("Uncertain garden result");
}

export function gardenHttpError(error: unknown): { status: number; detail?: string } {
  if (!record(error) || !record(error.response)) return { status: 0 };
  const response = error.response;
  return { status: typeof response.status === "number" ? response.status : 0,
    detail: record(response.data) && typeof response.data.detail === "string" ? response.data.detail : undefined };
}
