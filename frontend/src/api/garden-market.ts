import api from "./client";
import type { ShellBalance } from "./economy";
import { formatGardenQuantity, type WarehouseOwner } from "./private-garden";

export interface MarketItem { crop_id: string; crop_name: string; quantity_g: string; can_sell: boolean; shells_exact?: string; shells_display?: string; unavailable_reason?: string }
export interface GardenMarket { owner: WarehouseOwner; owner_id: string; can_sell: boolean; wallet: ShellBalance; items: MarketItem[]; has_more: boolean; next_offset: number | null; unit: "g" }
export interface QuoteRequest { crop_id: string; quantity_g: string }
export interface SaleRequest extends QuoteRequest { quote_id: string; request_id: string }
export interface GardenQuote extends QuoteRequest { quote_id: string; owner: "user"; owner_id: string; crop_name: string; shells_exact: string; shells_display: string }
export interface GardenSale extends GardenQuote { request_id: string; remaining_g: string; sold_at: string }
export interface GardenMarketGateway {
  read(owner: WarehouseOwner, offset: number, signal: AbortSignal, userId: string): Promise<unknown>;
  quote(command: QuoteRequest, signal: AbortSignal, userId: string): Promise<unknown>;
  sell(command: Readonly<SaleRequest>, userId: string): Promise<unknown>;
}
const forUser = (userId: string) => ({ _expectedUserId: userId || "" });
export const gardenMarketApi: GardenMarketGateway = {
  async read(owner, offset, signal, userId) { return (await api.get("/garden/market", { ...forUser(userId), params: { owner, offset, limit: 100 }, signal, timeout: 15000 })).data; },
  async quote({ crop_id, quantity_g }, signal, userId) { return (await api.post("/garden/market/quote", { crop_id, quantity_g }, { ...forUser(userId), signal, timeout: 15000 })).data; },
  async sell({ crop_id, quantity_g, quote_id, request_id }, userId) { return (await api.post("/garden/market/sell", { crop_id, quantity_g, quote_id, request_id }, { ...forUser(userId), timeout: 20000 })).data; },
};
const unavailable = async (): Promise<never> => { throw { response: { status: 503 } }; };
// A custom/private preview must never fall back to the production transport.
export const unavailableGardenMarketApi: GardenMarketGateway = { read: unavailable, quote: unavailable, sell: unavailable };

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128;
const hex = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const amount = (v: unknown): v is string => typeof v === "string" && v.length <= 4096 && /^\d+\.\d{2}$/.test(v);

// Exact quantities only. Decimal input becomes a rational for comparison, never a float.
export function saleFraction(value: unknown): [bigint, bigint] | null {
  // Response fractions can be longer than the 128-character request (normalization).
  if (typeof value !== "string" || value.length > 4096 || !/^\d+(?:\.\d+|\/\d+)?$/.test(value)) return null;
  const [whole, part] = value.split(value.includes("/") ? "/" : ".");
  const n = BigInt(value.includes(".") ? whole + part : whole);
  const d = value.includes("/") ? BigInt(part) : value.includes(".") ? 10n ** BigInt(part.length) : 1n;
  return d > 0n ? [n, d] : null;
}
export function sameSaleQuantity(a: string, b: string): boolean {
  const x = saleFraction(a), y = saleFraction(b);
  return !!x && !!y && x[0] * y[1] === y[0] * x[1];
}
export function validSaleQuantity(value: string, stock: string): boolean {
  const a = saleFraction(value), b = saleFraction(stock);
  return value.length <= 128 && !!a && !!b && a[0] > 0n && a[0] * b[1] <= b[0] * a[1];
}
export function saleQuantityLabel(value: string): string {
  const f = saleFraction(value);
  if (!f) return "—";
  const label = formatGardenQuantity(`${f[0]}/${f[1]}`);
  return label === "—" ? `${value} g` : label;
}
function marketWallet(value: unknown): ShellBalance {
  if (!record(value) || !amount(value.shell_balance_display) || typeof value.shell_balance_exact !== "string" || !saleFraction(value.shell_balance_exact)) throw Error("Invalid exact market wallet");
  return { display: value.shell_balance_display, exact: value.shell_balance_exact };
}
function priced(v: Record<string, unknown>) {
  return amount(v.shells_display) && typeof v.shells_exact === "string" && !!saleFraction(v.shells_exact);
}
export function parseGardenMarket(value: unknown, owner: WarehouseOwner, userId: string, offset: number): GardenMarket {
  if (!record(value) || value.owner !== owner || !id(value.owner_id) || (owner === "user" && value.owner_id !== userId)
    || value.unit !== "g" || typeof value.can_sell !== "boolean" || !Array.isArray(value.items)
    || typeof value.has_more !== "boolean" || (value.has_more ? !Number.isSafeInteger(value.next_offset) || Number(value.next_offset) <= offset : value.next_offset !== null)) throw Error("Invalid market");
  const crops = new Set();
  for (const item of value.items) {
    if (!record(item) || !id(item.crop_id) || crops.has(item.crop_id) || typeof item.crop_name !== "string" || !saleFraction(item.quantity_g)
      || typeof item.can_sell !== "boolean" || ((item.can_sell || item.shells_display !== undefined || item.shells_exact !== undefined) && !priced(item)) || (item.unavailable_reason !== undefined && typeof item.unavailable_reason !== "string")) throw Error("Invalid market item");
    crops.add(item.crop_id);
  }
  const wallet = marketWallet(value.wallet);
  return { ...value, wallet } as unknown as GardenMarket;
}
export function parseGardenQuote(value: unknown, userId: string, request: QuoteRequest): GardenQuote {
  if (!record(value) || value.owner !== "user" || value.owner_id !== userId || !hex(value.quote_id)
    || value.crop_id !== request.crop_id || typeof value.crop_name !== "string" || typeof value.quantity_g !== "string"
    || !saleFraction(value.quantity_g)?.[0] || !sameSaleQuantity(value.quantity_g, request.quantity_g) || !priced(value)
    || !Array.isArray(value.allocations) || !value.allocations.length) throw Error("Invalid market quote");
  for (const lot of value.allocations) {
    if (!record(lot) || !Number.isSafeInteger(lot.lot_id) || Number(lot.lot_id) <= 0 || !id(lot.batch_id)
      || !saleFraction(lot.quantity_g)?.[0] || !saleFraction(lot.shells_per_g) || !id(lot.pricing_version)) throw Error("Invalid quote allocation");
  }
  return value as unknown as GardenQuote;
}
export function validSaleRequest(value: unknown): value is SaleRequest {
  return record(value) && Object.keys(value).length === 4 && id(value.crop_id) && typeof value.quantity_g === "string" && validSaleQuantity(value.quantity_g, value.quantity_g)
    && hex(value.quote_id) && typeof value.request_id === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.request_id);
}
export function parseGardenSale(value: unknown, userId: string, request: SaleRequest): GardenSale {
  const quote = parseGardenQuote(value, userId, request);
  if (!record(value) || quote.quote_id !== request.quote_id || value.request_id !== request.request_id
    || !saleFraction(value.remaining_g) || typeof value.sold_at !== "string" || !Number.isFinite(Date.parse(value.sold_at))) throw Error("Uncertain market receipt");
  marketWallet(value.wallet);
  return value as unknown as GardenSale;
}
