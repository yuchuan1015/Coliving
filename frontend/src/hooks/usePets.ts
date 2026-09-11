import { useCallback, useEffect, useRef, useState } from "react";
import { parsePet, parsePets, petApi, validPetAction, validPetAdoption, type PetAction, type PetAdoption, type PetGateway, type PetList } from "../api/pets";
import { isSessionIdentityError } from "../api/session-identity";
import { shelfError } from "./useBookshelf";
import { uiText } from "../i18n/core";

type State = { owner: string; data?: PetList; loading: boolean; busy: boolean; uncertain: boolean; error: string; notice: string };
const empty = (owner: string): State => ({ owner, loading: true, busy: false, uncertain: false, error: "", notice: "" });
export function usePets(userId: string, gateway: PetGateway = petApi, onBusyChange?: (busy: boolean) => void) {
  const [state, setState] = useState<State>(() => empty(userId));
  const snapshot = useRef(state); snapshot.current = state;
  const current = useRef({ userId, gateway }); current.current = { userId, gateway };
  const callback = useRef(onBusyChange); callback.current = onBusyChange;
  const reportBusy = useCallback((busy: boolean) => { callback.current?.(busy); }, []);
  const epoch = useRef(0), lock = useRef(false), read = useRef<AbortController | null>(null), mounted = useRef(false);
  const cancelRead = useCallback(() => { read.current?.abort(); }, []);
  // Lifecycle counters/controllers, not DOM refs: invalidate the latest requests on cleanup.
  const invalidate = useCallback(() => { mounted.current = false; epoch.current++; cancelRead(); reportBusy(false); }, [cancelRead, reportBusy]);
  const valid = useCallback((version: number) => mounted.current && epoch.current === version && current.current.userId === userId && current.current.gateway === gateway, [userId, gateway]);
  const refresh = useCallback(async () => {
    if (!userId || !mounted.current || lock.current) return;
    read.current?.abort(); const controller = new AbortController(); read.current = controller;
    const version = epoch.current;
    setState(p => ({ ...p, owner: userId, data: undefined, loading: true, error: "", notice: "" }));
    try {
      // The existing endpoint lazily settles state. Read only on open/explicit refresh, never poll.
      const data = parsePets(await gateway.list(controller.signal, userId));
      if (valid(version) && !controller.signal.aborted) setState(p => ({ ...p, owner: userId, data, loading: false, uncertain: false,
        notice: p.uncertain ? uiText("狀態已重新讀取，但無法據此確認上一筆是否完成。請先核對清單與狀態，再決定是否進行新的操作。") : "" }));
    } catch (error) {
      if (valid(version) && !controller.signal.aborted) setState(p => ({ ...p, data: undefined, loading: false,
        error: isSessionIdentityError(error) ? uiText("登入身分已變更，請重新登入後再查看小夥伴。") : uiText(shelfError(error).message) }));
    }
  }, [userId, gateway, valid]);
  useEffect(() => {
    mounted.current = true; epoch.current++; lock.current = false; setState(empty(userId));
    if (userId) void refresh(); else setState({ ...empty(userId), loading: false, error: uiText("請先登入，再查看小夥伴。") });
    return invalidate;
  }, [userId, gateway, refresh, invalidate]);

  async function send(kind: "adopt" | "interact", body: PetAdoption | { id: string; action: string }): Promise<boolean> {
    const s = snapshot.current;
    if (!userId || !valid(epoch.current) || lock.current || s.owner !== userId || !s.data || s.loading || s.uncertain || s.error) return false;
    if (kind === "adopt") {
      if (!validPetAdoption(body as PetAdoption) || !s.data.capacity?.can_adopt) return false;
    } else {
      const b = body as { id: string; action: string };
      if (!validPetAction(b.action) || !s.data.pets.some(p => p.id === b.id && p.is_alive)) return false;
    }
    lock.current = true; read.current?.abort(); const version = epoch.current;
    setState(p => ({ ...p, busy: true, error: "", notice: "" })); reportBusy(true);
    try {
      const b = body as { id: string; action: string };
      const result = kind === "adopt" ? await gateway.adopt(body as PetAdoption, userId) : await gateway.interact(b.id, b.action as PetAction, userId);
      const pet = parsePet(result);
      if (kind === "interact" && pet.id !== b.id) throw Error("Pet identity changed");
      if (!valid(version)) return false;
      setState(p => ({ ...p, data: p.data ? { ...p.data, ...(kind === "adopt" ? { capacity: undefined } : {}), pets: [...p.data.pets.filter(item => item.id !== pet.id), pet] } : undefined,
        notice: kind === "adopt" ? uiText("新的小夥伴入住了。") : uiText("照顧完成，狀態已更新。") }));
      return true;
    } catch (error) {
      if (!valid(version)) return false;
      const failure = shelfError(error);
      // This API has no request_id: an unknown result must not trigger a POST retry.
      const uncertain = !failure.status || failure.status >= 500 || isSessionIdentityError(error);
      setState(p => ({ ...p, uncertain, error: uncertain ? uiText("結果尚未確認，請先更新寵物狀態，再決定下一步；不要重複送出。") : uiText(failure.message) }));
      return false;
    } finally {
      if (valid(version)) { lock.current = false; setState(p => ({ ...p, busy: false })); reportBusy(false); }
    }
  }
  return { ...(state.owner === userId ? state : empty(userId)), refresh,
    adopt: (body: PetAdoption) => send("adopt", body), interact: (id: string, action: string) => send("interact", { id, action }) };
}
