import { useState } from "react";
import { Link } from "react-router-dom";
import { BirthYearSettings } from "../components/BirthYearSettings";
import { CoordinateSettings } from "../components/CoordinateSettings";
import { TimezoneSettings } from "../components/TimezoneSettings";
import "../fields/fields.css";

export function AccountSettingsPage() {
  const [busy, setBusy] = useState(false);
  return <main className="field-app"><div className="field-shell"><header className="field-topbar"><h1>帳號設定</h1>{!busy && <Link className="field-button" to="/outside">← 返回導航</Link>}</header><fieldset className="field-settings" disabled={busy}><section className="field-panel"><BirthYearSettings onBusyChange={setBusy} /></section><section className="field-panel"><CoordinateSettings onBusyChange={setBusy} /></section><section className="field-panel"><TimezoneSettings onBusyChange={setBusy} /></section></fieldset></div></main>;
}
