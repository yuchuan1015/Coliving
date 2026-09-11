import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./useAuth";
import { privateGardenHttpError as gardenHttpError, parseGardenInventory, parseGardenProgress, parsePrivateGarden, privateCommand, privateGardenApi, privateReceipts,
  type GardenInventory, type GardenProgress, type PrivateCommand, type PrivateGarden, type PrivateGardenGateway,
  type PrivateIntent, type PrivateReceipt, type WarehouseOwner } from "../api/private-garden";
import { uiText } from "../i18n/core";

export interface PrivateOutcome { command: PrivateCommand; receipt: PrivateReceipt }
interface Section<T> { data?: T; error: string; loading?: boolean }
interface PrivateState {
  owner: string; gateway: PrivateGardenGateway; generation: number; accessDenied: boolean; data?: PrivateGarden; loading: boolean; busy: boolean; error: string;
  inventory: Record<WarehouseOwner, Section<GardenInventory>>; progress: Section<GardenProgress>; outcomes: PrivateOutcome[];
}
const empty = (owner: string, gateway: PrivateGardenGateway, generation = 0): PrivateState => ({ owner, gateway, generation, accessDenied: false, loading: !!owner, busy: false,
  error: owner ? "" : uiText("請先登入，再進入私人菜園。"), inventory: { user: { error: "" }, agent: { error: "" } }, progress: { error: "" }, outcomes: [] });
const accessMessage = (error: { status: number; code?: string }) => error.code === "agent_required" ? uiText("需要先有室友才能使用菜園，請返回艙室。")
  : error.status === 401 || error.code === "inactive_user" ? uiText("登入狀態已變更，請重新登入後再試。") : uiText("目前沒有這片菜園的存取權限，請返回艙室。");

export function usePrivateGarden(gateway: PrivateGardenGateway = privateGardenApi) {
  const { user } = useAuth(), owner = user?.id ?? "";
  const identity = useRef({ owner, gateway, generation: 0 });
  // Fence responses at render time as well as effect cleanup (including A → B → A).
  if (identity.current.owner !== owner || identity.current.gateway !== gateway) identity.current = { owner, gateway, generation: identity.current.generation + 1 };
  const generation = identity.current.generation;
  const epoch = useRef(0), lock = useRef(false), read = useRef<AbortController | null>(null);
  const pages = useRef<Partial<Record<WarehouseOwner, AbortController>>>({});
  const [state, setState] = useState<PrivateState>(() => empty(owner, gateway));
  const snapshot = useRef(state); snapshot.current = state;
  const current = useCallback((version: number) => epoch.current === version && identity.current.generation === generation && identity.current.owner === owner && identity.current.gateway === gateway, [owner, gateway, generation]);
  const cancel = useCallback(() => { read.current?.abort(); Object.values(pages.current).forEach(c => c?.abort()); pages.current = {}; }, []);
  const refreshAll = useCallback(async () => {
    if (!owner) return;
    cancel();
    const controller = new AbortController(), version = epoch.current;
    read.current = controller;
    setState(p => ({ ...p, loading: true, error: "", inventory: { user: { ...p.inventory.user, loading: false }, agent: { ...p.inventory.agent, loading: false } } }));
    const result = await Promise.allSettled([
      gateway.read(controller.signal).then(v => parsePrivateGarden(v, owner)),
      gateway.inventory("user", 0, controller.signal).then(v => parseGardenInventory(v, "user", owner, 0)),
      gateway.inventory("agent", 0, controller.signal).then(v => parseGardenInventory(v, "agent", owner, 0)),
      gateway.progress(controller.signal).then(parseGardenProgress),
    ]);
    if (!current(version) || controller.signal.aborted) return;
    const failures = result.flatMap(r => r.status === "rejected" ? [gardenHttpError(r.reason)] : []);
    const denied = failures.find(e => e.status === 401) ?? failures.find(e => e.status === 403);
    if (denied) { setState(p => ({ ...empty(owner, gateway, generation), accessDenied: true, outcomes: p.outcomes, busy: p.busy, loading: false, error: accessMessage(denied) })); return; }
    const [garden, human, agent, progress] = result;
    setState(p => ({ ...p, owner, gateway, accessDenied: false, loading: false, data: garden.status === "fulfilled" ? garden.value : undefined,
      error: garden.status === "fulfilled" ? "" : uiText("暫時讀不到私人菜園，請重新整理。"),
      inventory: { user: human.status === "fulfilled" ? { data: human.value, error: "" } : { error: uiText("暫時讀不到我的倉庫。") },
        agent: agent.status === "fulfilled" ? { data: agent.value, error: "" } : { error: uiText("暫時讀不到室友的倉庫。") } },
      progress: progress.status === "fulfilled" ? { data: progress.value, error: "" } : { error: uiText("暫時讀不到共同圖鑑進度。") } }));
  }, [owner, gateway, generation, current, cancel]);
  useEffect(() => {
    epoch.current++; lock.current = false;
    setState(empty(owner, gateway, generation)); void refreshAll();
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- invalidate pending work and abort the latest requests on teardown.
    return () => { epoch.current++; cancel(); };
  }, [owner, gateway, generation, refreshAll, cancel]);

  const execute = async (commands: readonly PrivateCommand[]) => {
    if (lock.current || !owner || snapshot.current.owner !== owner || snapshot.current.gateway !== gateway || snapshot.current.generation !== generation) return;
    lock.current = true; cancel(); const version = epoch.current;
    setState(p => ({ ...p, busy: true, loading: false, error: "" }));
    try {
      let receipts: PrivateReceipt[], transportDenied = false;
      try {
        receipts = privateReceipts(await gateway.act(commands), commands).map(r => r.ok === false && r.status >= 500 ? { ok: null } : r);
      } catch (e) {
        const { status, detail, code } = gardenHttpError(e);
        transportDenied = status === 401 || status === 403;
        receipts = commands.map(() => status === 0 || status >= 500 ? { ok: null } : { ok: false, status, detail: detail || uiText("操作未完成，請更新田地後再試。"), code: code ?? "request_error" });
      }
      if (!current(version)) return;
      setState(p => {
        const next = commands.map((command, i) => ({ command, receipt: receipts[i] }));
        return { ...p, outcomes: [...p.outcomes.filter(o => !commands.some(c => c.request_id === o.command.request_id)), ...next] };
      });
      // A per-action 403 (e.g. action_forbidden) is not a session failure and
      // must not erase successful siblings in the same HTTP 200 response.
      const denied = receipts.find(r => r.ok === false && (transportDenied || r.status === 401 || ["inactive_user", "agent_required"].includes(r.code)));
      if (denied?.ok === false) {
        setState(p => ({ ...empty(owner, gateway, generation), accessDenied: true, outcomes: p.outcomes, busy: p.busy, loading: false, error: accessMessage(denied) })); return;
      }
      // Replayed receipts can contain OLD plots. Always replace from fresh GETs.
      await refreshAll();
    } finally {
      if (current(version)) { lock.current = false; setState(p => ({ ...p, busy: false })); }
    }
  };
  const submit = (intents: PrivateIntent[]) => {
    const s = snapshot.current;
    if (lock.current || !s.data || s.accessDenied || s.owner !== owner || s.gateway !== gateway || s.generation !== generation || s.loading || s.busy || s.outcomes.some(o => o.receipt.ok === null) || intents.length < 1 || intents.length > 4) return;
    const commands = intents.map(i => privateCommand(s.data!, i, crypto.randomUUID()));
    // A click is an immutable intent. Reject invalid/duplicate selections locally.
    if (commands.some(c => !c) || new Set(commands.map(c => `${c?.plot_id}:${c?.action}:${c?.action === "steal" ? c.batch_id : ""}`)).size !== commands.length) return;
    setState(p => ({ ...p, outcomes: [] }));
    void execute(Object.freeze(commands as PrivateCommand[]));
  };
  const retry = () => {
    const s = snapshot.current;
    if (s.accessDenied || s.owner !== owner || s.gateway !== gateway || s.generation !== generation || s.busy) return;
    const commands = s.outcomes.filter(o => o.receipt.ok === null).map(o => o.command);
    if (commands.length) void execute(Object.freeze(commands));
  };
  const loadMore = async (who: WarehouseOwner) => {
    const s = snapshot.current, prior = s.inventory[who].data;
    if (lock.current || s.loading || s.owner !== owner || s.gateway !== gateway || s.generation !== generation || !prior?.has_more || prior.next_offset === null || pages.current[who]) return;
    const offset = prior.next_offset, controller = new AbortController(), version = epoch.current;
    pages.current[who] = controller;
    setState(p => ({ ...p, inventory: { ...p.inventory, [who]: { ...p.inventory[who], error: "", loading: true } } }));
    try {
      const data = parseGardenInventory(await gateway.inventory(who, offset, controller.signal), who, owner, offset);
      if (!current(version) || controller.signal.aborted) return;
      if (data.owner_id !== prior.owner_id) throw Error("Inventory owner changed");
      const items = new Map(prior.items.map(i => [i.crop_id, i])); data.items.forEach(i => items.set(i.crop_id, i));
      setState(p => ({ ...p, inventory: { ...p.inventory, [who]: { data: { ...data, items: [...items.values()] }, error: "", loading: false } } }));
    } catch (e) {
      if (!current(version) || controller.signal.aborted) return;
      if ([401, 403].includes(gardenHttpError(e).status)) { cancel(); setState({ ...empty(owner, gateway, generation), accessDenied: true, loading: false, error: accessMessage(gardenHttpError(e)) }); }
      else setState(p => ({ ...p, inventory: { ...p.inventory, [who]: { ...p.inventory[who], error: uiText("其餘庫存讀取失敗，可再次載入。"), loading: false } } }));
    } finally { if (pages.current[who] === controller) delete pages.current[who]; }
  };
  const visible = state.owner === owner && state.gateway === gateway && state.generation === generation ? state : empty(owner, gateway, generation);
  return { ...visible, timezone: user?.timezone, uncertain: !visible.accessDenied && visible.outcomes.some(o => o.receipt.ok === null), submit, retry, loadMore,
    refresh: () => { if (!lock.current) void refreshAll(); } };
}
