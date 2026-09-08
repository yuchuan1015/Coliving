import { useState } from "react";
import { Link } from "react-router-dom";
import { BirthYearSettings } from "../components/BirthYearSettings";
import "../fields/fields.css";

export function AccountSettingsPage() {
  const [busy, setBusy] = useState(false);
  return <main className="field-app"><div className="field-shell"><header className="field-topbar"><h1>帳號設定</h1>{!busy && <Link className="field-button" to="/outside">← 返回導航</Link>}</header><section className="field-panel"><BirthYearSettings onBusyChange={setBusy} /></section></div></main>;
}
