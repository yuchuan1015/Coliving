import { uiText, getUiLanguage } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { CabinUtilityShell, CabinUtilityEmpty } from "../components/CabinUtilityShell";
import { useEffect, useState } from "react";
import {
  deleteDrawerItem,
  getDrawerItems,
  storeDrawerItem,
  type DrawerItem,
} from "../api/furniture";

export function DrawerPage() {
  useUiLanguage();
  const [items, setItems] = useState<DrawerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    getDrawerItems()
      .then(setItems)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleStore() {
    if (!label.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const item = await storeDrawerItem({
        label: label.trim(),
        content: content.trim(),
        category: category.trim() || undefined,
      });
      setItems((prev) => [item, ...prev]);
      setLabel("");
      setContent("");
      setCategory("");
      setComposing(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteDrawerItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      if (expanded === id) setExpanded(null);
    } catch (err) {
      console.error(err);
    }
  }


  return <CabinUtilityShell title={uiText("抽屜")} code="DRAWER">
    <div className="utility-toolbar"><h2>{uiText("抽屜裡的物件")}</h2>{!composing && <button className="photo-primary" onClick={() => setComposing(true)}>{uiText("＋ 放東西進去")}</button>}</div>
    {composing && <section className="photo-panel" aria-label={uiText("存放物件")}>
      <h2>{uiText("放進抽屜")}</h2>
      <div className="utility-form">
        <label>{uiText("物品名稱")}<input value={label} onChange={e => setLabel(e.target.value)} placeholder={uiText("物品名稱")} autoFocus /></label>
        <label>{uiText("內容或描述")}<textarea value={content} onChange={e => setContent(e.target.value)} placeholder={uiText("內容或描述…")} rows={5} /></label>
        <label>{uiText("分類（選填）")}<input value={category} onChange={e => setCategory(e.target.value)} placeholder={uiText("替物件留個分類")} /></label>
        <div className="utility-actions">
          <button className="photo-primary" onClick={handleStore} disabled={saving || !label.trim() || !content.trim()}>{saving ? uiText("存入中…") : uiText("放進抽屜")}</button>
          <button onClick={() => { setComposing(false); setLabel(""); setContent(""); setCategory(""); }}>{uiText("取消")}</button>
        </div>
      </div>
    </section>}
    {loading ? <CabinUtilityEmpty title={uiText("正在打開抽屜…")} loading /> : items.length === 0 ?
      <CabinUtilityEmpty title={uiText("抽屜是空的")}>{uiText("從上方放入一件想留下的物品。")}</CabinUtilityEmpty> :
      <section className="utility-list" aria-label={uiText("抽屜物件")}>{items.map(item =>
        <article className="photo-panel utility-entry" key={item.id}>
          <button className="utility-entry-toggle" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>
            <span className="utility-entry-copy"><span className="utility-entry-title">{item.label}</span><span className="utility-meta">{item.category && `${item.category} · `}{new Date(item.created_at).toLocaleDateString(getUiLanguage())}</span></span>
            <span className="utility-chevron" aria-hidden="true">{expanded === item.id ? "−" : "＋"}</span>
          </button>
          {expanded === item.id && <div className="utility-entry-detail">
            <p className="utility-body">{item.content}</p>
            <div className="utility-actions"><button className="utility-danger" onClick={() => handleDelete(item.id)}>{uiText("丟掉")}</button></div>
          </div>}
        </article>
      )}</section>}
  </CabinUtilityShell>;
}
