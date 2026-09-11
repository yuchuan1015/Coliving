import { useCallback, useEffect, useRef, useState } from "react";
import { parsePetAssets, parseWishDetail, parseWishList, parseWishResult, validAssetKey, validPendingWish, wishError,
  type PetWishGateway, type PetAsset, type PetWish, type WishList, type WishDetail, type WishResult, type WishStatus, type PendingWishOperation } from "../api/pet-wishes";
import { validWishDraft, type PetWishDraft } from "../api/pet-wish-draft";
import { isSessionIdentityError } from "../api/session-identity";
import { uiText } from "../i18n/core";

type State = { owner: string; generation: number; list?: WishList; assets?: PetAsset[]; detail?: WishDetail; result?: WishResult;
  loading: boolean; busy: boolean; error: string; catalogError: string; pending?: PendingWishOperation; storageError: boolean; conflict: boolean; denied: boolean; preparationUnknown: boolean };
const empty = (owner: string, generation: number): State => ({ owner, generation, loading: false, busy: false, error: "", catalogError: "", storageError: false, conflict: false, denied: false, preparationUnknown: false });
const storageKey = (userId: string, admin: boolean) => `rookery.pet-wish.${admin ? "arrive" : "create"}.v1:${encodeURIComponent(userId)}`;
const storageMessage = () => uiText("無法保存這筆操作的重試記錄，目前不會送出。請檢查瀏覽器儲存空間。");
const newest = (incoming: PetWish, ...known: (PetWish | undefined)[]) => known.reduce<PetWish>((best, w) => w?.id === best.id && w.version > best.version ? w : best, incoming);

export function usePetWishes(userId: string, admin: boolean, gateway: PetWishGateway | undefined, onBusyChange?: (busy: boolean) => void) {
  const identity = useRef({ userId, admin, gateway, generation: 0 });
  if (identity.current.userId !== userId || identity.current.admin !== admin || identity.current.gateway !== gateway)
    identity.current = { userId, admin, gateway, generation: identity.current.generation + 1 };
  const generation = identity.current.generation;
  const [state, setState] = useState<State>(() => empty(userId, generation));
  const snapshot = useRef(state); snapshot.current = state;
  const mounted = useRef(false), epoch = useRef(0), lock = useRef(false), read = useRef<AbortController | null>(null);
  const callbacks = useRef(onBusyChange); callbacks.current = onBusyChange;
  const status = useRef<WishStatus | "">("");
  const reportBusy = useCallback((busy: boolean) => callbacks.current?.(busy), []);
  const cancelRead = useCallback(() => read.current?.abort(), []);
  const invalidate = useCallback(() => { mounted.current = false; epoch.current++; cancelRead(); reportBusy(false); }, [cancelRead, reportBusy]);
  const valid = useCallback((version: number) => mounted.current && epoch.current === version && identity.current.generation === generation && identity.current.userId === userId, [userId, generation]);
  const deny = () => setState(p => ({ ...empty(userId, generation), pending: p.pending, denied: true, storageError: p.storageError, error: uiText("登入或管理權限已變更，請重新登入後查看。") }));
  const refresh = useCallback(async (more = false, filter?: WishStatus | "") => {
    if (!gateway || !userId || !valid(epoch.current) || lock.current) return;
    const prior = snapshot.current.list;
    if (filter !== undefined) status.current = filter;
    if (more && (!prior?.has_more || prior.next_offset === null || snapshot.current.loading)) return;
    cancelRead(); const c = new AbortController(), version = epoch.current; read.current = c;
    const offset = more ? prior!.next_offset! : 0;
    setState(p => ({ ...p, loading: true, list: more ? p.list : undefined, error: "", denied: false }));
    const [listResult, assetsResult] = await Promise.allSettled([gateway.list(admin, offset, status.current, c.signal, userId), gateway.assets(c.signal, userId)]);
    if (!valid(version) || c.signal.aborted) return;
    let list: WishList | undefined, assets: PetAsset[] | undefined, error = "", catalogError = "", denied = false;
    try {
      if (listResult.status === "rejected") throw listResult.reason;
      list = parseWishList(listResult.value, admin ? undefined : userId, offset);
      if (more && prior) { const map = new Map(prior.items.map(w => [w.id, w])); list.items.forEach(w => { if (!map.has(w.id) || map.get(w.id)!.version <= w.version) map.set(w.id, w); }); list = { ...list, items: [...map.values()] }; }
    } catch (e) { const f = wishError(e); denied = isSessionIdentityError(e) || f.status === 401 || f.status === 403;
      error = denied ? uiText("登入或管理權限已變更，請重新登入後查看。") : uiText("暫時讀不到許願紀錄與名額，請重新讀取；不會因此重新提交願望。"); }
    try { if (assetsResult.status === "rejected") throw assetsResult.reason; assets = parsePetAssets(assetsResult.value); }
    catch (e) { const f = wishError(e); if (isSessionIdentityError(e) || f.status === 401 || f.status === 403) { denied = true; error = uiText("登入或管理權限已變更，請重新登入後查看。"); } else catalogError = uiText("暫時讀不到可領養圖庫；已送出的願望仍會保留。"); }
    setState(p => {
      const latest = list ? { ...list, items: list.items.map(w => newest(w, prior?.items.find(old => old.id === w.id), p.detail?.wish, p.result?.wish)).filter(w => !status.current || w.status === status.current) } : undefined;
      const current = p.detail && latest?.items.find(w => w.id === p.detail!.wish.id);
      return { ...p, loading: false, list: denied ? undefined : latest, assets: denied ? undefined : assets,
        detail: denied ? undefined : current && p.detail ? { wish: newest(current, p.detail.wish), capacity: latest?.capacity ?? p.detail.capacity } : p.detail,
        error, catalogError, denied };
    });
  }, [gateway, userId, admin, valid, cancelRead]);
  useEffect(() => {
    mounted.current = true; epoch.current++; lock.current = false; status.current = "";
    const initial = empty(userId, generation);
    if (userId && gateway) {
      try { const saved = sessionStorage.getItem(storageKey(userId, admin)); if (saved) { const pending: unknown = JSON.parse(saved); if (!validPendingWish(pending) || (pending.kind === "arrive") !== admin) throw Error("Invalid pending wish"); initial.pending = pending; } }
      catch { initial.storageError = true; initial.error = storageMessage(); }
    }
    setState(initial); if (userId && gateway) void refresh();
    return invalidate;
  }, [userId, admin, gateway, generation, refresh, invalidate]);

  const usable = () => !!gateway && !!userId && valid(epoch.current) && snapshot.current.owner === userId && snapshot.current.generation === generation && !lock.current && !snapshot.current.denied;
  const select = async (id: string) => {
    if (!usable() || snapshot.current.pending || snapshot.current.loading) return;
    cancelRead(); const c = new AbortController(), version = epoch.current; read.current = c;
    setState(p => ({ ...p, detail: undefined, loading: true, error: "", preparationUnknown: false }));
    try {
      const detail = parseWishDetail(await gateway!.detail(admin, id, c.signal, userId), admin ? undefined : userId, id);
      if (valid(version) && !c.signal.aborted) setState(p => {
        const old = p.list?.items.find(w => w.id === id), wish = newest(detail.wish, old, p.detail?.wish, p.result?.wish);
        const current = { wish, capacity: wish.version > detail.wish.version ? p.list?.capacity ?? p.detail?.capacity ?? detail.capacity : detail.capacity };
        return { ...p, detail: current, list: p.list ? { ...p.list, items: p.list.items.map(w => w.id === id ? wish : w), ...(admin ? {} : { capacity: current.capacity }) } : p.list };
      });
    } catch (e) { if (valid(version) && !c.signal.aborted) { const f = wishError(e); if (isSessionIdentityError(e) || f.status === 401 || f.status === 403) deny(); else setState(p => ({ ...p, error: uiText("無法讀取這份願望，請重新讀取。") })); } }
    finally { if (valid(version) && !c.signal.aborted) setState(p => ({ ...p, loading: false })); }
  };
  const saveResult = (result: WishResult) => {
    sessionStorage.removeItem(storageKey(userId, admin));
    setState(p => {
      const old = p.list?.items.find(w => w.id === result.wish.id), wish = old && old.version > result.wish.version ? old : result.wish;
      return { ...p, pending: undefined, result: { ...result, wish }, detail: { ...result, wish }, preparationUnknown: false,
        list: p.list ? { ...p.list, items: [wish, ...p.list.items.filter(w => w.id !== wish.id)], ...(admin ? {} : { capacity: result.capacity }) } : p.list };
    });
  };
  const send = async (pending: PendingWishOperation, lookup = false): Promise<boolean> => {
    if (!usable() || snapshot.current.storageError || snapshot.current.conflict || !validPendingWish(pending) || (pending.kind === "arrive") !== admin) return false;
    lock.current = true; cancelRead(); const version = epoch.current;
    try { sessionStorage.setItem(storageKey(userId, admin), JSON.stringify(pending)); }
    catch { lock.current = false; setState(p => ({ ...p, storageError: true, error: storageMessage() })); return false; }
    setState(p => ({ ...p, pending, busy: true, loading: false, error: "", result: undefined })); reportBusy(true);
    let confirmed = false;
    try {
      const data = lookup && pending.kind === "create" ? await gateway!.lookup(pending.body.client_request_id, userId) :
        pending.kind === "create" ? await gateway!.create(pending.body, userId) : await gateway!.arrive(pending.wish_id, pending.body, userId);
      const result = parseWishResult(data, pending, userId);
      if (!valid(version)) return false;
      try { saveResult(result); }
      catch { setState(p => ({ ...p, result, storageError: true, error: uiText("伺服器已確認這筆操作，但本機重試記錄無法清除。請勿建立另一筆相同操作。") })); return false; }
      confirmed = true; return true;
    } catch (e) {
      if (!valid(version)) return false;
      const f = wishError(e);
      if (isSessionIdentityError(e) || f.status === 401 || f.status === 403) deny();
      else if (f.code === "idempotency_conflict") setState(p => ({ ...p, conflict: true, error: uiText("這筆操作的識別碼與內容有衝突，請保留記錄並聯絡客服；不要另外提交相同願望。") }));
      else if (!lookup && f.status === 409 && ((pending.kind === "create" && f.code === "pet_capacity_unavailable") ||
        (pending.kind === "arrive" && ["version_conflict", "asset_unavailable", "invalid_transition", "fulfillment_review_required"].includes(f.code)))) {
        // These domain rejections happen only after replay lookup, so they cannot
        // erase an accepted receipt. Unknown/proxy/auth errors keep the exact outbox.
        try {
          sessionStorage.removeItem(storageKey(userId, admin));
          setState(p => ({ ...p, pending: undefined, preparationUnknown: admin, list: admin ? p.list : undefined,
            error: admin ? uiText("尚未完成到家確認，請重新讀取這份願望再處理。原本保留的名額不會釋放。") : uiText("目前沒有可用名額，這次許願未被接受。請更新名額後再確認。") }));
        } catch { setState(p => ({ ...p, storageError: true, error: storageMessage() })); }
      }
      else setState(p => ({ ...p, error: lookup && f.status === 404 ? uiText("目前尚未查到提交收據，不代表原請求未送達。請保留這筆記錄，只能重送同一筆。") : f.code === "pet_capacity_unavailable" ? uiText("目前沒有可用名額，這筆尚未被接受。請先核對名額；重送仍會沿用同一筆內容。") : f.code === "fulfillment_review_required" ? uiText("這份願望需要人工確認身分或綁定狀態，原本保留的名額不會釋放。") : uiText("結果尚未確認。請查回或重送同一筆操作，不要建立新的識別碼。") }));
      return false;
    } finally { if (valid(version)) { lock.current = false; setState(p => ({ ...p, busy: false })); reportBusy(false); if (confirmed) await refresh(); } }
  };
  const create = (draft: PetWishDraft) => {
    if (!usable() || snapshot.current.pending || snapshot.current.loading || snapshot.current.storageError || !snapshot.current.list?.capacity?.can_wish || !validWishDraft(draft)) return Promise.resolve(false);
    return send({ kind: "create", body: { ...draft, client_request_id: crypto.randomUUID() } });
  };
  const arrive = () => {
    const s = snapshot.current, w = s.detail?.wish;
    if (!usable() || !admin || s.pending || s.loading || s.preparationUnknown || !w || w.status !== "preparing" || !w.asset_key || !s.assets?.some(a => a.asset_key === w.asset_key)) return Promise.resolve(false);
    return send({ kind: "arrive", wish_id: w.id, body: { expected_version: w.version, client_request_id: crypto.randomUUID() } });
  };
  const prepare = async (assetKey: string | null, note: string) => {
    const s = snapshot.current, w = s.detail?.wish;
    if (!usable() || !admin || s.pending || s.loading || s.preparationUnknown || !w || w.status === "arrived" || [...note].length > 2000 || (assetKey !== null && (!validAssetKey(assetKey) || !s.assets?.some(a => a.asset_key === assetKey)))) return false;
    lock.current = true; cancelRead(); const version = epoch.current; setState(p => ({ ...p, busy: true, error: "" })); reportBusy(true);
    try {
      const detail = parseWishDetail(await gateway!.prepare(w.id, { expected_version: w.version, asset_key: assetKey, preparation_note: note }, userId), undefined, w.id);
      if (!valid(version)) return false;
      if (detail.wish.version <= w.version || detail.wish.status !== "preparing") throw Error("Invalid preparation response");
      setState(p => ({ ...p, detail, list: p.list ? { ...p.list, items: p.list.items.map(item => item.id === w.id ? detail.wish : item) } : undefined })); return true;
    } catch (e) { if (valid(version)) { const f = wishError(e); if (isSessionIdentityError(e) || f.status === 401 || f.status === 403) deny(); else setState(p => ({ ...p, preparationUnknown: true, error: uiText("準備資料可能已變更，請重新讀取這份願望再操作；不會自動再次保存。") })); } return false;
    } finally { if (valid(version)) { lock.current = false; setState(p => ({ ...p, busy: false })); reportBusy(false); } }
  };
  return { ...(state.owner === userId && state.generation === generation ? state : empty(userId, generation)), refresh, select, create, arrive, prepare,
    back: () => { if (usable()) setState(p => ({ ...p, detail: undefined, error: "", result: undefined })); },
    retry: () => snapshot.current.pending ? send(snapshot.current.pending) : Promise.resolve(false),
    lookup: () => snapshot.current.pending?.kind === "create" ? send(snapshot.current.pending, true) : Promise.resolve(false) };
}
