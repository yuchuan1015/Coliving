import api from "./client";
import type { PetWishGateway } from "./pet-wishes";

export const PET_ACTIONS = { feed: "餵食", clean: "清潔", play: "陪玩", walk: "散步", rest: "休息" } as const;
export type PetAction = keyof typeof PET_ACTIONS;
export interface PetStatus {
  id: string; name: string; species: string; emoji: string;
  hunger: number; cleanliness: number; happiness: number; health: number;
  is_alive: boolean; age_days?: number; asset_key?: string | null;
}
export interface PetCapacity { max_pets: number; active_pets: number; reserved_pets: number; occupied_pets: number; available_slots: number; can_adopt: boolean; can_wish: boolean }
export interface PetList { pets: PetStatus[]; max_pets: number; capacity?: PetCapacity }
export type PetAdoption = { name: string; asset_key: string } | { name: string; species: string; emoji: string };
export interface PetGateway {
  wishes?: PetWishGateway;
  list: (signal: AbortSignal, userId: string) => Promise<unknown>;
  adopt: (body: PetAdoption, userId: string) => Promise<unknown>;
  interact: (id: string, action: PetAction, userId: string) => Promise<unknown>;
}
const forUser = (userId: string) => ({ _expectedUserId: userId, timeout: 15000 });
export const petApi: PetGateway = {
  async list(signal, userId) { return (await api.get("/pets", { ...forUser(userId), signal })).data; },
  async adopt(body, userId) { return (await api.post("/pets/adopt", body, forUser(userId))).data; },
  async interact(id, action, userId) { return (await api.post(`/pets/${encodeURIComponent(id)}/interact`, null, { ...forUser(userId), params: { action } })).data; },
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const stat = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
export function parsePetCapacity(value: unknown): PetCapacity {
  if (!object(value) || ![value.max_pets, value.active_pets, value.reserved_pets, value.occupied_pets, value.available_slots].every(v => Number.isSafeInteger(v) && Number(v) >= 0) ||
    typeof value.can_adopt !== "boolean" || typeof value.can_wish !== "boolean") throw Error("Invalid pet capacity");
  const c = value as unknown as PetCapacity;
  if (c.occupied_pets !== c.active_pets + c.reserved_pets || c.available_slots !== Math.max(0, c.max_pets - c.occupied_pets) ||
    (c.available_slots === 0 && (c.can_adopt || c.can_wish))) throw Error("Inconsistent pet capacity");
  return { max_pets: c.max_pets, active_pets: c.active_pets, reserved_pets: c.reserved_pets, occupied_pets: c.occupied_pets, available_slots: c.available_slots, can_adopt: c.can_adopt, can_wish: c.can_wish };
}
export function parsePet(value: unknown): PetStatus {
  if (!object(value) || ![value.id, value.name, value.species, value.emoji].every(text) ||
    ![value.hunger, value.cleanliness, value.happiness, value.health].every(stat) || typeof value.is_alive !== "boolean" ||
    (value.age_days !== undefined && (!Number.isSafeInteger(value.age_days) || Number(value.age_days) < 0)) ||
    (value.asset_key != null && !text(value.asset_key))) throw Error("Invalid pet status");
  return { id: value.id as string, name: value.name as string, species: value.species as string, emoji: value.emoji as string,
    hunger: value.hunger as number, cleanliness: value.cleanliness as number, happiness: value.happiness as number, health: value.health as number,
    is_alive: value.is_alive, ...(value.age_days === undefined ? {} : { age_days: value.age_days as number }), ...(value.asset_key === undefined ? {} : { asset_key: value.asset_key as string | null }) };
}
export function parsePets(value: unknown): PetList {
  if (!object(value) || !Array.isArray(value.pets) || !Number.isSafeInteger(value.max_pets) || Number(value.max_pets) < 0) throw Error("Invalid pet list");
  const pets = value.pets.map(parsePet);
  if (new Set(pets.map(p => p.id)).size !== pets.length) throw Error("Duplicate pet IDs");
  const capacity = value.capacity === undefined ? undefined : parsePetCapacity(value.capacity);
  if (capacity && capacity.max_pets !== value.max_pets) throw Error("Inconsistent total pet capacity");
  return { pets, max_pets: value.max_pets as number, ...(capacity ? { capacity } : {}) };
}
export const alivePetCount = (list: PetList) => list.pets.filter(p => p.is_alive).length;
export const validPetAction = (value: string): value is PetAction => Object.hasOwn(PET_ACTIONS, value);
export function validPetAdoption(body: PetAdoption): boolean {
  if (!text(body.name) || [...body.name].length > 64) return false;
  if ("asset_key" in body) return text(body.asset_key) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(body.asset_key);
  return text(body.species) && [...body.species].length <= 64 && text(body.emoji) && [...body.emoji].length <= 8;
}
