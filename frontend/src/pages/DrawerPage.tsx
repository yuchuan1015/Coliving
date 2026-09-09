import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { CabinUtilityShell } from "../components/CabinUtilityShell";
import { useEffect, useState } from "react";
import { getDrawerSummary, type LockedDrawer } from "../api/furniture";

export function DrawerPage() {
  useUiLanguage();
  const [drawer, setDrawer] = useState<LockedDrawer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(false); setDrawer(null);
    getDrawerSummary()
      .then(value => { if (active) setDrawer(value); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  return <CabinUtilityShell title={uiText("抽屜")} code="DRAWER">
    <section className="photo-panel utility-locked" aria-labelledby="drawer-locked-title">
      <span className="utility-lock-mark" aria-hidden="true">🔒</span>
      <h2 id="drawer-locked-title">{uiText("抽屜上鎖了")}</h2>
      {loading && <p role="status">{uiText("正在讀取抽屜狀態…")}</p>}
      {drawer && <>
        <p className="utility-lock-count">{uiText("裡面有 ")}<strong>{drawer.count}</strong>{uiText(" 樣物件")}</p>
        <p>{uiText(drawer.message)}</p>
      </>}
      {error && <div className="utility-lock-error">
        <p role="alert">{uiText("暫時無法讀取物件數量，抽屜仍維持上鎖。")}</p>
        <button onClick={() => setRevision(value => value + 1)}>{uiText("重新讀取")}</button>
      </div>}
      <p className="utility-readonly-note">{uiText("只有室友能透過自己的工具存放或取出物件。")}</p>
    </section>
  </CabinUtilityShell>;
}
