import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./useAuth";
import { gardenCommand, gardenHttpError, parseGardenReceipt, parsePublicGarden, publicGardenApi,
  type GardenAction, type GardenCommand, type GardenGateway, type PublicGarden } from "../api/garden";
import { uiText } from "../i18n/core";

interface GardenState {
  owner: string; gateway: GardenGateway; data?: PublicGarden; receivedAt: number;
  loading: boolean; busy: boolean; error: string; notice: string; uncertain?: GardenCommand;
}

export function usePublicGarden(gateway: GardenGateway = publicGardenApi) {
  const { user } = useAuth();
  const owner = user?.id ?? "";
  const identity = useRef({ owner, gateway });
  identity.current = { owner, gateway };
  const epoch = useRef(0);
  const reads = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const [state, setState] = useState<GardenState>({ owner, gateway, loading: true, busy: false, receivedAt: 0, error: "", notice: "" });
  const stateRef = useRef(state);
  stateRef.current = state;
  const current = useCallback((version: number) => epoch.current === version && identity.current.owner === owner && identity.current.gateway === gateway, [owner, gateway]);
  const refresh = useCallback(async () => {
    if (!owner) return;
    reads.current?.abort();
    const controller = new AbortController();
    reads.current = controller;
    const version = epoch.current;
    setState(previous => ({ ...previous, loading: true, error: previous.uncertain ? previous.error : "" }));
    try {
      const data = parsePublicGarden(await gateway.read(controller.signal), owner);
      if (!current(version) || controller.signal.aborted) return;
      setState(previous => ({ ...previous, owner, gateway, data, receivedAt: Date.now(), loading: false, error: previous.uncertain ? previous.error : "" }));
    } catch (error) {
      if (!current(version) || controller.signal.aborted) return;
      const { status } = gardenHttpError(error);
      setState(previous => ({ ...previous, data: undefined, loading: false,
        uncertain: status === 401 || status === 403 ? undefined : previous.uncertain,
        error: status === 401 || status === 403 ? uiText("登入狀態已變更，請重新登入後再試。")
          : status === 404 ? uiText("公共農田服務尚未就緒，請稍後再試。") : uiText("暫時讀不到農田近況，請重新整理。") }));
    }
  }, [owner, gateway, current]);

  useEffect(() => {
    // Abort the latest refresh, not only the request active when this effect began.
    const abortLatestRead = () => reads.current?.abort();
    epoch.current++;
    lock.current = false;
    setState({ owner, gateway, loading: !!owner, busy: false, receivedAt: 0, error: owner ? "" : uiText("請先登入，再進入公共農田。"), notice: "" });
    void refresh();
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- this is a cancellation counter, not a DOM ref; invalidate all in-flight work on teardown.
    return () => { epoch.current++; abortLatestRead(); };
  }, [owner, gateway, refresh]);

  const execute = async (command: GardenCommand) => {
    if (lock.current || !owner || stateRef.current.owner !== owner || stateRef.current.gateway !== gateway) return;
    lock.current = true;
    const version = epoch.current;
    reads.current?.abort();
    setState(previous => ({ ...previous, busy: true, loading: false, error: "", notice: "" }));
    try {
      const receipt = parseGardenReceipt(await gateway.act(command));
      if (!current(version)) return;
      if (!receipt.ok && receipt.status >= 500) throw new Error("Uncertain server outcome");
      setState(previous => ({ ...previous, uncertain: undefined, notice: receipt.ok
        ? command.action === "vote" ? uiText("投票已收到，正在更新農田。") : uiText("照顧已記錄，謝謝你來照看這片農田。")
        : receipt.detail }));
      if (!receipt.ok && [401, 403].includes(receipt.status)) {
        setState(previous => ({ ...previous, data: undefined, error: receipt.detail }));
      } else await refresh(); // GET is authoritative: idempotent replay may return an old plot.
    } catch (error) {
      if (!current(version)) return;
      const { status, detail } = gardenHttpError(error);
      const uncertain = status === 0 || status >= 500;
      setState(previous => ({ ...previous, uncertain: uncertain ? command : undefined,
        data: status === 401 || status === 403 ? undefined : previous.data,
        notice: uncertain ? "" : detail || uiText("這次操作沒有完成，請重新整理後再試。"),
        error: uncertain ? uiText("還無法確認這次操作是否成功。請用下方按鈕確認同一筆操作，避免重複送出。")
          : "" }));
      if (!uncertain && status !== 401 && status !== 403) await refresh();
    } finally {
      if (current(version)) { lock.current = false; setState(previous => ({ ...previous, busy: false })); }
    }
  };
  const submit = (plotId: string, action: GardenAction, cropId?: string) => {
    const snapshot = stateRef.current;
    if (snapshot.owner !== owner || snapshot.gateway !== gateway || snapshot.loading || snapshot.busy || snapshot.uncertain || !snapshot.data) return;
    const plot = snapshot.data.plots.find(item => item.id === plotId);
    if (!plot || (action === "vote" && !snapshot.data.crops.some(crop => crop.id === cropId))) return;
    const now = Date.parse(snapshot.data.server_now) + Math.max(0, Date.now() - snapshot.receivedAt);
    const command = gardenCommand(plot, action, crypto.randomUUID(), now, cropId);
    if (command) void execute(command);
  };
  const retry = () => {
    const snapshot = stateRef.current;
    if (snapshot.owner === owner && snapshot.gateway === gateway && snapshot.uncertain && !snapshot.busy) void execute(snapshot.uncertain);
  };
  return { ...(state.owner === owner && state.gateway === gateway ? state : { loading: true, busy: false, receivedAt: 0, error: "", notice: "", data: undefined, uncertain: undefined }), refresh, submit, retry };
}
