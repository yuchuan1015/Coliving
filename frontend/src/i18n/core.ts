import simplified from "./zh-CN.json";
import templates from "./templates.json";

export type UiLanguage = "zh-TW" | "zh-CN";
export const LANGUAGE_KEY = "rookery-ui-language";
const dictionary: Readonly<Record<string, string>> = simplified;
const listeners = new Set<() => void>();
export function resolveLanguage(saved: unknown, preferred: readonly string[] = []): UiLanguage {
  if (saved === "zh-TW" || saved === "zh-CN") return saved;
  for (const value of preferred) {
    const tag = value.toLowerCase().replaceAll("_", "-");
    if (!/^zh(?:-|$)/.test(tag)) continue;
    if (tag.includes("-hant")) return "zh-TW";
    if (tag.includes("-hans")) return "zh-CN";
    if (/(?:^|-)(tw|hk|mo)(?:-|$)/.test(tag)) return "zh-TW";
    if (/(?:^|-)(cn|sg|my)(?:-|$)/.test(tag)) return "zh-CN";
  }
  return "zh-TW";
}
function initialLanguage(): UiLanguage {
  let saved: string | null = null;
  try { saved = window.localStorage.getItem(LANGUAGE_KEY); } catch { /* Device storage may be unavailable. */ }
  return resolveLanguage(saved, typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language ?? ""]);
}
let language: UiLanguage = initialLanguage();
export const getUiLanguage = () => language;
export const subscribeLanguage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setUiLanguage(value: UiLanguage): boolean {
  if (value !== "zh-TW" && value !== "zh-CN") return false;
  let persisted = false;
  try { window.localStorage.setItem(LANGUAGE_KEY, value); persisted = true; } catch { /* Selection still works for this tab. */ }
  if (language !== value) { language = value; for (const listener of listeners) listener(); }
  return persisted;
}
// Only call at explicitly reviewed interface-text boundaries. Never wrap user
// names, authored content, input values, API payloads, IDs, URLs or credentials.
export function translateUi(source: string, locale: UiLanguage): string {
  if (locale !== "zh-CN") return source;
  if (Object.hasOwn(dictionary, source)) return dictionary[source]!;
  // App-owned notices can contain an untouched name, count or timestamp.
  // Match only generated, anchored literal segments; never translate captures.
  // Linear indexOf matching avoids regular expressions built from resident text.
  if (source.length > 4000) return source;
  for (const parts of templates) {
    const first = parts[0]!, last = parts[parts.length - 1]!;
    if (!source.startsWith(first) || !source.endsWith(last) || source.length < first.length + last.length) continue;
    let cursor = first.length, rendered = dictionary[first] ?? first, matches = true;
    for (let index = 1; index < parts.length; index++) {
      const part = parts[index]!;
      const next = index === parts.length - 1 ? source.length - part.length : source.indexOf(part, cursor);
      if (next < cursor) { matches = false; break; }
      rendered += source.slice(cursor, next) + (dictionary[part] ?? part);
      cursor = next + part.length;
    }
    if (matches && cursor === source.length) return rendered;
  }
  return source;
}
export function uiOptions(options: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(options).map(([key, label]) => [key, uiText(label)]));
}
export function uiText(source: string | null | undefined): string;
export function uiText(source: TemplateStringsArray, ...values: unknown[]): string;
export function uiText(source: string | null | undefined | TemplateStringsArray, ...values: unknown[]): string {
  if (source == null) return "";
  if (typeof source === "string") return translateUi(source, language);
  return source.map((part, index) => translateUi(part, language) + (index < values.length ? String(values[index] ?? "") : "")).join("");
}
