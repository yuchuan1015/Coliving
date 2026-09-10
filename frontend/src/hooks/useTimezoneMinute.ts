import { useEffect, useState } from "react";

/** Minute-aligned local previews, paused in the background; never polls an API. */
export function useTimezoneMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number | undefined;
    function sync() {
      window.clearTimeout(timer);
      if (document.hidden) return;
      setNow(new Date());
      timer = window.setTimeout(sync, 60_000 - Date.now() % 60_000);
    }
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pageshow", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pageshow", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);
  return now;
}
