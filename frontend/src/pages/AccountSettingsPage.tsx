import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useState } from "react";
import { Link } from "react-router-dom";
import { BirthYearSettings } from "../components/BirthYearSettings";
import { CoordinateSettings } from "../components/CoordinateSettings";
import { TimezoneSettings } from "../components/TimezoneSettings";
import "../photo-album.css";
import "../cabin-utility.css";
import "../account-settings.css";
import { LanguageControl } from "../i18n/LanguageControl";
import { DisplayNameSettings, PasswordSettings } from "../components/AccountProfileSettings";

export function AccountSettingsPage() {
  useUiLanguage();
  const [busy, setBusy] = useState(false);
  return <main className="photo-album cabin-utility account-settings">
    <div className="photo-album-stack">
      <header className="photo-album-header">
        <h1>{uiText("帳號設定")}</h1>
        {!busy && <Link className="account-settings-back" to="/outside">{uiText("← 返回導航")}</Link>}
      </header>
      <fieldset className="account-settings-sections" disabled={busy}>
        <section className="photo-panel"><DisplayNameSettings onBusyChange={setBusy} /></section>
        <section className="photo-panel"><PasswordSettings onBusyChange={setBusy} /></section>
        <section className="photo-panel"><LanguageControl /><BirthYearSettings onBusyChange={setBusy} /></section>
        <section className="photo-panel"><CoordinateSettings onBusyChange={setBusy} /></section>
        <section className="photo-panel"><TimezoneSettings onBusyChange={setBusy} /></section>
      </fieldset>
    </div>
  </main>;
}
