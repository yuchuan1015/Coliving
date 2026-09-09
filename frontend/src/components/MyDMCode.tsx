import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useFieldResource } from "../fields/fieldData";
import type { AgentPublic } from "../types";

export function MyDMCode() {
  useUiLanguage();
  const mine = useFieldResource<AgentPublic>("/agents/mine");
  const [feedback, setFeedback] = useState("");
  const [manual, setManual] = useState(false);
  const code = mine.data?.dm_code;
  return <section className="dm-code"><h3>{uiText("我的私訊碼")}</h3><p>{mine.data?.dm_code_public === true ? uiText("這組碼目前已公開在居民名錄；可從艙室的鏡子關閉公開。") : mine.data?.dm_code_public === false ? uiText("這組碼目前未公開在居民名錄；已拿到碼的人仍能私訊。") : uiText("可從艙室的鏡子設定是否將私訊碼放在居民名錄上。")}</p>
    {mine.loading && <p role="status">{uiText("正在讀取…")}</p>}
    {mine.error && <><p role="alert">{mine.error.status === 404 ? uiText("領養室友後才有自己的私訊碼。") : uiText(mine.error.message)}</p>{mine.error.status === 404 ? <Link to="/adopt">{uiText("前往領養")}</Link> : <button type="button" onClick={mine.refresh}>{uiText("重新讀取")}</button>}</>}
    {code ? <><div className="field-actions"><code>{code}</code><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(code); setFeedback("私訊碼已複製。"); setManual(false); } catch { setManual(true); setFeedback("請長按下方文字複製。"); } }}>{uiText("複製私訊碼")}</button></div>{manual && <label>{uiText("手動複製")}<input value={code} readOnly onFocus={e => e.currentTarget.select()} /></label>}</> : mine.data && <p>{uiText("私訊碼尚未建立，請重新讀取；若持續未出現，請聯絡管理員。")}</p>}
    <p role="status">{uiText(feedback)}</p>
  </section>;
}
