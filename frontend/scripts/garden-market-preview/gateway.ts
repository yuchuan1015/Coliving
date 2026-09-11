// Synthetic local examples only. Never imported by the production entry.
import { saleFraction, sameSaleQuantity, validSaleQuantity, type GardenMarketGateway, type QuoteRequest, type SaleRequest } from "../../src/api/garden-market";
export function createMarketPreview(mode = "ready") {
  const userId = `market-preview-${crypto.randomUUID()}`;
  let stock = mode === "fractions" ? "200/3" : "2637", wallet = "0";
  const calls: { kind: string; body: unknown }[] = [], receipts = new Map<string, { body: string; result: unknown }>();
  let lost = mode === "unknown";
  const rational = (n: bigint, d: bigint) => `${n}/${d}`;
  const money = (exact: string) => { const [n, d] = saleFraction(exact)!; const cents = (n * 200n + d) / (2n * d); return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`; };
  const walletOut = () => ({ shell_balance_exact: wallet, shell_balance_display: money(wallet) });
  const failure = (code: string, status = 409) => ({ response: { status, data: { ok: false, error: { code, detail: `隔離範例：${code}`, status_code: status } } } });
  const price = (q: string) => { const [n, d] = saleFraction(q)!; return rational(n, d * 10n); };
  const buildQuote = (c: QuoteRequest) => {
    if (!validSaleQuantity(c.quantity_g, stock) || c.crop_id !== "carrot") throw failure("insufficient_stock");
    const [n, d] = saleFraction(c.quantity_g)!;
    return { ...c, quantity_g: rational(n, d), quote_id: "a".repeat(64), owner: "user", owner_id: userId, crop_name: "胡蘿蔔", shells_exact: price(c.quantity_g), shells_display: money(price(c.quantity_g)), allocations: [{ lot_id: 1, batch_id: "synthetic-batch", quantity_g: rational(n, d), shells_per_g: "1/10", pricing_version: "isolated-example" }] };
  };
  const gateway: GardenMarketGateway = {
    async read(owner, offset) {
      calls.push({ kind: "read", body: { owner, offset } });
      if (mode === "denied") throw failure("inactive_user", 403);
      if (mode === "unavailable") throw failure("not_deployed", 404);
      const q = owner === "user" ? stock : "200/3";
      return { owner, owner_id: owner === "user" ? userId : "market-preview-agent", can_sell: owner === "user", wallet: owner === "user" ? walletOut() : { shell_balance_exact: "30/7", shell_balance_display: "4.29" }, items: saleFraction(q)![0] ? [{ crop_id: "carrot", crop_name: "胡蘿蔔", quantity_g: q, can_sell: owner === "user", shells_exact: price(q), shells_display: money(price(q)) }] : [], unit: "g", has_more: false, next_offset: null };
    },
    async quote(c) { calls.push({ kind: "quote", body: { ...c } }); return buildQuote(c); },
    async sell(c: SaleRequest) {
      calls.push({ kind: "sell", body: { ...c } });
      const old = receipts.get(c.request_id);
      if (old) { if (old.body !== JSON.stringify(c)) throw failure("idempotency_conflict"); return structuredClone(old.result); }
      if (mode === "stale") throw failure("stale_quote");
      const quote = buildQuote(c);
      if (c.quote_id !== quote.quote_id || !sameSaleQuantity(c.quantity_g, quote.quantity_g)) throw failure("stale_quote");
      const [sn, sd] = saleFraction(stock)!, [n, d] = saleFraction(c.quantity_g)!, [wn, wd] = saleFraction(wallet)!, [pn, pd] = saleFraction(quote.shells_exact)!;
      stock = rational(sn * d - n * sd, sd * d); wallet = rational(wn * pd + pn * wd, wd * pd);
      const result = { ...quote, request_id: c.request_id, remaining_g: stock, wallet: walletOut(), sold_at: "2026-09-11T04:00:00Z" };
      receipts.set(c.request_id, { body: JSON.stringify(c), result });
      if (lost) { lost = false; throw Error("Synthetic lost sale response"); }
      return structuredClone(result);
    },
  };
  return { userId, gateway, calls };
}
