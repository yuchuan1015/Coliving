import api from "./client";
import { parsePetCapacity, type PetCapacity } from "./pets";
import type { PetWishDraft } from "./pet-wish-draft";

export type WishStatus = "pending" | "preparing" | "arrived";
export type PetWish = PetWishDraft & { id: string; user_id: string; agent_id: string; status: WishStatus; version: number;
  created_at: string; updated_at: string; pet_id: string | null; arrived_at: string | null; asset_key: string | null; fulfillment_issue: string | null; preparation_note?: string };
export type PetAsset = { asset_key: string; species: string; emoji: string; image_url: string };
export type WishSubmission = PetWishDraft & { client_request_id: string };
export type WishArrival = { client_request_id: string; expected_version: number };
export type WishPreparation = { expected_version: number; asset_key: string | null; preparation_note: string };
export type PendingWishOperation = { kind: "create"; body: WishSubmission } | { kind: "arrive"; wish_id: string; body: WishArrival };
export type WishReceipt = { operation: "create" | "arrive"; client_request_id: string; wish_id: string; pet_id: string | null; accepted_at: string };
export type WishDetail = { wish: PetWish; capacity: PetCapacity };
export type WishResult = WishDetail & { receipt: WishReceipt };
export type WishList = { items: PetWish[]; has_more: boolean; next_offset: number | null; capacity?: PetCapacity };
export interface PetWishGateway {
  list: (admin: boolean, offset: number, status: WishStatus | "", signal: AbortSignal, userId: string) => Promise<unknown>;
  detail: (admin: boolean, id: string, signal: AbortSignal, userId: string) => Promise<unknown>;
  assets: (signal: AbortSignal, userId: string) => Promise<unknown>;
  create: (body: WishSubmission, userId: string) => Promise<unknown>;
  lookup: (requestId: string, userId: string) => Promise<unknown>;
  prepare: (id: string, body: WishPreparation, userId: string) => Promise<unknown>;
  arrive: (id: string, body: WishArrival, userId: string) => Promise<unknown>;
}
const forUser = (userId: string) => ({ _expectedUserId: userId, timeout: 15000 });
const path = (admin: boolean) => admin ? "/admin/pet-wishes" : "/pet-wishes";
export const petWishApi: PetWishGateway = {
  async list(admin, offset, status, signal, userId) { return (await api.get(path(admin), { ...forUser(userId), signal, params: { limit: 50, offset, ...(status ? { status } : {}) } })).data; },
  async detail(admin, id, signal, userId) { return (await api.get(`${path(admin)}/${encodeURIComponent(id)}`, { ...forUser(userId), signal })).data; },
  async assets(signal, userId) { return (await api.get("/pet-assets", { ...forUser(userId), signal })).data; },
  async create(body, userId) { return (await api.post("/pet-wishes", body, forUser(userId))).data; },
  async lookup(id, userId) { return (await api.get(`/pet-wishes/by-request/${encodeURIComponent(id)}`, forUser(userId))).data; },
  async prepare(id, body, userId) { return (await api.patch(`/admin/pet-wishes/${encodeURIComponent(id)}/preparation`, body, forUser(userId))).data; },
  async arrive(id, body, userId) { return (await api.post(`/admin/pet-wishes/${encodeURIComponent(id)}/arrive`, body, forUser(userId))).data; },
};
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && !!v.trim();
const date = (v: unknown): v is string => str(v) && Number.isFinite(Date.parse(v));
export const validAssetKey = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
export const validRequestId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export function validPendingWish(value: unknown): value is PendingWishOperation {
  if (!obj(value) || !obj(value.body) || !validRequestId(value.body.client_request_id)) return false;
  const b = value.body;
  const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
  if (value.kind === "create" ? !exact(value, ["kind", "body"]) || !exact(b, ["client_request_id", "requested_name", "requested_species", "appearance_description"]) : !exact(value, ["kind", "body", "wish_id"]) || !exact(b, ["client_request_id", "expected_version"])) return false;
  return value.kind === "create" ? [b.requested_name, b.requested_species].every(v => str(v) && [...v].length <= 64) && str(b.appearance_description) && [...b.appearance_description].length <= 2000 :
    value.kind === "arrive" && str(value.wish_id) && Number.isSafeInteger(b.expected_version) && Number(b.expected_version) > 0;
}
export function parseWish(value: unknown, userId?: string): PetWish {
  if (!obj(value) || ![value.id, value.user_id, value.agent_id, value.requested_name, value.requested_species, value.appearance_description].every(str) ||
    (userId && value.user_id !== userId) || !["pending", "preparing", "arrived"].includes(String(value.status)) || !Number.isSafeInteger(value.version) || Number(value.version) < 1 ||
    !date(value.created_at) || !date(value.updated_at) || !(value.pet_id === null || str(value.pet_id)) || !(value.arrived_at === null || date(value.arrived_at)) ||
    !(value.asset_key === null || validAssetKey(value.asset_key)) || !(value.fulfillment_issue === null || typeof value.fulfillment_issue === "string") ||
    (value.preparation_note !== undefined && typeof value.preparation_note !== "string")) throw Error("Invalid wish");
  if (value.status === "arrived" ? (!value.pet_id || !value.arrived_at || !value.asset_key) : (value.pet_id !== null || value.arrived_at !== null)) throw Error("Invalid wish arrival");
  const w = value as unknown as PetWish;
  return { id: w.id, user_id: w.user_id, agent_id: w.agent_id, requested_name: w.requested_name, requested_species: w.requested_species, appearance_description: w.appearance_description,
    status: w.status, version: w.version, created_at: w.created_at, updated_at: w.updated_at, pet_id: w.pet_id, arrived_at: w.arrived_at, asset_key: w.asset_key, fulfillment_issue: w.fulfillment_issue,
    ...(userId || w.preparation_note === undefined ? {} : { preparation_note: w.preparation_note }) };
}
export function parseWishDetail(value: unknown, userId?: string, id?: string): WishDetail {
  if (!obj(value)) throw Error("Invalid wish detail");
  const wish = parseWish(value.wish, userId); if (id && wish.id !== id) throw Error("Wish ID changed");
  return { wish, capacity: parsePetCapacity(value.capacity) };
}
export function parseWishList(value: unknown, userId?: string, offset = 0): WishList {
  if (!obj(value) || !Array.isArray(value.items) || typeof value.has_more !== "boolean" ||
    (value.has_more ? !Number.isSafeInteger(value.next_offset) || Number(value.next_offset) <= offset : value.next_offset !== null)) throw Error("Invalid wish list");
  const items = value.items.map(v => parseWish(v, userId));
  if (new Set(items.map(w => w.id)).size !== items.length) throw Error("Duplicate wishes");
  return { items, has_more: value.has_more, next_offset: value.next_offset as number | null,
    ...(userId || value.capacity !== undefined ? { capacity: parsePetCapacity(value.capacity) } : {}) };
}
export function parseWishResult(value: unknown, pending: PendingWishOperation, userId: string): WishResult {
  const detail = parseWishDetail(value, pending.kind === "create" ? userId : undefined, pending.kind === "arrive" ? pending.wish_id : undefined);
  if (!obj(value) || !obj(value.receipt)) throw Error("Missing wish receipt");
  const r = value.receipt;
  if (r.operation !== pending.kind || r.client_request_id !== pending.body.client_request_id || r.wish_id !== detail.wish.id || !date(r.accepted_at) ||
    (pending.kind === "arrive" ? !str(r.pet_id) || r.pet_id !== detail.wish.pet_id || detail.wish.status !== "arrived" : r.pet_id !== null)) throw Error("Invalid wish receipt");
  if (pending.kind === "create" && ["requested_name", "requested_species", "appearance_description"].some(k => detail.wish[k as keyof PetWishDraft] !== pending.body[k as keyof PetWishDraft])) throw Error("Wish payload mismatch");
  return { ...detail, receipt: { operation: pending.kind, client_request_id: r.client_request_id as string, wish_id: r.wish_id as string, pet_id: r.pet_id as string | null, accepted_at: r.accepted_at } };
}
export function parsePetAssets(value: unknown): PetAsset[] {
  if (!obj(value) || !Array.isArray(value.items) || !str(value.catalog_version)) throw Error("Invalid pet catalog");
  const items = value.items.map(v => {
    if (!obj(v) || !validAssetKey(v.asset_key) || !str(v.species) || !str(v.emoji) || typeof v.image_url !== "string" ||
      !/^\/assets\/pets\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|webp|avif)$/.test(v.image_url) || v.image_url.includes("..")) throw Error("Untrusted pet asset");
    return { asset_key: v.asset_key, species: v.species, emoji: v.emoji, image_url: v.image_url };
  });
  if (new Set(items.map(v => v.asset_key)).size !== items.length) throw Error("Duplicate pet asset");
  return items;
}
export function wishError(error: unknown) {
  if (!obj(error)) return { status: 0, code: "", message: "" };
  const r = obj(error.response) ? error.response : {}, d = obj(r.data) ? r.data.detail : undefined;
  return { status: typeof r.status === "number" ? r.status : 0, code: obj(d) && typeof d.code === "string" ? d.code : "", message: typeof d === "string" ? d : obj(d) && typeof d.message === "string" ? d.message : "" };
}
