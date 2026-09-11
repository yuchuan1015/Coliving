import { useCallback, useEffect, useRef, useState } from "react";
import { gardenMarketApi, hasSaleStock, parseGardenMarket, parseGardenQuote, parseGardenSale, validSaleQuantity, validSaleRequest,
  type GardenMarket, type GardenMarketGateway, type GardenQuote, type GardenSale, type MarketItem, type SaleRequest } from "../api/garden-market";
import { privateGardenHttpError, type WarehouseOwner } from "../api/private-garden";
import { isSessionIdentityError } from "../api/session-identity";
import { uiText } from "../i18n/core";

type Section = { data?: GardenMarket; loading: boolean; error: string; unavailable: boolean };
type State = { userId: string; generation: number; stores: Record<WarehouseOwner, Section>; selected?: MarketItem; quantity: string;
  quote?: GardenQuote; receipt?: GardenSale; pending?: Readonly<SaleRequest>; busy: boolean; error: string; denied: boolean; storageError: boolean; conflict: boolean };
const section = (): Section => ({ loading: false, error: "", unavailable: false });
const empty = (userId: string, generation: number): State => ({ userId, generation, stores: { user: section(), agent: section() }, quantity: "", busy: false, error: "", denied: false, storageError: false, conflict: false });
const pendingKey = (id: string) => `rookery.garden.pending-sale.v1:${encodeURIComponent(id)}`;
const storageMessage = () => uiText("無法保存這筆出售的重試記錄，請先確認瀏覽器儲存空間；目前不會送出出售。");

export function useGardenMarket(userId: string, active: boolean, locked: boolean, gateway: GardenMarketGateway = gardenMarketApi, onSold?: () => void) {
  const identity = useRef({ userId, gateway, generation: 0 });
  if (identity.current.userId !== userId || identity.current.gateway !== gateway) identity.current = { userId, gateway, generation: identity.current.generation + 1 };
  const generation = identity.current.generation;
  const [state, setState] = useState<State>(() => empty(userId, generation));
  const snapshot = useRef(state); snapshot.current = state;
  const mounted = useRef(false), epoch = useRef(0), writeLock = useRef(false), reads = useRef<Partial<Record<WarehouseOwner, AbortController>>>({}), quoteRead = useRef<AbortController | null>(null);
  const controls = useRef({ active, locked, onSold }); controls.current = { active, locked, onSold };
  const valid = useCallback((v: number) => mounted.current && epoch.current === v && identity.current.userId === userId && identity.current.gateway === gateway && identity.current.generation === generation, [userId, gateway, generation]);
  const cancelReads = useCallback(() => { Object.values(reads.current).forEach(c => c?.abort()); reads.current = {}; quoteRead.current?.abort(); }, []);
  const deny = useCallback(() => {
    cancelReads();
    setState(p => ({ ...empty(userId, generation), pending: p.pending, denied: true, storageError: p.storageError, conflict: p.conflict, error: uiText("登入或倉庫權限已變更，請重新登入或更新後再試。") }));
  }, [userId, generation, cancelReads]);

  const readStore = useCallback(async (who: WarehouseOwner, more = false) => {
    if (!userId || !valid(epoch.current)) return;
    const prior = snapshot.current.stores[who].data;
    if (more && (reads.current[who] || !prior?.has_more || prior.next_offset === null)) return;
    reads.current[who]?.abort();
    const c = new AbortController(), version = epoch.current, offset = more ? prior!.next_offset! : 0;
    reads.current[who] = c;
    setState(p => ({ ...p, stores: { ...p.stores, [who]: { ...p.stores[who], loading: true, error: "", unavailable: false } } }));
    try {
      const result = parseGardenMarket(await gateway.read(who, offset, c.signal, userId), who, userId, offset);
      if (!valid(version) || c.signal.aborted) return;
      if (more && result.owner_id !== prior!.owner_id) throw Error("Market owner changed");
      const items = more ? new Map(prior!.items.map(i => [i.crop_id, i])) : new Map<string, MarketItem>();
      result.items.forEach(i => items.set(i.crop_id, i));
      setState(p => ({ ...p, stores: { ...p.stores, [who]: { data: { ...result, items: [...items.values()] }, loading: false, error: "", unavailable: false } } }));
    } catch (error) {
      if (!valid(version) || c.signal.aborted) return;
      const e = privateGardenHttpError(error);
      if (isSessionIdentityError(error) || e.status === 401 || e.status === 403) { deny(); return; }
      setState(p => ({ ...p, stores: { ...p.stores, [who]: { data: more ? p.stores[who].data : undefined, loading: false,
        unavailable: e.status === 404 || e.status === 503, error: e.status === 404 || e.status === 503 ? uiText("收購功能暫未開放，原有收成仍保留。") : uiText("暫時讀不到收購資料，請重新讀取。") } } }));
    } finally { if (reads.current[who] === c) delete reads.current[who]; }
  }, [userId, gateway, valid, deny]);
  const refresh = useCallback(async () => {
    if (!userId || !valid(epoch.current) || writeLock.current) return;
    quoteRead.current?.abort();
    setState(p => ({ ...p, denied: false, selected: undefined, quantity: "", quote: undefined }));
    await Promise.all([readStore("user"), readStore("agent")]);
  }, [userId, readStore, valid]);
  useEffect(() => {
    mounted.current = true; epoch.current++; writeLock.current = false;
    const initial = empty(userId, generation);
    if (userId) {
      try {
        const stored = sessionStorage.getItem(pendingKey(userId));
        if (stored) {
          const request: unknown = JSON.parse(stored);
          if (!validSaleRequest(request)) throw Error("Invalid pending sale");
          initial.pending = Object.freeze({ ...request });
        }
      } catch { initial.storageError = true; initial.error = storageMessage(); }
    }
    setState(initial);
    // These refs are request-generation counters, not DOM nodes.
    const invalidate = () => { mounted.current = false; epoch.current++; cancelReads(); };
    return invalidate;
  }, [userId, gateway, generation, cancelReads]);
  const cancelQuote = useCallback(() => {
    if (!valid(epoch.current) || snapshot.current.pending || (writeLock.current && !quoteRead.current)) return;
    quoteRead.current?.abort(); quoteRead.current = null; writeLock.current = false;
    setState(p => ({ ...p, busy: false, selected: undefined, quote: undefined, error: "" }));
  }, [valid]);
  useEffect(() => { if (active) void refresh(); else if (quoteRead.current) cancelQuote(); }, [active, refresh, cancelQuote]);

  const usable = () => {
    const s = snapshot.current;
    return controls.current.active && mounted.current && s.userId === userId && s.generation === generation && identity.current.userId === userId && identity.current.generation === generation && !controls.current.locked && !s.denied && !s.storageError && !s.busy && !writeLock.current;
  };
  const editable = () => usable() && !snapshot.current.pending && !snapshot.current.stores.user.loading;
  const select = (cropId: string) => {
    if (!editable()) return;
    const market = snapshot.current.stores.user.data, item = market?.items.find(i => i.crop_id === cropId);
    if (!market?.can_sell || market.owner !== "user" || market.owner_id !== userId || !item?.can_sell || !hasSaleStock(item.quantity_g)) return;
    quoteRead.current?.abort();
    setState(p => ({ ...p, selected: item, quantity: validSaleQuantity(item.quantity_g, item.quantity_g) ? item.quantity_g : "", quote: undefined, receipt: undefined, error: "", conflict: false }));
  };
  const changeQuantity = (quantity: string) => { if (editable()) { quoteRead.current?.abort(); setState(p => ({ ...p, quantity, quote: undefined, error: "" })); } };
  const close = () => { if (!controls.current.locked && !snapshot.current.denied) cancelQuote(); };
  const requestQuote = async () => {
    const s = snapshot.current;
    if (!editable() || !s.selected || !s.stores.user.data?.can_sell || !s.selected.can_sell || !validSaleQuantity(s.quantity, s.selected.quantity_g)) return;
    writeLock.current = true; quoteRead.current?.abort(); const c = new AbortController(), version = epoch.current; quoteRead.current = c;
    setState(p => ({ ...p, busy: true, error: "", quote: undefined }));
    try {
      const result = parseGardenQuote(await gateway.quote({ crop_id: s.selected.crop_id, quantity_g: s.quantity }, c.signal, userId), userId, { crop_id: s.selected.crop_id, quantity_g: s.quantity });
      if (valid(version) && !c.signal.aborted) setState(p => ({ ...p, quote: result }));
    } catch (error) {
      if (!valid(version) || c.signal.aborted) return;
      const e = privateGardenHttpError(error);
      if (isSessionIdentityError(error) || e.status === 401 || e.status === 403) deny();
      else setState(p => ({ ...p, error: e.detail || uiText("報價未取得，沒有出售任何收成。請重新取得報價。") }));
    } finally { if (valid(version) && quoteRead.current === c) { quoteRead.current = null; writeLock.current = false; setState(p => ({ ...p, busy: false })); } }
  };
  const send = async (request: Readonly<SaleRequest>) => {
    if (!usable() || snapshot.current.conflict) return;
    const version = epoch.current; writeLock.current = true; cancelReads();
    // Persist only this immutable request, never a token, balance or inferred price.
    // A lost response or remount retries exactly this ID; it cannot create a second sale.
    try { sessionStorage.setItem(pendingKey(userId), JSON.stringify(request)); }
    catch { writeLock.current = false; setState(p => ({ ...p, storageError: true, error: storageMessage() })); return; }
    setState(p => ({ ...p, pending: request, busy: true, quote: undefined, error: "", receipt: undefined }));
    let completed = false;
    try {
      const receipt = parseGardenSale(await gateway.sell(request, userId), userId, request);
      if (!valid(version)) return;
      sessionStorage.removeItem(pendingKey(userId)); completed = true;
      setState(p => ({ ...p, pending: undefined, selected: undefined, quantity: "", receipt }));
    } catch (error) {
      if (!valid(version)) return;
      const e = privateGardenHttpError(error);
      if (isSessionIdentityError(error) || e.status === 401 || e.status === 403) deny();
      else if (e.code === "idempotency_conflict") setState(p => ({ ...p, conflict: true, error: uiText("這筆出售識別碼有衝突，請保留記錄並聯絡客服；不要另外送出同一筆出售。") }));
      // Only these sale-domain rejections are definite. A proxy/refresh 4xx after
      // a lost success must never erase the outbox or claim that nothing sold.
      else if (e.status === 409 && (e.code === "stale_quote" || e.code === "insufficient_stock")) {
        try { sessionStorage.removeItem(pendingKey(userId)); } catch { setState(p => ({ ...p, storageError: true })); }
        completed = true;
        setState(p => ({ ...p, pending: undefined, quote: undefined, selected: undefined, error: uiText("庫存已變更，這次沒有成交。請重新選擇數量、取得報價並確認。") }));
      } else setState(p => ({ ...p, error: uiText("出售結果尚未確認。請重試同一筆，不要重新建立出售。") }));
    } finally {
      if (valid(version)) {
        writeLock.current = false; setState(p => ({ ...p, busy: false }));
        if (completed) {
          // An idempotent receipt may carry OLD wallet data. GET is authoritative.
          await Promise.all([readStore("user"), readStore("agent")]);
          if (valid(version)) controls.current.onSold?.();
        }
      }
    }
  };
  const confirm = () => {
    if (!editable()) return;
    const s = snapshot.current, q = s.quote, market = s.stores.user.data;
    if (!q || !s.selected || q.crop_id !== s.selected.crop_id || !market?.can_sell || market.owner !== "user" || market.owner_id !== userId || !market.items.find(i => i.crop_id === q.crop_id)?.can_sell) return;
    // Keep the original <=128-character input; the equivalent returned fraction may be longer.
    void send(Object.freeze({ crop_id: q.crop_id, quantity_g: snapshot.current.quantity, quote_id: q.quote_id, request_id: crypto.randomUUID() }));
  };
  const retry = () => { const p = snapshot.current.pending; if (p && usable()) void send(p); };
  return { ...(state.userId === userId && state.generation === generation ? state : empty(userId, generation)), refresh, loadMore: (who: WarehouseOwner) => { if (usable()) void readStore(who, true); }, select, changeQuantity, close, requestQuote, confirm, retry };
}
