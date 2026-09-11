import type { PetGateway, PetList, PetStatus } from "../../src/api/pets";
import { parsePetAssets, type PetWish, type WishArrival, type WishResult, type WishSubmission } from "../../src/api/pet-wishes";
import releasedCatalog from "../../public/assets/pets/catalog.json";

// Preview-only: production always reads /api/pet-assets, never this local release manifest.
export function createPetPreview(mode = "ready", options: { catalog?: typeof releasedCatalog; delayMs?: number } = {}): PetGateway {
  const catalog = options.catalog ?? releasedCatalog;
  const assets = parsePetAssets({ catalog_version: catalog.catalog_version, items: catalog.assets.filter(a => a.published === true) });
  const pet: PetStatus = { id: "preview-cat", name: "小麥", species: "貓", emoji: "🐈", hunger: 63, cleanliness: 82, happiness: 76, health: 73.7, is_alive: true, age_days: 12, asset_key: assets.find(a => a.asset_key === "cat-v1")?.asset_key ?? null };
  const list: PetList = { pets: ["empty", "locked"].includes(mode) ? [] : [pet], max_pets: mode === "locked" ? 0 : 2 };
  if (mode === "full") list.pets.push({ ...pet, id: "preview-dog", name: "豆豆", species: "狗", emoji: "🐕", asset_key: assets.find(a => a.asset_key === "dog-v1")?.asset_key ?? null });
  if (mode === "inactive") pet.is_alive = false;
  let sequence = 0, unknown = mode === "unknown", wishUnknown = mode === "wish-unknown";
  const wishes: PetWish[] = [], receipts = new Map<string, { body: WishSubmission | WishArrival; result: WishResult }>();
  const arrivals = new Map<string, { expected_version: number; result: WishResult }>();
  const capacity = () => { const active = list.pets.filter(p => p.is_alive).length, reserved = wishes.filter(w => w.status !== "arrived").length, available = Math.max(0, list.max_pets - active - reserved);
    return { max_pets: list.max_pets, active_pets: active, reserved_pets: reserved, occupied_pets: active + reserved, available_slots: available, can_adopt: available > 0, can_wish: available > 0 }; };
  if (["waiting", "admin"].includes(mode)) wishes.push({ id: "preview-wish", user_id: "local-pet-preview", agent_id: "preview-agent", requested_name: "小星", requested_species: "雪貂", appearance_description: "奶油白色，尾巴尖有一小塊灰色。", status: "pending", version: 1, created_at: "2026-09-12T00:00:00Z", updated_at: "2026-09-12T00:00:00Z", pet_id: null, arrived_at: null, asset_key: null, fulfillment_issue: null, preparation_note: "" });
  if (mode === "admin") Object.assign(wishes[0], { requested_species: "貓", appearance_description: "灰虎斑，圓圓的眼睛，尾巴翹起。" });
  const error = (status: number, detail: string) => ({ isAxiosError: true, response: { status, data: { detail } } });
  const domainError = (code: string) => ({ response: { status: 409, data: { detail: { code } } } });
  const latency = () => new Promise(resolve => setTimeout(resolve, options.delayMs ?? 650));
  const freshPet = (name: string, species: string, emoji: string, asset_key: string): PetStatus => ({ id: `preview-adopt-${++sequence}`, name, species, emoji, asset_key, hunger: 100, cleanliness: 100, happiness: 100, health: 100, is_alive: true, age_days: 0 });
  const currentResult = (result: WishResult) => structuredClone({ ...result, wish: wishes.find(w => w.id === result.wish.id)!, capacity: capacity() });
  return {
    async list(signal) { await latency(); if (signal.aborted) throw Error("Aborted"); if (mode === "error") throw error(503, "本地範例：暫時無法取得寵物資料。"); return structuredClone({ ...list, capacity: capacity() }); },
    wishes: {
      async list(admin, offset, status, signal, userId) { await latency(); if (signal.aborted) throw Error("Aborted"); const items = wishes.filter(w => (admin || w.user_id === userId) && (!status || w.status === status)); return structuredClone({ items: items.slice(offset, offset + 50), has_more: items.length > offset + 50, next_offset: items.length > offset + 50 ? offset + 50 : null, ...(admin ? {} : { capacity: capacity() }) }); },
      async assets() { return { items: structuredClone(assets), catalog_version: catalog.catalog_version }; },
      async detail(admin, id, signal, userId) { await latency(); if (signal.aborted) throw Error("Aborted"); const wish = wishes.find(w => w.id === id && (admin || w.user_id === userId)); if (!wish) throw error(404, "找不到這份願望"); return structuredClone({ wish, capacity: capacity() }); },
      async create(body, userId) {
        await latency(); const old = receipts.get(`${userId}:create:${body.client_request_id}`);
        if (old) { if (JSON.stringify(old.body) !== JSON.stringify(body)) throw { response: { status: 409, data: { detail: { code: "idempotency_conflict" } } } }; return structuredClone({ ...old.result, wish: wishes.find(w => w.id === old.result.wish.id), capacity: capacity() }); }
        if (!capacity().can_wish) throw { response: { status: 409, data: { detail: { code: "pet_capacity_unavailable" } } } };
        const now = new Date().toISOString(), wish: PetWish = { id: `preview-wish-${++sequence}`, user_id: userId, agent_id: "preview-agent", requested_name: body.requested_name, requested_species: body.requested_species, appearance_description: body.appearance_description, status: "pending", version: 1, created_at: now, updated_at: now, pet_id: null, arrived_at: null, asset_key: null, fulfillment_issue: null };
        wishes.push(wish); const result: WishResult = { wish, capacity: capacity(), receipt: { operation: "create", client_request_id: body.client_request_id, wish_id: wish.id, pet_id: null, accepted_at: now } }; receipts.set(`${userId}:create:${body.client_request_id}`, { body: structuredClone(body), result: structuredClone(result) });
        if (wishUnknown) { wishUnknown = false; throw Error("Local lost wish response"); } return structuredClone(result);
      },
      async lookup(id, userId) { await latency(); const found = receipts.get(`${userId}:create:${id}`); if (!found) throw error(404, "本地收據不存在；重新整理會重設這個範例。"); return currentResult(found.result); },
      async prepare(id, body) { await latency(); const wish = wishes.find(w => w.id === id); if (!wish || wish.status === "arrived" || wish.version !== body.expected_version) throw domainError("version_conflict"); if (body.asset_key !== null && !assets.some(a => a.asset_key === body.asset_key)) throw domainError("asset_unavailable"); Object.assign(wish, { status: "preparing", version: wish.version + 1, asset_key: body.asset_key, preparation_note: body.preparation_note, updated_at: new Date().toISOString() }); return structuredClone({ wish, capacity: capacity() }); },
      async arrive(id, body, userId) {
        await latency(); const wish = wishes.find(w => w.id === id); if (!wish) throw error(404, "找不到這份願望");
        const key = `${userId}:arrive:${body.client_request_id}`, old = receipts.get(key);
        if (old) { if (old.result.receipt.operation !== "arrive" || old.result.wish.id !== id || JSON.stringify(old.body) !== JSON.stringify(body)) throw domainError("idempotency_conflict"); return currentResult(old.result); }
        const done = arrivals.get(id);
        if (done) {
          if (done.expected_version !== body.expected_version) throw domainError("idempotency_conflict");
          const result = currentResult(done.result); result.receipt.client_request_id = body.client_request_id;
          receipts.set(key, { body: structuredClone(body), result: structuredClone(result) }); return result;
        }
        if (wish.version !== body.expected_version) throw domainError("version_conflict");
        if (wish.status !== "preparing") throw domainError("invalid_transition");
        const asset = assets.find(a => a.asset_key === wish.asset_key); if (!asset) throw domainError("asset_unavailable");
        const now = new Date().toISOString(), fresh = freshPet(wish.requested_name, wish.requested_species, asset.emoji, asset.asset_key);
        // Convert this reservation; do not require a second free slot or create another pet on replay.
        list.pets.push(fresh); Object.assign(wish, { status: "arrived", version: wish.version + 1, pet_id: fresh.id, arrived_at: now, updated_at: now });
        const result: WishResult = { wish: structuredClone(wish), capacity: capacity(), receipt: { operation: "arrive", client_request_id: body.client_request_id, wish_id: id, pet_id: fresh.id, accepted_at: now } };
        receipts.set(key, { body: structuredClone(body), result: structuredClone(result) }); arrivals.set(id, { expected_version: body.expected_version, result: structuredClone(result) });
        return result;
      },
    },
    async interact(id, action) {
      await latency(); const target = list.pets.find(p => p.id === id && p.is_alive); if (!target) throw error(404, "找不到這隻寵物");
      if (action === "feed") target.hunger = Math.min(100, target.hunger + 40);
      if (action === "clean") target.cleanliness = Math.min(100, target.cleanliness + 40);
      if (action === "play") target.happiness = Math.min(100, target.happiness + 30);
      if (action === "walk") target.happiness = Math.min(100, target.happiness + 20);
      target.health = (target.hunger + target.cleanliness + target.happiness) / 3;
      if (unknown) { unknown = false; throw Error("Local lost response"); }
      return structuredClone(target);
    },
    async adopt(body) {
      await latency(); if (!capacity().can_adopt) throw domainError("pet_capacity_unavailable");
      const matches = assets.filter(a => "asset_key" in body ? a.asset_key === body.asset_key : a.species === body.species && a.emoji === body.emoji);
      if (matches.length !== 1) throw domainError("asset_unavailable");
      const asset = matches[0], fresh = freshPet(body.name, asset.species, asset.emoji, asset.asset_key);
      list.pets.push(fresh); if (unknown) { unknown = false; throw Error("Local lost response"); } return structuredClone(fresh);
    },
  };
}
