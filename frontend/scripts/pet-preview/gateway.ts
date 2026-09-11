import type { PetGateway, PetList, PetStatus } from "../../src/api/pets";
import type { PetAsset, PetWish, WishResult, WishSubmission } from "../../src/api/pet-wishes";

export function createPetPreview(mode = "ready"): PetGateway {
  const pet: PetStatus = { id: "preview-cat", name: "小麥", species: "貓", emoji: "🐈", hunger: 63, cleanliness: 82, happiness: 76, health: 73.7, is_alive: true, age_days: 12 };
  const list: PetList = { pets: ["empty", "locked"].includes(mode) ? [] : [pet], max_pets: mode === "locked" ? 0 : 2 };
  if (mode === "full") list.pets.push({ ...pet, id: "preview-dog", name: "豆豆", species: "狗", emoji: "🐕" });
  if (mode === "inactive") pet.is_alive = false;
  let sequence = 0, unknown = mode === "unknown", wishUnknown = mode === "wish-unknown";
  const wishes: PetWish[] = [], receipts = new Map<string, { body: WishSubmission; result: WishResult }>();
  // Empty, like the actual unpublished registry. No unapproved pet art is registered here.
  const assets: PetAsset[] = [];
  const capacity = () => { const active = list.pets.filter(p => p.is_alive).length, reserved = wishes.filter(w => w.status !== "arrived").length, available = Math.max(0, list.max_pets - active - reserved);
    return { max_pets: list.max_pets, active_pets: active, reserved_pets: reserved, occupied_pets: active + reserved, available_slots: available, can_adopt: available > 0, can_wish: available > 0 }; };
  if (["waiting", "admin"].includes(mode)) wishes.push({ id: "preview-wish", user_id: "local-pet-preview", agent_id: "preview-agent", requested_name: "小星", requested_species: "雪貂", appearance_description: "奶油白色，尾巴尖有一小塊灰色。", status: "pending", version: 1, created_at: "2026-09-12T00:00:00Z", updated_at: "2026-09-12T00:00:00Z", pet_id: null, arrived_at: null, asset_key: null, fulfillment_issue: null, preparation_note: "" });
  const error = (status: number, detail: string) => ({ isAxiosError: true, response: { status, data: { detail } } });
  const latency = () => new Promise(resolve => setTimeout(resolve, 650));
  return {
    async list(signal) { await latency(); if (signal.aborted) throw Error("Aborted"); if (mode === "error") throw error(503, "本地範例：暫時無法取得寵物資料。"); return structuredClone({ ...list, capacity: capacity() }); },
    wishes: {
      async list(admin, offset, status, signal, userId) { await latency(); if (signal.aborted) throw Error("Aborted"); const items = wishes.filter(w => (admin || w.user_id === userId) && (!status || w.status === status)); return structuredClone({ items: items.slice(offset, offset + 50), has_more: items.length > offset + 50, next_offset: items.length > offset + 50 ? offset + 50 : null, ...(admin ? {} : { capacity: capacity() }) }); },
      async assets() { return { items: structuredClone(assets), catalog_version: "preview-empty" }; },
      async detail(admin, id, signal, userId) { await latency(); if (signal.aborted) throw Error("Aborted"); const wish = wishes.find(w => w.id === id && (admin || w.user_id === userId)); if (!wish) throw error(404, "找不到這份願望"); return structuredClone({ wish, capacity: capacity() }); },
      async create(body, userId) {
        await latency(); const old = receipts.get(`${userId}:${body.client_request_id}`);
        if (old) { if (JSON.stringify(old.body) !== JSON.stringify(body)) throw { response: { status: 409, data: { detail: { code: "idempotency_conflict" } } } }; return structuredClone({ ...old.result, wish: wishes.find(w => w.id === old.result.wish.id), capacity: capacity() }); }
        if (!capacity().can_wish) throw { response: { status: 409, data: { detail: { code: "pet_capacity_unavailable" } } } };
        const now = new Date().toISOString(), wish: PetWish = { id: `preview-wish-${++sequence}`, user_id: userId, agent_id: "preview-agent", requested_name: body.requested_name, requested_species: body.requested_species, appearance_description: body.appearance_description, status: "pending", version: 1, created_at: now, updated_at: now, pet_id: null, arrived_at: null, asset_key: null, fulfillment_issue: null };
        wishes.push(wish); const result: WishResult = { wish, capacity: capacity(), receipt: { operation: "create", client_request_id: body.client_request_id, wish_id: wish.id, pet_id: null, accepted_at: now } }; receipts.set(`${userId}:${body.client_request_id}`, { body: structuredClone(body), result: structuredClone(result) });
        if (wishUnknown) { wishUnknown = false; throw Error("Local lost wish response"); } return structuredClone(result);
      },
      async lookup(id, userId) { await latency(); const found = receipts.get(`${userId}:${id}`); if (!found) throw error(404, "本地收據不存在；重新整理會重設這個範例。"); return structuredClone({ ...found.result, wish: wishes.find(w => w.id === found.result.wish.id), capacity: capacity() }); },
      async prepare(id, body) { await latency(); const wish = wishes.find(w => w.id === id); if (!wish || wish.status === "arrived" || wish.version !== body.expected_version) throw error(409, "版本已變更"); if (body.asset_key !== null) throw error(409, "本地預覽沒有已發布圖庫"); Object.assign(wish, { status: "preparing", version: wish.version + 1, asset_key: null, preparation_note: body.preparation_note, updated_at: new Date().toISOString() }); return structuredClone({ wish, capacity: capacity() }); },
      async arrive() { throw error(409, "尚無已交付的圖資，不能確認到家。"); },
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
      await latency(); if (!capacity().can_adopt) throw error(400, "目前沒有空出的領養名額。");
      if ("asset_key" in body) throw error(409, "本地預覽沒有已發布圖庫，請使用許願入口。");
      const fresh = { ...pet, ...body, id: `preview-adopt-${++sequence}`, hunger: 100, cleanliness: 100, happiness: 100, health: 100, is_alive: true, age_days: 0 };
      list.pets.push(fresh); if (unknown) { unknown = false; throw Error("Local lost response"); } return structuredClone(fresh);
    },
  };
}
