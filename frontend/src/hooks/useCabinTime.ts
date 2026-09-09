import { useEffect, useState } from "react";

/** One shared, second-aligned device clock; no requests or accumulated ticks. */
export function useCabinTime() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number | undefined;
    function schedule() {
      window.clearTimeout(timer);
      if (!document.hidden) timer = window.setTimeout(sync, 1000 - Date.now() % 1000);
    }
    function sync() {
      if (!document.hidden) setNow(new Date());
      schedule();
    }
    schedule();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, []);
  return now;
}
