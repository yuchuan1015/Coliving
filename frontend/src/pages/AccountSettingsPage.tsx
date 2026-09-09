import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useState } from "react";
import { Link } from "react-router-dom";
import { BirthYearSettings } from "../components/BirthYearSettings";
import { CoordinateSettings } from "../components/CoordinateSettings";
import { TimezoneSettings } from "../components/TimezoneSettings";
import "../fields/fields.css";
import { LanguageControl } from "../i18n/LanguageControl";

export function AccountSettingsPage() {
  useUiLanguage();
  const [busy, setBusy] = useState(false);
  return <main className="field-app"><div className="field-shell"><header className="field-topbar"><h1>{uiText("帳號設定")}</h1>{!busy && <Link className="field-button" to="/outside">{uiText("← 返回導航")}</Link>}</header><fieldset className="field-settings" disabled={busy}><section className="field-panel"><LanguageControl /><BirthYearSettings onBusyChange={setBusy} /></section><section className="field-panel"><CoordinateSettings onBusyChange={setBusy} /></section><section className="field-panel"><TimezoneSettings onBusyChange={setBusy} /></section></fieldset></div></main>;
}
