// Non-browser contract tests. No DOM, no server, no real account or API writes.
// Transpile the actual TSX, inspect its element tree, and exercise its callbacks
// with controlled hooks and API fixtures. This is not a browser/E2E substitute.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
let active, fixtures, reads, calls, auth, answer, writeResult, tokens, routeParams;
const navigateStub = (...args) => calls.push({ method: "navigate", args });
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const jsxRuntime = { jsx, jsxs: jsx, Fragment: Symbol("Fragment") };
const equalDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const react = {
  useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
  useState(initial) {
    const h = active, i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial;
    return [h.slots[i], value => { h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value; }];
  },
  useRef(initial) { const h = active, i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useCallback(fn, deps) { const h = active, i = h.cursor++; if (!equalDeps(h.slots[i]?.deps, deps)) h.slots[i] = { fn, deps }; return h.slots[i].fn; },
  useEffect(effect, deps) {
    const h = active, i = h.cursor++;
    if (!equalDeps(h.slots[i]?.deps, deps)) { h.pending.push(() => { h.slots[i]?.cleanup?.(); h.slots[i] = { deps, cleanup: effect() }; }); }
  },
  useId() { return "test-label"; },
  createContext(value) { return { value, Provider: function Provider() {} }; },
  useContext(context) { return context.value; },
};
const timers = new Map();
const windowEvents = new Map(), documentEvents = new Map();
const events = registry => ({
  addEventListener(name, fn) { if (!registry.has(name)) registry.set(name, new Set()); registry.get(name).add(fn); },
  removeEventListener(name, fn) { registry.get(name)?.delete(fn); },
});
const emit = (registry, name) => { for (const fn of registry.get(name) ?? []) fn(); };
const windowStub = { location: { origin: "https://example.test", pathname: "/", search: "", replace: value => calls.push({ method: "redirect", args: [value] }) }, setInterval: () => 1, clearInterval() {}, ...events(windowEvents), clearTimeout: id => timers.delete(id), setTimeout: (fn, delay) => { const id = timers.size + 1; timers.set(id, { fn, delay }); return id; }, matchMedia: () => ({ matches: true }) };
windowStub.scrollTo = () => {};
const sessionValues = new Map();
const sessionStorageStub = { getItem: key => sessionValues.get(key) ?? null, setItem: (key, value) => sessionValues.set(key, value) };
const documentStub = { hidden: false, activeElement: null, ...events(documentEvents) };
const navigatorStub = { clipboard: { writeText: async value => { calls.push({ method: "copy", args: [value] }); } } };
class TestFormData extends FormData {
  constructor(source) { super(); if (source) for (const [key, value] of source) this.append(key, value); }
}
const api = Object.fromEntries(["get", "post", "patch", "delete", "request"].map(method => [method, async (...args) => {
  calls.push({ method, args });
  return answer ? answer(method, ...args) : { data: writeResult };
}]));
const clientExports = { default: api, getAccessToken: () => tokens?.[0] ?? null, clearTokens: () => { tokens = null; }, setTokens: (...value) => { tokens = value; } };
function fixtureResource(path) {
  if (path) reads.push(path);
  return { data: path ? fixtures.get(path)?.data : undefined, error: path ? fixtures.get(path)?.error : undefined, loading: !!path && !fixtures.has(path), refresh() { if (path) reads.push(`refresh:${path}`); } };
}
const moduleCache = new Map();
function load(relative) {
  const path = resolve(root, relative);
  if (moduleCache.has(path)) return moduleCache.get(path).exports;
  const module = { exports: {} }; moduleCache.set(path, module);
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  function localRequire(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "react-router-dom") return { Link: function Link() {}, Navigate: function Navigate() {}, Outlet: function Outlet() {}, useLocation: () => windowStub.location, useNavigate: () => navigateStub, useParams: () => routeParams };
    if (name.endsWith("/api/client") || name === "./client") return { __esModule: true, ...clientExports };
    if (name.endsWith("/hooks/useAuth") || (name === "./useAuth" && path.endsWith("/hooks/usePublicGarden.ts"))) return { useAuth: () => auth };
    if (name.endsWith(".css")) return {};
    if (name.endsWith(".json")) return JSON.parse(readFileSync(resolve(dirname(path), name), "utf8"));
    if (!name.startsWith(".")) return require(name);
    const resolved = resolve(dirname(path), name);
    const filename = [resolved, resolved + ".ts", resolved + ".tsx"].find(p => existsSync(p));
    if (!filename) throw Error(`Unresolved test import ${name}`);
    const value = load(filename);
    return filename.endsWith("/fields/fieldData.ts") ? { ...value, useFieldResource: fixtureResource } : value;
  }
  new Function("require", "module", "exports", "window", "document", "FormData", "sessionStorage", "navigator", code)(localRequire, module, module.exports, windowStub, documentStub, TestFormData, sessionStorageStub, navigatorStub);
  return module.exports;
}
function mount(component, props = {}) {
  const h = { slots: [], cursor: 0, pending: [], tree: null,
    render() { active = h; h.cursor = 0; h.pending = []; h.tree = component(props); active = null; return h.tree; },
    effects() { for (const effect of h.pending) effect(); h.pending = []; },
    dispose() { for (const slot of h.slots) slot?.cleanup?.(); },
  };
  h.render(); return h;
}
function nodes(tree, predicate) {
  if (tree == null || typeof tree === "boolean") return [];
  if (Array.isArray(tree)) return tree.flatMap(n => nodes(n, predicate));
  if (typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate), ...nodes(tree.props?.action, predicate)];
}
function text(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree !== "object") return String(tree);
  return text(tree.props?.children);
}
const components = (h, name) => nodes(h.tree, n => n.type?.name === name);
function one(h, name, predicate = () => true) { const found = components(h, name).filter(predicate); assert.equal(found.length, 1, `Expected one ${name}`); return found[0]; }
function button(h, label) { const found = nodes(h.tree, n => n.type === "button" && text(n) === label); assert.equal(found.length, 1, `Expected button ${label}`); return found[0]; }
function click(h, label) { const b = button(h, label); assert.ok(!b.props.disabled, `${label} disabled`); b.props.onClick(); h.render(); }
function tab(h, value, index = 0) { components(h, "FieldTabs")[index].props.onChange(value); h.render(); }
const form = (h, label) => one(h, "FieldForm", f => f.props.label === label);
function data(entries) { const result = new FormData(); for (const [k, v] of Object.entries(entries)) for (const part of Array.isArray(v) ? v : [v]) result.append(k, String(part)); return result; }
async function submit(h, label, entries, done = false) { const f = form(h, label); await f.props.submit(data(entries)); if (done) { f.props.onDone(); h.render(); } }
function expectCall(method, path, payload) {
  const c = calls.at(-1); assert.equal(c?.method, method);
  if (method === "request") { assert.equal(c.args[0].url, path); if (payload) assert.deepEqual(c.args[0].data, payload); }
  else { assert.equal(c?.args[0], path); if (payload) assert.deepEqual(c.args[1], payload); }
}
const fixture = (path, value) => fixtures.set(path, { data: value });
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const fieldData = load("src/fields/fieldData.ts");
const shared = load("src/fields/shared.tsx");
const everyday = load("src/fields/EverydayFields.tsx");
const content = load("src/fields/ContentFields.tsx");
const activity = load("src/fields/ActivityFields.tsx");
const { PlazaField } = load("src/fields/PlazaField.tsx");
const { BirthYearSettings } = load("src/components/BirthYearSettings.tsx");
const { buildGameAction, ACTION_LABELS } = load("src/fields/gameActions.ts");
const language = load("src/i18n/core.ts");
const languageStorage = new Map();
beforeEach(() => {
  languageStorage.clear();
  windowStub.localStorage = { getItem: key => languageStorage.get(key) ?? null, setItem: (key, value) => languageStorage.set(key, value) };
  language.setUiLanguage("zh-TW"); languageStorage.clear();
  documentStub.documentElement = { lang: "zh-TW" };
  fixtures = new Map(); reads = []; calls = []; writeResult = {}; answer = null; tokens = null; routeParams = {};
  sessionValues.clear();
  windowEvents.clear(); documentEvents.clear(); documentStub.hidden = false;
  timers.clear(); windowStub.location.pathname = "/"; windowStub.location.search = ""; windowStub.location.hash = ""; documentStub.activeElement = null; delete windowStub.location.href;
  navigatorStub.clipboard = { writeText: async value => { calls.push({ method: "copy", args: [value] }); } };
  auth = { user: { id: "me", role: "resident", birth_year: null },
    updateBirthYear: async year => { calls.push({ method: "birth", args: [year] }); auth.user.birth_year = year; },
    refreshUser: async () => { calls.push({ method: "profile", args: [] }); return auth.user; },
  };
});

const { clockHandAngles, clockDialSize } = load("src/data/cabin-clock.ts");
const guide = load("src/data/guide.ts");
const { GuidePage } = load("src/pages/GuidePage.tsx");
const guideEntries = h => nodes(h.tree, n => n.type === "details" && n.props.className === "photo-panel guide-entry");
function findGuide(h, query) { nodes(h.tree, n => n.props.id === "guide-search")[0].props.onChange({ target: { value: query } }); h.render(); }
test("language prefers explicit choice, detects Chinese scripts, and keeps non-Chinese fallback Traditional", () => {
  for (const tag of ["zh-CN", "zh-SG", "zh-MY", "zh-Hans", "zh-Hans-HK", "zh_cn"]) assert.equal(language.resolveLanguage(null, [tag]), "zh-CN", tag);
  for (const tag of ["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-CN", "en-US", "fr", "zh"]) assert.equal(language.resolveLanguage(null, [tag]), "zh-TW", tag);
  assert.equal(language.resolveLanguage("zh-TW", ["zh-CN"]), "zh-TW");
  assert.equal(language.resolveLanguage("zh-CN", ["zh-TW"]), "zh-CN");
  assert.equal(language.resolveLanguage("not-a-locale", ["en", "zh-CN"]), "zh-CN");
});
test("language saves only its device preference, not account or authentication fields", () => {
  assert.equal(language.setUiLanguage("zh-CN"), true);
  assert.deepEqual([...languageStorage], [[language.LANGUAGE_KEY, "zh-CN"]]);
  assert.equal(language.setUiLanguage("en"), false);
  assert.equal(language.getUiLanguage(), "zh-CN");
  assert.deepEqual(calls, []); assert.deepEqual(reads, []);
});
test("language subscribers update once, unsubscribe cleanly and survive blocked storage", () => {
  let updates = 0; const stop = language.subscribeLanguage(() => updates++);
  windowStub.localStorage = { setItem() { throw Error("blocked"); } };
  assert.equal(language.setUiLanguage("zh-CN"), false); assert.equal(updates, 1);
  language.setUiLanguage("zh-CN"); assert.equal(updates, 1);
  stop(); language.setUiLanguage("zh-TW"); assert.equal(updates, 1);
});
test("language control keeps native self-names and announces temporary-only preference", () => {
  const h = mount(load("src/i18n/LanguageControl.tsx").LanguageControl);
  const select = nodes(h.tree, n => n.type === "select")[0];
  assert.deepEqual(nodes(select, n => n.type === "option").map(n => [n.props.value, text(n)]), [["zh-TW", "繁體中文"], ["zh-CN", "简体中文"]]);
  windowStub.localStorage = { setItem() { throw Error("blocked"); } };
  select.props.onChange({ target: { value: "zh-CN" } }); h.render();
  assert.match(text(h.tree), /界面语言/); assert.match(text(h.tree), /无法保存偏好/);
  assert.deepEqual(calls, []);
});
test("language updates document lang without navigation or remount keys", () => {
  const h = mount(load("src/i18n/LanguageControl.tsx").LanguageDocument); h.effects();
  assert.equal(documentStub.documentElement.lang, "zh-TW");
  language.setUiLanguage("zh-CN"); h.render(); h.effects();
  assert.equal(documentStub.documentElement.lang, "zh-CN"); assert.deepEqual(calls, []); h.dispose();
  assert.doesNotMatch(readFileSync(resolve(root, "src/App.tsx"), "utf8"), /key=\{(?:language|locale)/);
});
test("UI conversion uses source text, reverses exactly and preserves interpolated resident names", () => {
  language.setUiLanguage("zh-CN");
  assert.equal(language.uiText("回到你的艙室"), "回到你的舱室");
  assert.equal(language.uiText("帳號"), "账号");
  assert.equal(language.uiText("設定"), "设置");
  const resident = "圖書館";
  const template = Object.assign(["查看", ""], { raw: ["查看", ""] });
  assert.equal(language.uiText(template, resident), "查看圖書館");
  assert.equal(language.uiText(null), ""); assert.equal(language.uiText(undefined), "");
  assert.equal(language.uiText("__proto__"), "__proto__");
  assert.equal(language.uiText("全新未知錯誤：圖書館"), "全新未知錯誤：圖書館");
  language.setUiLanguage("zh-TW");
  assert.equal(language.uiText("帳號"), "帳號");
});
test("generated notice templates translate only surrounding UI, never resident captures", () => {
  language.setUiLanguage("zh-CN");
  assert.equal(language.uiText("已撤銷「圖書館」的這筆授權。"), "已撤销「圖書館」的这笔授权。");
  assert.equal(language.uiText("已撤銷「圖書館」的這筆授權。後記"), "已撤銷「圖書館」的這筆授權。後記");
  language.setUiLanguage("zh-TW");
  assert.equal(language.uiText("已撤銷「圖書館」的這筆授權。"), "已撤銷「圖書館」的這筆授權。");
});
test("Simplified guide copies localized template and status without sending mail", async () => {
  language.setUiLanguage("zh-CN");
  const h = mount(GuidePage); h.effects();
  await button(h, language.uiText("複製報錯格式")).props.onClick(); h.render();
  assert.equal(calls.length, 1); expectCall("copy", guide.bugReportTemplate("zh-CN"));
  assert.match(text(h.tree), /已复制报错格式，尚未寄出邮件/);
  language.setUiLanguage("zh-TW"); h.render();
  assert.match(text(h.tree), /已複製報錯格式，尚未寄出郵件/); h.dispose();
});
test("login language change preserves typed credentials and sends no request", () => {
  const h = mount(load("src/pages/LoginPage.tsx").LoginPage);
  const input = type => nodes(h.tree, n => n.type === "input" && n.props.autoComplete === type)[0];
  input("username").props.onChange({ target: { value: "圖書館" } });
  input("current-password").props.onChange({ target: { value: "test-only-繁體" } }); h.render();
  language.setUiLanguage("zh-CN"); h.render();
  assert.match(text(h.tree), /回到你的舱室/);
  assert.equal(input("username").props.value, "圖書館");
  assert.equal(input("current-password").props.value, "test-only-繁體");
  assert.deepEqual(calls, []);
});
test("registration language change preserves invite code, name, year and unsaved form", () => {
  const h = mount(load("src/pages/RegisterPage.tsx").RegisterPage);
  const input = id => nodes(h.tree, n => n.props.id === id)[0];
  for (const [id, value] of [["register-invite-code", "TESTONLY"], ["register-display-name", "圖書館"], ["register-birth-year", "1999"]]) input(id).props.onChange({ target: { value } });
  h.render(); language.setUiLanguage("zh-CN"); h.render();
  assert.match(text(h.tree), /入住你的舱室/);
  assert.equal(input("register-display-name").props.value, "圖書館");
  assert.equal(input("register-invite-code").props.value, "TESTONLY");
  assert.equal(input("register-birth-year").props.value, "1999"); assert.deepEqual(calls, []);
});
test("Simplified guide covers all 31 entries, searches either script and keeps planet routes", () => {
  const cn = guide.searchGuide("", "all", "zh-CN");
  assert.equal(cn.length, 31);
  assert.equal(cn.find(a => a.id === "field-library").title, "Arcturus · 图书馆");
  assert.equal(cn.find(a => a.id === "field-library").link.to, "/library");
  assert.ok(guide.searchGuide("浏览器", "all", "zh-CN").length > 0);
  assert.ok(guide.searchGuide("瀏覽器", "all", "zh-CN").length > 0);
  assert.deepEqual(guide.searchGuide("相框", "all", "zh-CN").map(a => a.id), guide.searchGuide("相框", "all", "zh-TW").map(a => a.id));
  assert.equal(guide.GUIDE_ARTICLES.find(a => a.id === "field-library").title, "Arcturus · 圖書館");
});
test("guide query and category stay selected across language changes", () => {
  const h = mount(GuidePage); findGuide(h, "413");
  const ids = guideEntries(h).map(n => n.key);
  language.setUiLanguage("zh-CN"); h.render();
  assert.equal(nodes(h.tree, n => n.props.id === "guide-search")[0].props.value, "413");
  assert.deepEqual(guideEntries(h).map(n => n.key), ids); assert.match(text(h.tree), /相关说明/);
});
test("Simplified bug-report draft keeps approved address and excludes automatic user data", () => {
  const url = new URL(guide.bugReportMailto("zh-CN"));
  assert.equal(url.pathname, "therookery1108@outlook.com");
  assert.equal(url.searchParams.get("subject"), "鸦巢 Bug 报错");
  assert.match(url.searchParams.get("body"), /发生时间/);
  assert.doesNotMatch(url.searchParams.get("body"), /preview-user|test-only|coliving_access/);
  assert.deepEqual([...url.searchParams.keys()], ["subject", "body"]);
});
test("Simplified navigation localizes destinations but never changes route identifiers", () => {
  language.setUiLanguage("zh-CN");
  const h = mount(load("src/pages/DashboardPage.tsx").DashboardPage);
  assert.match(text(h.tree), /图书馆/); assert.match(text(h.tree), /邮驿/);
  assert.equal(nodes(h.tree, n => n.props.className === "ya-destination-row").length, 13);
  assert.deepEqual(calls, []);
});
test("UI option labels do not rewrite values or resident names", () => {
  language.setUiLanguage("zh-CN");
  assert.deepEqual(language.uiOptions({ library: "圖書館", mail: "郵驛" }), { library: "图书馆", mail: "邮驿" });
  const h = mount(shared.FieldSelect, { name: "to_agent_id", label: "收件室友", options: { recipient: "圖書館" } });
  const option = nodes(h.tree, n => n.type === "option")[0];
  assert.equal(option.props.value, "recipient"); assert.equal(text(option), "圖書館");
});
test("Simplified library keeps resident-authored titles, author and source untouched", () => {
  language.setUiLanguage("zh-CN");
  fixture("/library/works?limit=50&offset=0", [{ id: "work", title: "圖書館", author_name: "資料更新", source: "繁體原創", category: "other", word_count: 5 }]);
  const h = mount(content.LibraryField);
  assert.match(text(h.tree), /圖書館/); assert.match(text(h.tree), /資料更新/); assert.match(text(h.tree), /繁體原創/);
  assert.equal(nodes(h.tree, n => n.type === "h3")[0].props.children, "圖書館");
});
test("changing interface language never changes the community time zone", () => {
  language.setUiLanguage("zh-CN");
  assert.equal(fieldData.fieldTime("2026-09-09T18:00:00Z"), new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(new Date("2026-09-09T18:00:00Z")));
});
test("intimacy center rename preserves the adult route, Antares coordinates and cover asset", () => {
  assert.deepEqual(fieldData.FIELDS.find(row => row[0] === "adult"), ["adult", "Antares", "分級式人機親密關係中心", 351.9, 15.1, 550, "sleep-capsule-realistic.png"]);
  const entry = guide.GUIDE_ARTICLES.find(article => article.id === "field-adult");
  assert.equal(entry.title, "Antares · 分級式人機親密關係中心");
  assert.equal(entry.link.to, "/adult");
  assert.ok(!entry.summary.includes("導航目前標示"));
  assert.match(entry.notice, /最低開放年齡為 12 歲/);
});
test("renamed destination and transition use the selected UI language but navigate to adult", () => {
  for (const locale of ["zh-TW", "zh-CN"]) {
    language.setUiLanguage(locale);
    const expected = locale === "zh-TW" ? "分級式人機親密關係中心" : "分级式人机亲密关系中心";
    const h = mount(load("src/pages/DashboardPage.tsx").DashboardPage); h.effects();
    const card = nodes(h.tree, n => n.type === "button" && n.props.className === "ya-destination-row" && text(n).includes(expected));
    assert.equal(card.length, 1); card[0].props.onClick(); h.render();
    const transition = nodes(h.tree, n => n.props.className === "ya-jump-transition")[0];
    assert.ok(text(transition).includes(expected));
    [...timers.values()].at(-1).fn(); expectCall("navigate", "/adult");
    assert.ok(guide.searchGuide(expected, "fields", locale).some(article => article.id === "field-adult")); h.dispose();
  }
});
test("legacy public prototype also shows the renamed center without changing its entry id", () => {
  const html = readFileSync(resolve(root, "public/field-preview/adult.html"), "utf8");
  const data = readFileSync(resolve(root, "public/field-preview/data.js"), "utf8");
  assert.ok(html.includes("鴉巢 · 分級式人機親密關係中心"));
  assert.ok(html.includes('data-page="adult"'));
  assert.ok(data.includes('"zone": "分級式人機親密關係中心"'));
  assert.ok(!/成人區|成人区/.test(html + data));
});

test("guide covers each real destination exactly once without inventing paths or planet names", () => {
  const fields = guide.GUIDE_ARTICLES.filter(article => article.category === "fields");
  assert.equal(fields.length, 12);
  assert.deepEqual(fields.map(article => [article.id, article.title, article.link.to]), fieldData.FIELDS.map(([id, star, name]) => [`field-${id}`, `${star} · ${name}`, `/${id}`]));
  assert.equal(new Set(guide.GUIDE_ARTICLES.map(article => article.id)).size, guide.GUIDE_ARTICLES.length);
  const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  for (const article of guide.GUIDE_ARTICLES) {
    assert.ok(article.title && article.summary && article.paragraphs.length);
    if (article.link) { assert.ok(app.includes(`path="${article.link.to}"`), article.link.to); assert.ok(!article.link.to.includes("/agent/edit")); }
  }
});
test("frontier follows plaza with the approved Procyon coordinates and shared cover", () => {
  assert.deepEqual(fieldData.FIELDS.map(row => row[0]), ["ai-chat", "plaza", "frontier", "mail", "workshop", "library", "museum", "weilan", "health", "park", "history", "adult"]);
  assert.deepEqual(fieldData.FIELDS.find(row => row[0] === "frontier"), ["frontier", "Procyon", "開荒", 213.7, 13, 11.5, "exterior-star-system.png"]);
});
test("guide finds Procyon and 開荒 in either script and keeps the frontier route", () => {
  for (const locale of ["zh-TW", "zh-CN"]) {
    for (const query of ["Procyon", "procyon", "開荒", "开荒"]) {
      const matches = guide.searchGuide(query, "fields", locale);
      assert.deepEqual(matches.map(article => article.id), ["field-frontier"], `${locale}: ${query}`);
      assert.equal(matches[0].link.to, "/frontier");
    }
  }
  assert.equal(guide.GUIDE_ARTICLES.find(article => article.id === "field-frontier").title, "Procyon · 開荒");
  assert.deepEqual(calls, []); assert.deepEqual(reads, []);
});
test("frontier guide states public farming readiness and leaves private access unconfirmed", () => {
  const entry = guide.GUIDE_ARTICLES.find(article => article.id === "field-frontier");
  assert.ok(entry);
  assert.match(entry.summary, /獨立公共星系入口/);
  const body = entry.paragraphs.join("");
  assert.match(body, /澆水、照顧與參與下一輪投票/);
  assert.match(body, /魚池、牧場與市場規劃中/);
  assert.match(body, /公共農田不在公園/);
  assert.match(body, /私人入口仍待確認/);
  assert.match(entry.notice, /魚池、牧場與市場尚未開放/);
});
function frontierTrack(h) {
  const node = nodes(h.tree, n => n.props.id === "frontier-track")[0];
  const scrolls = [];
  const element = { clientWidth: 358, scrollLeft: 0, scrollTo(options) {
    scrolls.push(options); this.scrollLeft = options.left; node.props.onScroll({ currentTarget: this });
  } };
  node.props.ref.current = element;
  return { node, element, scrolls };
}
const frontierDots = h => nodes(h.tree, n => n.props.className === "frontier-dot");
test("frontier shows four swipeable future sites without API calls or invented game actions", () => {
  const { FrontierPage } = load("src/pages/FrontierPage.tsx");
  const h = mount(FrontierPage); h.effects();
  const track = frontierTrack(h);
  const choices = () => frontierDots(h);
  assert.equal(choices().length, 4);
  assert.match(text(h.tree), /Procyon/);
  assert.match(text(h.tree), /l 213\.7° · b \+13\.0° · 11\.5 ly/);
  const links = nodes(h.tree, n => n.props.to);
  assert.deepEqual(links.map(n => n.props.to), ["/outside", "/frontier/garden"]);
  for (const index of [1, 2, 3, 0]) {
    choices()[index].props.onClick(); h.render();
    assert.equal(track.scrolls.at(-1).left, index * track.element.clientWidth);
    assert.equal(track.scrolls.at(-1).behavior, "instant", "Honors reduced motion");
    assert.equal(choices().filter(n => n.props["aria-pressed"]).length, 1);
    assert.equal(choices()[index].props["aria-pressed"], true);
    const detail = nodes(h.tree, n => n.props.id === "frontier-site-detail")[0];
    assert.match(text(detail), index ? /規劃中.*尚未開放/ : /進入公共農田/);
    assert.deepEqual(nodes(detail, n => n.props.to).map(n => n.props.to), index ? [] : ["/frontier/garden"]);
  }
  assert.deepEqual(calls, []); assert.deepEqual(reads, []); assert.equal(timers.size, 0);
});
test("frontier fallback keeps all destinations and language switch preserves the selection", () => {
  const h = mount(load("src/pages/FrontierPage.tsx").FrontierPage);
  frontierTrack(h);
  frontierDots(h)[2].props.onClick(); h.render();
  nodes(h.tree, n => n.type === "img")[2].props.onError(); h.render();
  assert.match(text(h.tree), /星系圖片暫時無法載入/);
  assert.equal(frontierDots(h).length, 4);
  language.setUiLanguage("zh-CN"); h.render();
  assert.match(text(h.tree), /开荒/); assert.match(text(h.tree), /公共牧场/);
  assert.equal(frontierDots(h)[2].props["aria-pressed"], true);
  assert.deepEqual(calls, []);
});
test("frontier reuses the original garden dome without circle cropping or replacing the other three sites", () => {
  const { FRONTIER_GARDEN_IMAGE, FRONTIER_SYSTEM_IMAGE } = load("src/data/frontier.ts");
  assert.ok(existsSync(resolve(root, "public", FRONTIER_GARDEN_IMAGE.slice(1))));
  const h = mount(load("src/pages/FrontierPage.tsx").FrontierPage);
  const images = nodes(h.tree, n => n.type === "img");
  assert.deepEqual(images.map(n => n.props.src), [FRONTIER_GARDEN_IMAGE, ...Array(3).fill(FRONTIER_SYSTEM_IMAGE)]);
  assert.equal(images[0].props.style, undefined);
  assert.deepEqual([images[0].props.width, images[0].props.height], [1536, 1024]);
  assert.equal(images[0].props.className, "frontier-garden-image");
  images[0].props.onError(); h.render();
  assert.equal(nodes(h.tree, n => n.type === "img").length, 3, "A failed garden image must not blank the other destinations");
  assert.match(text(h.tree), /星系圖片暫時無法載入/);
  frontierTrack(h); frontierDots(h)[1].props.onClick(); h.render();
  assert.doesNotMatch(text(h.tree), /星系圖片暫時無法載入/);
  const css = readFileSync(resolve(root, "src/frontier.css"), "utf8");
  assert.match(css, /\.frontier-garden-window\s*\{[^}]*overflow: visible;[^}]*border-radius: 0;/);
  assert.match(css, /\.frontier-garden-image\s*\{[^}]*object-fit: contain/);
  assert.deepEqual(calls, []);
});
test("frontier garden sky fills only its own card and cannot intercept carousel controls", () => {
  const h = mount(load("src/pages/FrontierPage.tsx").FrontierPage);
  frontierTrack(h);
  const system = () => nodes(h.tree, n => n.type === "section" && n.props.className?.startsWith("frontier-system"))[0];
  const sky = nodes(h.tree, n => n.props.className === "frontier-card-sky")[0];
  assert.equal(String(sky.props["aria-hidden"]), "true");
  assert.match(sky.props.style.backgroundImage, /frontier-garden-dome\.webp/);
  assert.match(system().props.className, /is-garden-view/);
  frontierDots(h)[1].props.onClick(); h.render();
  assert.doesNotMatch(system().props.className, /is-garden-view/);
  frontierDots(h)[0].props.onClick(); h.render();
  assert.match(system().props.className, /is-garden-view/);
  nodes(h.tree, n => n.props.className === "frontier-garden-image")[0].props.onError(); h.render();
  assert.doesNotMatch(system().props.className, /is-garden-view/);
  const css = readFileSync(resolve(root, "src/frontier.css"), "utf8");
  assert.match(css, /\.frontier-card-sky\s*\{[^}]*inset: 0;[^}]*pointer-events: none;/);
  assert.match(css, /background-size: 100% 100%, 700% auto/);
  assert.match(css, /-webkit-mask-composite: source-in/);
  assert.match(css, /mask-composite: intersect/);
  assert.deepEqual(calls, []);
});
test("frontier native swipes synchronize detail and clamp Safari overscroll at both ends", () => {
  const h = mount(load("src/pages/FrontierPage.tsx").FrontierPage);
  const track = frontierTrack(h);
  for (const [position, expected] of [[358, 1], [716, 2], [1074, 3], [1500, 3], [-120, 0]]) {
    track.element.scrollLeft = position;
    track.node.props.onScroll({ currentTarget: track.element }); h.render();
    assert.equal(frontierDots(h).findIndex(n => n.props["aria-pressed"]), expected);
    assert.equal(nodes(h.tree, n => n.props.className === "frontier-slide" && !n.props["aria-hidden"]).length, 1);
    assert.match(text(nodes(h.tree, n => n.props.id === "frontier-site-detail")[0]), new RegExp(["公共農田", "公共魚池", "公共牧場", "市場"][expected]));
  }
  assert.deepEqual(calls, []);
});
test("frontier arrows, Home/End and dots support keyboard navigation without autoplay", () => {
  const h = mount(load("src/pages/FrontierPage.tsx").FrontierPage);
  const track = frontierTrack(h);
  const key = value => {
    let prevented = false;
    nodes(h.tree, n => n.props.id === "frontier-track")[0].props.onKeyDown({ key: value, preventDefault() { prevented = true; } });
    h.render(); return prevented;
  };
  assert.equal(nodes(h.tree, n => n.props["aria-label"] === "上一個據點")[0].props.disabled, true);
  assert.equal(key("ArrowRight"), true); assert.equal(track.element.scrollLeft, 358);
  assert.equal(key("End"), true); assert.equal(track.element.scrollLeft, 1074);
  assert.equal(nodes(h.tree, n => n.props["aria-label"] === "下一個據點")[0].props.disabled, true);
  assert.equal(key("ArrowRight"), true); assert.equal(track.element.scrollLeft, 1074);
  assert.equal(key("Home"), true); assert.equal(track.element.scrollLeft, 0);
  assert.equal(key("ArrowDown"), false); assert.equal(timers.size, 0);
  const matchMedia = windowStub.matchMedia;
  try {
    windowStub.matchMedia = () => ({ matches: false });
    frontierDots(h)[1].props.onClick();
    assert.equal(track.scrolls.at(-1).behavior, "smooth");
  } finally { windowStub.matchMedia = matchMedia; }
});
test("frontier resize preserves the selected slide and disconnects its observer", () => {
  let resize, disconnected = false;
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { constructor(fn) { resize = fn; } observe() {} disconnect() { disconnected = true; } };
  try {
    const h = mount(load("src/pages/FrontierPage.tsx").FrontierPage);
    const track = frontierTrack(h); h.effects();
    frontierDots(h)[2].props.onClick(); h.render();
    track.element.clientWidth = 480; resize(); h.render();
    assert.equal(track.element.scrollLeft, 960);
    assert.equal(frontierDots(h)[2].props["aria-pressed"], true);
    h.dispose(); assert.equal(disconnected, true);
  } finally { if (previous) globalThis.ResizeObserver = previous; else delete globalThis.ResizeObserver; }
});
test("frontier anchor geometry fits its unchanged image ratio and ships its own asset", () => {
  const { FRONTIER_SITES, FRONTIER_SYSTEM_IMAGE } = load("src/data/frontier.ts");
  assert.deepEqual(FRONTIER_SITES.map(site => site.id), ["garden", "fishery", "ranch", "market"]);
  assert.ok(existsSync(resolve(root, "public", FRONTIER_SYSTEM_IMAGE.slice(1))));
  for (const site of FRONTIER_SITES) {
    assert.ok(site.x - site.diameter / 2 > 0 && site.x + site.diameter / 2 < 100);
    assert.ok(site.y - site.diameter / 3 > 0 && site.y + site.diameter / 3 < 100);
    assert.equal("route" in site, false);
  }
  const css = readFileSync(resolve(root, "src/frontier.css"), "utf8");
  assert.match(css, /aspect-ratio: 2 \/ 3/); assert.match(css, /min-width: 44px/);
  assert.match(css, /:focus-visible/); assert.match(css, /prefers-reduced-motion/);
  assert.ok(!css.includes(":root"));
});
const gardenApi = load("src/api/garden.ts");
const { PublicGardenPage } = load("src/pages/PublicGardenPage.tsx");
const { usePublicGarden } = load("src/hooks/usePublicGarden.ts");
function publicGardenFixture(voting = false) {
  return { server_now: new Date().toISOString(), garden_time: "2026-01-19T00:00:00Z", garden_month: 1,
    actor: { kind: "user", id: "me", household_id: "test-household" }, public_area: { gross_m2: 667, productive_m2: 480 },
    crops: [{ id: "pak_choi", name: "小白菜" }, { id: "tomato", name: "番茄" }],
    plots: [{ id: "public:1", scope: "public", number: 1, crop_name: voting ? null : "小白菜",
      planting: voting ? null : { planting_id: "planting-one", crop_id: "pak_choi", status: "growing", health: 94, moisture: 34, nutrients: 78, needs: ["water"], random_problem: null },
      vote: voting ? { id: "vote-one", status: "open", closes_at: new Date(Date.now() + 12 * 3600000).toISOString(), candidates: ["pak_choi", "tomato"], counts: { pak_choi: 2, tomato: 1 }, my_vote: null } : null,
      allowed_actions: voting ? ["vote"] : ["water", "care"], contributors: [], care_logs: [] }],
  };
}
async function gardenMount(component = PublicGardenPage, snapshot = publicGardenFixture()) {
  answer = async method => ({ data: method === "get" ? structuredClone(snapshot) : { results: [{ ok: true, result: { plot: snapshot.plots[0], server_now: snapshot.server_now } }] } });
  const h = mount(component === usePublicGarden ? () => usePublicGarden() : component); h.effects(); await tick(); h.render(); return h;
}
test("public garden adapter uses authenticated garden endpoints and one exact action envelope", async () => {
  const controller = new AbortController();
  await gardenApi.publicGardenApi.read(controller.signal);
  expectCall("get", "/garden/public"); assert.equal(calls.at(-1).args[1].signal, controller.signal);
  const cmd = { plot_id: "public:1", action: "care", planting_id: "planting-one", request_id: "test-request" };
  await gardenApi.publicGardenApi.act(cmd); expectCall("post", "/garden/actions", { actions: [cmd] });
});
test("public garden rejects private plots, wrong owners and malformed scores or votes", () => {
  const valid = publicGardenFixture(); assert.equal(gardenApi.parsePublicGarden(valid, "me"), valid);
  for (const mutate of [s => { s.actor.id = "someone-else"; }, s => { s.actor.kind = "agent"; }, s => { s.plots[0].scope = "private"; }, s => { s.plots[0].planting.moisture = "34"; }, s => { s.plots[0].planting.health = 101; }, s => { delete s.plots[0].allowed_actions; }]) {
    const copy = structuredClone(valid); mutate(copy); assert.throws(() => gardenApi.parsePublicGarden(copy, "me"));
  }
  const v = publicGardenFixture(true); v.plots[0].vote.counts.tomato = -1;
  assert.throws(() => gardenApi.parsePublicGarden(v, "me"));
});
test("public garden builds only permitted water care and valid unexpired single-vote intents", () => {
  const plot = publicGardenFixture().plots[0], now = Date.now();
  assert.deepEqual(gardenApi.gardenCommand(plot, "water", "same-id", now), { plot_id: "public:1", action: "water", planting_id: "planting-one", request_id: "same-id" });
  plot.allowed_actions = []; assert.equal(gardenApi.gardenCommand(plot, "care", "id", now), null);
  const v = publicGardenFixture(true).plots[0];
  assert.deepEqual(gardenApi.gardenCommand(v, "vote", "id", now, "tomato"), { plot_id: "public:1", action: "vote", vote_id: "vote-one", crop_id: "tomato", request_id: "id" });
  assert.equal(gardenApi.gardenCommand(v, "vote", "id", now, "invented-crop"), null);
  assert.equal(gardenApi.gardenCommand(v, "vote", "id", Date.parse(v.vote.closes_at), "tomato"), null);
  v.vote.my_vote = { crop_id: "pak_choi" }; assert.equal(gardenApi.gardenCommand(v, "vote", "id", now, "tomato"), null);
});
test("public garden examines result.ok and does not count bare HTTP 200 as success", () => {
  assert.throws(() => gardenApi.parseGardenReceipt({}));
  assert.throws(() => gardenApi.parseGardenReceipt({ results: [{ ok: true }] }));
  assert.deepEqual(gardenApi.parseGardenReceipt({ results: [{ ok: false, error: { detail: "投票已變更", status_code: 409 } }] }), { ok: false, detail: "投票已變更", status: 409 });
});
test("public garden page shows scores and collapsed logs but no private warehouse or player harvest", async () => {
  const h = await gardenMount();
  assert.match(text(h.tree), /小白菜/); assert.match(text(h.tree), /需要澆水/);
  assert.deepEqual(nodes(h.tree, n => n.type === "meter").map(n => n.props.value), [94, 34, 78]);
  assert.equal(nodes(h.tree, n => n.type === "details")[0].props.open, undefined);
  assert.deepEqual(nodes(h.tree, n => n.props.to).map(n => n.props.to), ["/frontier"]);
  const buttons = nodes(h.tree, n => n.type === "button").map(text).join("|");
  assert.doesNotMatch(buttons, /採收|播種|倉庫|圖鑑|拔除|快轉|模擬/);
  const source = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  assert.match(source, /path="\/frontier\/garden" element={<PublicGardenPage \/>}/);
  assert.ok(source.indexOf('path="/frontier/garden"') > source.indexOf("<ProtectedRoute")); h.dispose();
});
test("public garden submits one write on double tap and refreshes authoritative GET afterward", async () => {
  const snapshot = publicGardenFixture(); const h = await gardenMount(usePublicGarden, snapshot);
  const post = deferred(); answer = async method => method === "post" ? post.promise : { data: snapshot };
  const submitAction = h.tree.submit; submitAction("public:1", "water"); submitAction("public:1", "water"); h.render();
  const writes = calls.filter(c => c.method === "post"); assert.equal(writes.length, 1);
  const cmd = writes[0].args[1].actions[0]; assert.equal(cmd.planting_id, "planting-one"); assert.ok(cmd.request_id);
  assert.deepEqual(Object.keys(cmd).sort(), ["action", "planting_id", "plot_id", "request_id"]); assert.equal(h.tree.busy, true);
  snapshot.plots[0].planting.moisture = 80;
  post.resolve({ data: { results: [{ ok: true, result: { plot: { stale: true }, server_now: snapshot.server_now } }] } });
  await tick(); await tick(); h.render(); assert.equal(h.tree.data.plots[0].planting.moisture, 80); assert.equal(h.tree.busy, false); h.dispose();
});
test("uncertain public garden write blocks new actions and reuses unchanged payload on retry", async () => {
  const h = await gardenMount(usePublicGarden); answer = async () => { throw new Error("connection lost"); };
  h.tree.submit("public:1", "care"); await tick(); h.render(); assert.ok(h.tree.uncertain);
  const first = calls.find(c => c.method === "post").args[1];
  h.tree.submit("public:1", "water"); assert.equal(calls.filter(c => c.method === "post").length, 1);
  h.tree.retry(); await tick(); h.render();
  assert.deepEqual(calls.filter(c => c.method === "post")[1].args[1], first); h.dispose();
});
test("public garden known business refusal stays visible, refreshes and never claims care success", async () => {
  const snapshot = publicGardenFixture(); const h = await gardenMount(usePublicGarden, snapshot);
  answer = async method => ({ data: method === "get" ? snapshot : { results: [{ ok: false, error: { detail: "本輪作物已更換", status_code: 409 } }] } });
  h.tree.submit("public:1", "care"); await tick(); h.render();
  assert.equal(h.tree.notice, "本輪作物已更換"); assert.equal(h.tree.uncertain, undefined);
  assert.ok(calls.filter(c => c.method === "get").length >= 2); h.dispose();
});
test("public garden account switch hides old data and ignores its late write result", async () => {
  const oldSnapshot = publicGardenFixture(); const h = await gardenMount(usePublicGarden, oldSnapshot);
  const post = deferred(); const next = publicGardenFixture(); next.actor.id = "other";
  answer = async method => method === "post" ? post.promise : { data: next };
  h.tree.submit("public:1", "care"); h.render();
  auth.user.id = "other"; h.render(); assert.equal(h.tree.data, undefined); h.effects(); await tick(); h.render();
  assert.equal(h.tree.data.actor.id, "other");
  post.resolve({ data: { results: [{ ok: true, result: { plot: oldSnapshot.plots[0], server_now: oldSnapshot.server_now } }] } });
  await tick(); h.render(); assert.equal(h.tree.data.actor.id, "other"); assert.equal(h.tree.notice, ""); h.dispose();
});
test("public garden read races, failures and authorization loss never retain stale action buttons", async () => {
  const h = await gardenMount(usePublicGarden); const slow = deferred(); let counter = 0;
  answer = async () => ++counter === 1 ? slow.promise : Promise.reject({ response: { status: 403 } });
  const first = h.tree.refresh(); const second = h.tree.refresh(); await second; h.render(); assert.equal(h.tree.data, undefined);
  slow.resolve({ data: publicGardenFixture() }); await first; h.render(); assert.equal(h.tree.data, undefined);
  assert.match(h.tree.error, /重新登入/); h.tree.submit("public:1", "care"); assert.equal(calls.filter(c => c.method === "post").length, 0); h.dispose();
});
test("public garden handles empty, unavailable and logged-out states without inventing a crop", async () => {
  const empty = publicGardenFixture(); empty.plots = []; const h = await gardenMount(PublicGardenPage, empty);
  assert.match(text(h.tree), /公共農田準備中/); assert.equal(nodes(h.tree, n => n.type === "meter").length, 0); h.dispose();
  auth.user = null; const loggedOut = mount(PublicGardenPage); calls = []; loggedOut.effects(); await tick(); loggedOut.render();
  assert.equal(calls.length, 0); assert.match(text(loggedOut.tree), /請先登入/); loggedOut.dispose();
});
test("public garden vote uses API candidates and a confirmation button, preserves one-vote receipt", async () => {
  const snapshot = publicGardenFixture(true); const h = await gardenMount(PublicGardenPage, snapshot);
  const panel = one(h, "PublicVotePanel"); let chosen;
  const props = { ...panel.props, submit: id => { chosen = id; } }; const vote = mount(panel.type, props);
  assert.equal(nodes(vote.tree, n => n.type === "input").length, 2); assert.match(text(vote.tree), /12 小時/);
  assert.equal(nodes(vote.tree, n => n.type === "button")[0].props.disabled, true);
  nodes(vote.tree, n => n.type === "input" && n.props.value === "tomato")[0].props.onChange(); vote.render();
  click(vote, "確認投給 番茄"); assert.equal(chosen, "tomato");
  props.plot = structuredClone(props.plot); props.plot.vote.my_vote = { crop_id: "tomato" }; vote.render();
  assert.match(text(vote.tree), /你已投給 番茄/); assert.equal(nodes(vote.tree, n => n.type === "button").length, 0); h.dispose(); vote.dispose();
});
test("public garden preview is synthetic, has no transports and preserves real candidate IDs", async () => {
  const { createGardenPreview } = load("scripts/frontier-preview/garden-preview.tsx");
  const gateway = createGardenPreview("growing"); const snapshot = await gateway.read(new AbortController().signal);
  gardenApi.parsePublicGarden(snapshot, "frontier-preview"); assert.equal(snapshot.plots[0].scope, "public");
  assert.ok(snapshot.plots[0].id.startsWith("preview-")); assert.equal(snapshot.crops.length, 12);
  const command = gardenApi.gardenCommand(snapshot.plots[0], "water", "test-preview-id", Date.now());
  const first = await gateway.act(command), second = await gateway.act(command);
  assert.deepEqual(second, first); assert.equal((await gateway.read(new AbortController().signal)).plots[0].contributors.length, 9);
  assert.equal(calls.length, 0);
  const source = readFileSync(resolve(root, "scripts/frontier-preview/garden-preview.tsx"), "utf8");
  assert.doesNotMatch(source, /\bfetch\(|axios|localStorage|sessionStorage|https:\/\//);
  assert.match(source, /示範資料 · 不會操作正式農田/);
});
test("public garden uses public-field blue surfaces with green accents and unchanged responsive support", () => {
  const css = readFileSync(resolve(root, "src/public-garden.css"), "utf8");
  assert.match(css, /--garden-bg:#05070d/); assert.match(css, /--garden-panel:#050f14/);
  assert.match(css, /--garden-edge:#39767d/); assert.match(css, /--garden-accent:#c1da91/);
  assert.match(css, /color-scheme:dark/);
  assert.doesNotMatch(css, /#0d1915|#17251d|#102017/);
  assert.match(css, /max-width:359px/); assert.match(css, /::-webkit-meter-optimum-value/);
  assert.match(css, /:focus-visible/); assert.doesNotMatch(css, /:root|(^|\n)(body|html)[{ ]/);
});
test("entering and returning from public garden starts at the top, updates do not scroll again", async () => {
  const previous = windowStub.scrollTo; const positions = [];
  windowStub.scrollTo = value => positions.push(value);
  try {
    const h = await gardenMount(); assert.deepEqual(positions, [{ top: 0, left: 0, behavior: "instant" }]);
    h.effects(); h.render(); assert.equal(positions.length, 1); h.dispose();
    const frontier = mount(load("src/pages/FrontierPage.tsx").FrontierPage); frontier.effects(); assert.equal(positions.length, 2); frontier.dispose();
  } finally { windowStub.scrollTo = previous; }
});
test("guide searches titles, full body, aliases, ASCII case and full-width inputs locally", () => {
  for (const [query, id] of [["SIRIUS", "field-plaza"], ["ｓｉｒｉｕｓ", "field-plaza"], ["头像", "mirror"], ["給室友的話", "mirror"], ["413", "upload-help"], ["工坊", "field-workshop"], ["Outlook", "contact"], ["隔離環境", "field-workshop"], ["分级式人机亲密关系中心", "field-adult"]]) {
    assert.ok(guide.searchGuide(query).some(article => article.id === id), query);
  }
  assert.equal(calls.length, 0);
});
test("guide search supports multiple keywords and category filtering without treating input as regex", () => {
  const matches = guide.searchGuide("頭像 2MB"); assert.ok(matches.some(a => a.id === "mirror"));
  assert.ok(matches.every(a => a.id === "mirror" || a.id === "upload-help"));
  assert.ok(guide.searchGuide("頭像", "fields").length === 0);
  assert.equal(guide.searchGuide("", "fields").length, 12);
  assert.equal(guide.searchGuide(" \n\t ").length, guide.GUIDE_ARTICLES.length);
  for (const input of ["[.*", "<script>alert(1)</script>", "不存在的功能abcdefgh"]) assert.deepEqual(guide.searchGuide(input), []);
});
test("guide surfaces the matching body excerpt and documents real current limitations", () => {
  const workshop = guide.GUIDE_ARTICLES.find(a => a.id === "field-workshop");
  assert.match(guide.guideExcerpt(workshop, "隔離環境"), /隔離環境/);
  assert.match(workshop.notice, /不會自動替換/);
  assert.match(guide.GUIDE_ARTICLES.find(a => a.id === "sleep").notice, /尚未接成可操作/);
  assert.match(guide.GUIDE_ARTICLES.find(a => a.id === "field-adult").notice, /不會跳過/);
  assert.match(guide.GUIDE_ARTICLES.find(a => a.id === "field-museum").paragraphs.join(""), /不是直接上傳/);
  assert.match(guide.GUIDE_ARTICLES.find(a => a.id === "usage-help").paragraphs.join(""), /不改成 0/);
});
test("guide renders real contents and does not read APIs, start timers or send reports on open", () => {
  const h = mount(GuidePage); h.effects(); h.render();
  assert.equal(h.tree.props.title, "導覽手冊"); assert.equal(guideEntries(h).length, 31);
  assert.equal(calls.length, 0); assert.equal(reads.length, 0); assert.equal(timers.size, 0);
  assert.ok(nodes(h.tree, n => n.props.id === "guide-search")[0].props["aria-describedby"]);
  assert.equal(nodes(h.tree, n => n.type === "summary").length, 32);
  h.dispose();
});
test("guide tabs and search work together; clearing text retains chosen category", () => {
  const h = mount(GuidePage); click(h, "場域介紹"); assert.equal(guideEntries(h).length, 12);
  findGuide(h, "Sirius"); assert.equal(guideEntries(h).length, 1); assert.match(text(h.tree), /找到 1 則相關說明/);
  click(h, "清除搜尋"); assert.equal(guideEntries(h).length, 12);
  assert.equal(button(h, "場域介紹").props["aria-pressed"], true);
  click(h, "基本功能"); assert.equal(guideEntries(h).length, 11);
  click(h, "問題排除"); assert.equal(guideEntries(h).length, 7);
});
test("no-result guide state can reset both filters or open contact without carrying stale query", () => {
  const h = mount(GuidePage); click(h, "場域介紹"); findGuide(h, "不可能找到的東西");
  assert.equal(guideEntries(h).length, 0); assert.match(text(h.tree), /沒有找到相關說明/);
  let focused = 0; nodes(h.tree, n => n.props.id === "guide-search")[0].props.ref.current = { focus() { focused++; } };
  click(h, "查看全部說明"); assert.equal(guideEntries(h).length, 31); assert.equal(focused, 1);
  findGuide(h, "再次找不到"); click(h, "前往 Bug 報錯");
  assert.equal(guideEntries(h).length, 1); assert.match(text(h.tree), /therookery1108@outlook\.com/);
  assert.equal(nodes(h.tree, n => n.props.id === "guide-search")[0].props.value, "");
});
test("bug draft has exact user-approved recipient and fixed encoded template with no account data", () => {
  assert.equal(guide.SUPPORT_EMAIL, "therookery1108@outlook.com");
  const draft = new URL(guide.BUG_REPORT_MAILTO);
  assert.equal(draft.protocol, "mailto:"); assert.equal(draft.pathname, guide.SUPPORT_EMAIL);
  assert.deepEqual([...draft.searchParams.keys()], ["subject", "body"]);
  assert.equal(draft.searchParams.get("subject"), "鴉巢 Bug 報錯");
  assert.equal(draft.searchParams.get("body"), guide.BUG_REPORT_TEMPLATE);
  for (const field of ["發生時間", "裝置與瀏覽器", "操作步驟", "預期", "實際", "遮蔽個資", "請勿附上密碼"]) assert.ok(guide.BUG_REPORT_TEMPLATE.includes(field));
  const h = mount(GuidePage);
  const link = nodes(h.tree, n => n.type === "a" && n.props.href?.startsWith("mailto:"))[0];
  assert.equal(link.props.href, guide.BUG_REPORT_MAILTO); assert.equal(link.props.onClick, undefined);
  assert.ok(!guide.BUG_REPORT_TEMPLATE.includes(auth.user.id)); assert.equal(calls.length, 0);
});
test("copy email and template report success only after clipboard resolves, never send email", async () => {
  const h = mount(GuidePage); h.effects(); const pending = deferred();
  navigatorStub.clipboard = { writeText: value => { calls.push({ method: "copy", args: [value] }); return pending.promise; } };
  const handler = button(h, "複製信箱").props.onClick; const first = handler(), second = handler(); h.render();
  assert.equal(calls.length, 1); assert.equal(calls[0].args[0], guide.SUPPORT_EMAIL);
  assert.equal(button(h, "複製信箱").props.disabled, true); assert.ok(!text(h.tree).includes("已複製信箱"));
  pending.resolve(); await Promise.all([first, second]); h.render(); assert.match(text(h.tree), /已複製信箱，尚未寄出郵件/);
  navigatorStub.clipboard = { writeText: async value => { calls.push({ method: "copy", args: [value] }); } };
  await button(h, "複製報錯格式").props.onClick(); h.render();
  assert.equal(calls.at(-1).args[0], guide.BUG_REPORT_TEMPLATE); assert.match(text(h.tree), /已複製報錯格式/);
  assert.ok(calls.every(c => c.method === "copy")); h.dispose();
});
test("denied or missing clipboard preserves visible selectable email and manual template", async () => {
  for (const clipboard of [undefined, { writeText: async () => { throw Error("Denied"); } }]) {
    navigatorStub.clipboard = clipboard; const h = mount(GuidePage); h.effects();
    await button(h, "複製信箱").props.onClick(); h.render();
    assert.match(text(h.tree), /無法自動複製/); assert.match(text(h.tree), /therookery1108@outlook\.com/);
    assert.equal(nodes(h.tree, n => n.type === "pre")[0].props.children, guide.BUG_REPORT_TEMPLATE);
    assert.equal(button(h, "複製信箱").props.disabled, false); assert.equal(calls.length, 0); h.dispose();
  }
});
test("late clipboard result cannot update a closed guide", async () => {
  const pending = deferred(); navigatorStub.clipboard = { writeText: () => pending.promise };
  const h = mount(GuidePage); h.effects(); const job = button(h, "複製信箱").props.onClick();
  h.dispose(); pending.resolve(); await job; h.render(); assert.ok(!text(h.tree).includes("已複製信箱"));
});
test("guide navigation is protected and FAB opens it without making avatar editable", async () => {
  const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  assert.ok(app.includes('path="/guide" element={<GuidePage />}'));
  assert.ok(app.indexOf('path="/guide"') > app.indexOf("<ProtectedRoute"));
  answer = async (_method, url) => ({ data: url === "/home/dashboard" ? { agents: [], community_status: {} } : url === "/home/furniture" ? { clock: {}, photo_frame: null } : [] });
  const h = mount(load("src/pages/HomePage.tsx").HomePage); h.effects(); await tick(); h.render();
  nodes(h.tree, n => n.props["aria-label"] === "展開快捷選單")[0].props.onClick(); h.render();
  assert.equal(nodes(h.tree, n => n.props.id === "cabin-fab-menu")[0].props.children.filter(Boolean).length, 5);
  click(h, "導覽手冊"); expectCall("navigate", "/guide");
  assert.equal(nodes(h.tree, n => n.props.id === "cabin-fab-menu").length, 0);
  assert.equal(nodes(h.tree, n => n.props.className === "cabin-agent-info")[0].props.onClick, undefined); h.dispose();
});
test("guide keeps search and report data local and does not advertise made-up support promises", () => {
  for (const file of ["src/data/guide.ts", "src/pages/GuidePage.tsx"]) {
    const source = readFileSync(resolve(root, file), "utf8");
    for (const forbidden of ["localStorage", "sessionStorage", "useAuth", "getMyAgent", "window.location", "location.href", "api.post", "fetch(", "dangerouslySetInnerHTML", "三個工作日", "24 小時內回覆"]) assert.ok(!source.includes(forbidden), forbidden);
  }
  const css = readFileSync(resolve(root, "src/cabin-home.css"), "utf8");
  assert.match(css, /\.cabin-fab-menu \{[^}]*max-height:[^}]*overflow-y: auto/);
});
const chatApi = load("src/api/chat.ts");
const { ChatUsageDialog, UsageSummary, UsageTotalCard } = load("src/components/ChatUsageDialog.tsx");
const { ChatPage, ChatSession } = load("src/pages/ChatPage.tsx");
const usageTotal = (overrides = {}) => ({ calls: 2, input_tokens: 1000, output_tokens: 100, total_tokens: 1100, missing_usage: 0, usage_partial: false, cost_usd: .001234, cost_partial: false, ...overrides });
const usageFixture = (overrides = {}) => ({ model: "fixture-model", provider: "test", prices_as_of: "2026-09-09", price_known: true, current_context_tokens: 400, this_reply: usageTotal(), conversation_total: usageTotal({ total_tokens: 3210 }), this_month: usageTotal({ total_tokens: 5550 }), ...overrides });

test("usage API reads only the selected agent, supports cancellation and preserves nullable zero", async () => {
  const value = usageFixture({ current_context_tokens: 0, conversation_total: null });
  answer = async () => ({ data: value }); const signal = new AbortController().signal;
  assert.deepEqual(await chatApi.getChatUsage("a/b", signal), value);
  assert.deepEqual(calls, [{ method: "get", args: ["/chat/a%2Fb/usage", { signal }] }]);
});
test("usage rejects malformed or outdated partial flags instead of inventing a complete estimate", async () => {
  for (const value of [null, {}, usageFixture({ current_context_tokens: undefined }), usageFixture({ price_known: null }), usageFixture({ this_reply: usageTotal({ usage_partial: undefined }) }), usageFixture({ this_month: usageTotal({ cost_partial: undefined }) }), usageFixture({ this_reply: usageTotal({ total_tokens: -1 }) }), usageFixture({ this_reply: usageTotal({ cost_usd: Infinity }) })]) {
    answer = async () => ({ data: value }); await assert.rejects(chatApi.getChatUsage("a"), /格式尚未同步/);
  }
});
test("three usage concepts stay separate; frontend never sums, subtracts or guesses capacity", () => {
  const h = mount(UsageSummary, { usage: usageFixture() });
  assert.match(text(h.tree), /目前上下文400 tokens/);
  assert.match(text(h.tree), /不是容量百分比/);
  const cards = components(h, "UsageTotalCard");
  assert.deepEqual(cards.map(c => [c.props.title, c.props.totals.total_tokens]), [["本次消耗", 1100], ["整窗累計", 3210], ["本月累計", 5550]]);
  assert.equal(nodes(h.tree, n => n.type === "progress").length, 0);
  const inconsistent = mount(UsageTotalCard, { title: "測試", totals: usageTotal({ input_tokens: 1, output_tokens: 2, total_tokens: 777 }), priceKnown: true });
  assert.match(text(inconsistent.tree), /777 tokens/);
});
test("unknown price hides all money even if a historical subtotal exists", () => {
  const h = mount(UsageTotalCard, { title: "本次消耗", totals: usageTotal({ cost_usd: 999 }), priceKnown: false });
  assert.match(text(h.tree), /模型單價未確認，暫不估算/);
  assert.ok(!text(h.tree).includes("999")); assert.ok(!text(h.tree).includes("USD $"));
});
test("partial tokens and partial costs have independent explicit labels", () => {
  const props = { title: "本次消耗", totals: usageTotal({ output_tokens: null, total_tokens: 1000, usage_partial: true, missing_usage: 1, cost_partial: true }), priceKnown: true };
  const h = mount(UsageTotalCard, props);
  assert.match(text(h.tree), /用量不完整 · 已知小計/); assert.match(text(h.tree), /輸出 tokens未取得/);
  assert.match(text(h.tree), /USD \$0\.001234/); assert.match(text(h.tree), /費用不完整 · 已知費用小計/);
  props.totals = usageTotal({ cost_usd: null, cost_partial: true }); h.render();
  assert.ok(!text(h.tree).includes("用量不完整")); assert.match(text(h.tree), /費用不完整/);
});
test("null is unavailable, real zero is zero, and tiny costs do not round down to zero", () => {
  const props = { title: "測試", totals: null, priceKnown: true }; const h = mount(UsageTotalCard, props);
  assert.match(text(h.tree), /未取得/); assert.ok(!text(h.tree).includes("0 tokens"));
  props.totals = usageTotal({ input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 }); h.render();
  assert.match(text(h.tree), /0 tokens/); assert.match(text(h.tree), /USD \$0\.00/); assert.ok(!text(h.tree).includes("未取得"));
  props.totals = usageTotal({ cost_usd: .000001 }); h.render(); assert.match(text(h.tree), /USD \$0\.000001/);
  props.totals = usageTotal({ calls: 0, input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null }); h.render();
  assert.match(text(h.tree), /尚無已記錄的呼叫/); assert.ok(!text(h.tree).includes("USD $0"));
});
test("usage dialog loads once, explicitly refreshes and never polls or writes", async () => {
  answer = async () => ({ data: usageFixture() });
  const props = { agentId: "a", revision: 0, onClose() {} }; const h = mount(ChatUsageDialog, props);
  assert.equal(calls.length, 0); h.effects(); await tick(); h.render();
  assert.equal(one(h, "UsageSummary").props.usage.current_context_tokens, 400);
  h.effects(); assert.equal(calls.length, 1); assert.equal(timers.size, 0);
  click(h, "重新讀取"); h.effects(); await tick(); h.render(); assert.equal(calls.length, 2);
  props.revision = 1; h.render(); h.effects(); await tick(); h.render(); assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.method === "get" && c.args[0] === "/chat/a/usage")); h.dispose();
});
test("usage read errors clear stale amounts, show server detail and permit retry", async () => {
  answer = async () => ({ data: usageFixture() }); const h = mount(ChatUsageDialog, { agentId: "a", revision: 0, onClose() {} });
  h.effects(); await tick(); h.render();
  answer = async () => { throw { isAxiosError: true, response: { status: 503, data: { detail: "統計暫時無法取得" } } }; };
  click(h, "重新讀取"); h.effects(); await tick(); h.render();
  assert.match(text(h.tree), /統計暫時無法取得/); assert.equal(components(h, "UsageSummary").length, 0);
  assert.equal(button(h, "重新讀取").props.disabled, false);
  answer = async () => ({ data: usageFixture() }); click(h, "重新讀取"); h.effects(); await tick(); h.render();
  assert.equal(components(h, "UsageSummary").length, 1); h.dispose();
});
test("closing usage cancels its request; stale response never repopulates after close or agent switch", async () => {
  const a = deferred(), b = deferred(); answer = (_m, path) => path === "/chat/a/usage" ? a.promise : b.promise;
  const props = { agentId: "a", revision: 0, onClose() {} }, h = mount(ChatUsageDialog, props);
  h.effects(); const firstSignal = calls.at(-1).args[1].signal;
  props.agentId = "b"; h.render(); h.effects(); assert.equal(firstSignal.aborted, true);
  b.resolve({ data: usageFixture({ model: "second" }) }); await tick(); h.render();
  a.resolve({ data: usageFixture({ model: "stale" }) }); await tick(); h.render();
  assert.equal(one(h, "UsageSummary").props.usage.model, "second"); h.dispose();
  assert.equal(calls.at(-1).args[1].signal.aborted, true);
  const late = deferred(); answer = () => late.promise; const closed = mount(ChatUsageDialog, props);
  closed.effects(); closed.dispose(); late.resolve({ data: usageFixture() }); await tick(); closed.render();
  assert.equal(components(closed, "UsageSummary").length, 0);
});
test("usage native modal offers Escape, close button and backdrop dismissal, restores focus", () => {
  let opened = 0, restored = 0, closed = 0; documentStub.activeElement = { focus() { restored++; } };
  const h = mount(ChatUsageDialog, { agentId: "a", revision: 0, onClose() { closed++; } });
  answer = () => deferred().promise;
  h.tree.props.ref.current = { showModal() { opened++; } }; h.effects(); assert.equal(opened, 1);
  assert.equal(h.tree.type, "dialog"); assert.equal(h.tree.props["aria-labelledby"], "chat-usage-title");
  let prevented = false; h.tree.props.onCancel({ preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  nodes(h.tree, n => n.props["aria-label"] === "關閉用量面板")[0].props.onClick();
  const target = { getBoundingClientRect: () => ({ left: 10, right: 200, top: 10, bottom: 200 }) };
  h.tree.props.onClick({ target, currentTarget: target, clientX: 30, clientY: 30 }); assert.equal(closed, 2);
  h.tree.props.onClick({ target, currentTarget: target, clientX: 0, clientY: 0 }); assert.equal(closed, 3);
  h.dispose(); assert.equal(restored, 1);
});
async function openChat() {
  answer = async (_m, url) => ({ data: url === "/agents/mine" ? { id: "a", name: "測試室友", avatar_emoji: "✦" } : { messages: [] } });
  const h = mount(ChatSession, { agentId: "a" }); h.effects(); await tick(); await tick(); h.render(); return h;
}
const chatInput = h => nodes(h.tree, n => n.type === "textarea")[0];
const writeChat = (h, value = "你好") => { chatInput(h).props.onChange({ target: { value } }); h.render(); };
const replyFixture = { user_message: { id: "u", role: "user", content: "你好" }, assistant_message: { id: "r", role: "assistant", content: "測試回覆" } };
test("chat route keys sessions by agent, and usage is absent until clicked", async () => {
  routeParams = { agentId: "a" }; const route = mount(ChatPage); assert.equal(route.tree.key, "a");
  routeParams = { agentId: "b" }; route.render(); assert.equal(route.tree.key, "b");
  const h = await openChat(); assert.equal(components(h, "ChatUsageDialog").length, 0);
  assert.ok(!calls.some(c => c.args[0].endsWith("/usage"))); click(h, "用量");
  assert.equal(one(h, "ChatUsageDialog").props.agentId, "a");
  one(h, "ChatUsageDialog").props.onClose(); h.render(); assert.equal(components(h, "ChatUsageDialog").length, 0); h.dispose();
});
test("failed chat load is retryable, and unauthorized agents cannot load messages", async () => {
  answer = async () => { throw Error("offline"); }; const h = mount(ChatSession, { agentId: "a" }); h.effects(); await tick(); h.render();
  assert.match(text(h.tree), /對話暫時無法載入/);
  answer = async () => ({ data: { id: "different" } }); click(h, "重新讀取對話"); h.effects(); await tick(); h.render();
  assert.ok(!calls.some(c => c.args[0] === "/chat/a/messages")); expectCall("navigate", "/"); h.dispose();
});
test("only exact missing-memory 409 links to mirror; offline and NoLiveBed remain distinct", async () => {
  for (const [status, detail, link] of [[409, "還沒讀到記憶", true], [409, "還沒讀到記憶（記憶庫連不上）", false], [409, "室友還在睡覺", false], [503, "還沒讀到記憶", false]]) {
    const h = await openChat(); writeChat(h); calls.length = 0;
    answer = async () => { throw { isAxiosError: true, response: { status, data: { detail } } }; };
    await button(h, "送出").props.onClick(); h.render();
    assert.match(text(h.tree), new RegExp(detail.replace(/[（）]/g, ".")));
    assert.equal(nodes(h.tree, n => n.props.to === "/agent/edit#editor-note").length, link ? 1 : 0);
    assert.equal(nodes(h.tree, n => n.props.to === "/home/photos").length, 0);
    assert.equal(chatInput(h).props.value, "你好"); assert.equal(calls.length, 1);
    if (detail.includes("連不上")) assert.match(text(h.tree), /不需要重寫原有記憶/); h.dispose();
  }
});
test("Simplified UI preserves exact backend memory-error routing and unsent message", async () => {
  for (const [detail, link] of [["還沒讀到記憶", true], ["還沒讀到記憶（記憶庫連不上）", false], ["室友還在睡覺", false]]) {
    language.setUiLanguage("zh-TW");
    const h = await openChat(); writeChat(h); calls.length = 0;
    language.setUiLanguage("zh-CN"); h.render();
    answer = async () => { throw { isAxiosError: true, response: { status: 409, data: { detail } } }; };
    await button(h, language.uiText("送出")).props.onClick(); h.render();
    assert.equal(nodes(h.tree, n => n.props.to === "/agent/edit#editor-note").length, link ? 1 : 0);
    assert.equal(chatInput(h).props.value, "你好"); assert.equal(calls.length, 1); h.dispose();
  }
});
test("chat single-flight send preserves modal focus and refreshes only mounted usage", async () => {
  const h = await openChat(); writeChat(h); calls.length = 0;
  const pending = deferred(); answer = () => pending.promise;
  let focused = 0; chatInput(h).props.ref.current = { focus() { focused++; } };
  const send = button(h, "送出").props.onClick; const a = send(), b = send(); assert.equal(calls.length, 1);
  h.render(); click(h, "用量"); pending.resolve({ data: replyFixture }); await Promise.all([a, b]); h.render();
  assert.equal(one(h, "ChatUsageDialog").props.revision, 1); assert.equal(focused, 0);
  assert.equal(components(h, "MessageBubble").length, 2); assert.equal(calls.length, 1); h.dispose();
});
test("IME Enter does not send; normal Enter does, and late replies cannot update an unmounted session", async () => {
  const h = await openChat(); writeChat(h); calls.length = 0; const pending = deferred(); answer = () => pending.promise;
  chatInput(h).props.onKeyDown({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true }, preventDefault() {} }); assert.equal(calls.length, 0);
  chatInput(h).props.onKeyDown({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: false, keyCode: 229 }, preventDefault() {} }); assert.equal(calls.length, 0);
  chatInput(h).props.onKeyDown({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: false }, preventDefault() {} }); assert.equal(calls.length, 1);
  h.dispose(); pending.resolve({ data: replyFixture }); await tick(); h.render();
  assert.equal(components(h, "MessageBubble").filter(n => n.props.msg.role === "assistant").length, 0);
});

test("compact private chat keeps one header, a bounded scroller, and an accessible composer", async () => {
  const h = await openChat();
  assert.equal(h.tree.props.className, "cabin-chat");
  const header = nodes(h.tree, n => n.type === "header")[0];
  assert.equal(nodes(header, n => n.type === "button").length, 2);
  assert.equal(nodes(header, n => n.type === "h1").length, 1);
  assert.equal(text(nodes(header, n => n.type === "h1")[0]), "測試室友");
  const scroller = nodes(h.tree, n => n.props.className === "chat-messages")[0];
  assert.equal(scroller.props.tabIndex, 0);
  assert.equal(scroller.props["aria-label"], "聊天紀錄");
  assert.equal(chatInput(h).props["aria-label"], "聊天訊息");
  assert.equal(button(h, "送出").props["aria-label"], "送出");
  assert.ok(button(h, "送出").props.disabled);
  assert.equal(nodes(h.tree, n => n.props.className === "chat-empty").length, 1);
  assert.equal(nodes(h.tree, n => n.type === "button").length, 3);
  assert.ok(calls.every(c => c.method === "get")); h.dispose();
});
test("chat message updates scroll only the conversation, without animated page scrolling", async () => {
  const h = await openChat();
  const panel = { scrollHeight: 812, scrollTop: 0 };
  nodes(h.tree, n => n.props.className === "chat-messages")[0].props.ref.current = panel;
  h.effects(); assert.equal(panel.scrollTop, 812);
  writeChat(h); answer = async () => ({ data: replyFixture });
  await button(h, "送出").props.onClick(); h.render(); panel.scrollHeight = 960;
  h.effects(); assert.equal(panel.scrollTop, 960);
  const source = readFileSync(resolve(root, "src/pages/ChatPage.tsx"), "utf8");
  assert.ok(!source.includes("scrollIntoView")); h.dispose();
});
test("composer grows with a multiline draft, resets after send, and locks a pending draft", async () => {
  const h = await openChat();
  const field = { style: {}, scrollHeight: 48, focus() {} };
  chatInput(h).props.ref.current = field; h.effects();
  assert.equal(field.style.height, "48px");
  field.scrollHeight = 120; writeChat(h, "第一行\n第二行\n第三行"); h.effects();
  assert.equal(field.style.height, "120px");
  const pending = deferred(); answer = () => pending.promise;
  const sending = button(h, "送出").props.onClick(); h.render(); field.scrollHeight = 48; h.effects();
  assert.equal(chatInput(h).props.readOnly, true); assert.equal(chatInput(h).props.value, "");
  assert.equal(field.style.height, "48px"); assert.ok(button(h, "送出").props.disabled);
  pending.resolve({ data: replyFixture }); await sending; h.render();
  assert.equal(chatInput(h).props.readOnly, false); h.dispose();
});
test("bubble redesign preserves raw multiline message content in both directions", async () => {
  const sample = "<img src=x onerror=alert(1)>\n原文繁體 / 简体 / English ✦";
  answer = async (_m, url) => ({ data: url === "/agents/mine" ? { id: "a", name: "室友", avatar_emoji: "✦" } : { messages: ["user", "assistant"].map(role => ({ id: role, role, content: sample })) } });
  const h = mount(ChatSession, { agentId: "a" }); h.effects(); await tick(); await tick(); h.render();
  for (const bubble of components(h, "MessageBubble")) {
    const b = mount(bubble.type, bubble.props);
    assert.equal(text(nodes(b.tree, n => n.props.className === "chat-bubble")[0]), sample);
    assert.equal(nodes(b.tree, n => n.type === "img" || n.props.dangerouslySetInnerHTML).length, 0);
    assert.match(b.tree.props.className, bubble.props.msg.role === "user" ? /outgoing/ : /incoming/); b.dispose();
  }
  h.dispose();
});
test("chat Shift+Enter keeps a multiline draft without sending", async () => {
  const h = await openChat(); writeChat(h, "先換行"); calls.length = 0;
  let prevented = false;
  chatInput(h).props.onKeyDown({ key: "Enter", shiftKey: true, nativeEvent: { isComposing: false }, preventDefault() { prevented = true; } });
  assert.equal(calls.length, 0); assert.equal(prevented, false); assert.equal(chatInput(h).props.value, "先換行"); h.dispose();
});
test("chat layout explicitly scopes purple spacing, narrow screens, safe areas and long text", () => {
  const css = readFileSync(resolve(root, "src/chat-layout.css"), "utf8");
  assert.match(css, /width: min\(100%, 720px\)/);
  assert.match(css, /grid-template-rows: auto minmax\(0, 1fr\) auto/);
  assert.match(css, /height: 100dvh/); assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.cabin-chat \.chat-bubble\s*\{[^}]*padding: 12px 16px[^}]*white-space: pre-wrap; overflow-wrap: anywhere/s);
  assert.match(css, /\.cabin-chat \.chat-input\s*\{[^}]*max-height: min\(10rem, 28dvh\)[^}]*font-size: 16px/s);
  assert.match(css, /background: #c9a7ff; color: #21152f/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.ok(!/^\s*(?:body|:root|#root|\*)\s*\{/m.test(css));
});

const { CabinClockFace } = load("src/components/CabinClockFace.tsx");
const { useCabinTime } = load("src/hooks/useCabinTime.ts");
test("clock hands include fractional hour and minute movement from real seconds", () => {
  assert.deepEqual(clockHandAngles(new Date("2026-09-09T03:15:30Z"), "UTC"), { hour: 97.75, minute: 93, second: 180 });
  assert.deepEqual(clockHandAngles(new Date("2026-09-09T03:15:31Z"), "UTC"), { hour: 97.5 + 31 / 120, minute: 93.1, second: 186 });
});
test("clock respects resident timezone, quarter-hour offsets and daylight savings", () => {
  const now = new Date("2026-09-09T00:00:00Z");
  assert.deepEqual(clockHandAngles(now, "Asia/Taipei"), { hour: 240, minute: 0, second: 0 });
  assert.deepEqual(clockHandAngles(now, "Asia/Kathmandu"), { hour: 172.5, minute: 270, second: 0 });
  assert.equal(clockHandAngles(new Date("2026-01-01T12:00:00Z"), "America/New_York").hour, 210);
  assert.equal(clockHandAngles(new Date("2026-07-01T12:00:00Z"), "America/New_York").hour, 240);
});
test("clock wraps noon and midnight without an accumulated animation angle", () => {
  for (const stamp of ["2026-09-09T00:00:00Z", "2026-09-09T12:00:00Z"]) {
    assert.deepEqual(clockHandAngles(new Date(stamp), "UTC"), { hour: 0, minute: 0, second: 0 });
  }
  assert.deepEqual(clockHandAngles(new Date("2026-09-08T23:59:59Z"), "UTC"), { hour: 359.5 + 59 / 120, minute: 359.9, second: 354 });
});
test("live clock face exposes twelve ticks and actual hands but no duplicate focus target", () => {
  const props = { now: new Date("2026-09-09T03:15:30Z"), timeZone: "UTC", width: 26, height: 27 };
  const h = mount(CabinClockFace, props);
  assert.equal(h.tree.props["aria-hidden"], "true");
  assert.equal(h.tree.props.focusable, "false");
  assert.equal(h.tree.props.width, 26);
  assert.equal(h.tree.props.height, 27);
  assert.equal(nodes(h.tree, n => n.props.className === "cabin-clock-tick").length, 12);
  assert.equal(nodes(h.tree, n => n.props.className === "cabin-clock-second")[0].props.transform, "rotate(180 50 50)");
  props.now = new Date("2026-09-09T03:15:31Z"); h.render();
  assert.equal(nodes(h.tree, n => n.props.className === "cabin-clock-second")[0].props.transform, "rotate(186 50 50)");
  assert.equal(calls.length, 0);
});
test("clock dial scales with the original photograph in tall and short cabin crops", () => {
  const image = { width: 1053, height: 1494 };
  assert.deepEqual(clockDialSize(image, image), { width: 52, height: 54 });
  for (const scene of [{ width: 320, height: 550 }, { width: 390, height: 430 }, { width: 500, height: 220 }]) {
    const size = clockDialSize(scene, image), scale = Math.max(scene.width / image.width, scene.height / image.height);
    assert.ok(Math.abs(size.width - 52 * scale) < 1e-8);
    assert.ok(Math.abs(size.height - 54 * scale) < 1e-8);
  }
  const { cabinZones } = load("src/data/cabin.ts");
  const clock = cabinZones[0].furniture.find(item => item.id === "clock");
  assert.deepEqual([clock.x, clock.y, clock.panel], [.782, .335, "clock"]);
});
test("clock ticks align to seconds and recover actual time after a delayed callback", t => {
  const start = Date.parse("2026-09-09T03:15:30.250Z");
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const h = mount(useCabinTime); h.effects();
  assert.equal(h.tree.getTime(), start);
  assert.equal(timers.size, 1);
  const [id, timer] = [...timers][0];
  assert.equal(timer.delay, 750);
  t.mock.timers.setTime(start + 12_400);
  timers.delete(id); timer.fn(); h.render();
  assert.equal(h.tree.getTime(), start + 12_400);
  assert.equal([...timers.values()][0].delay, 350);
  assert.equal(calls.length, 0);
  h.dispose(); assert.equal(timers.size, 0);
});
test("clock sleeps in hidden tabs and resyncs once on visibility, focus or page restore", t => {
  const start = Date.parse("2026-09-09T03:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const h = mount(useCabinTime); h.effects();
  documentStub.hidden = true; emit(documentEvents, "visibilitychange");
  assert.equal(timers.size, 0);
  t.mock.timers.setTime(start + 3_600_000);
  emit(windowEvents, "focus"); emit(windowEvents, "pageshow"); h.render();
  assert.equal(h.tree.getTime(), start);
  assert.equal(timers.size, 0);
  documentStub.hidden = false;
  emit(documentEvents, "visibilitychange"); emit(windowEvents, "focus"); emit(windowEvents, "pageshow"); h.render();
  assert.equal(h.tree.getTime(), start + 3_600_000);
  assert.equal(timers.size, 1);
  h.dispose();
  assert.equal(timers.size, 0);
  assert.equal(windowEvents.get("focus").size, 0);
  assert.equal(windowEvents.get("pageshow").size, 0);
  assert.equal(documentEvents.get("visibilitychange").size, 0);
  assert.equal(calls.length, 0);
});
test("a hidden clock starts without a timer and strict remount keeps one timer", () => {
  documentStub.hidden = true;
  const hidden = mount(useCabinTime); hidden.effects(); assert.equal(timers.size, 0); hidden.dispose();
  documentStub.hidden = false;
  const first = mount(useCabinTime); first.effects(); first.dispose();
  const second = mount(useCabinTime); second.effects(); assert.equal(timers.size, 1);
  second.dispose(); assert.equal(timers.size, 0);
});
test("clock button retains its card and local/community panel without changing other furniture", async () => {
  auth.user.timezone = "Asia/Kathmandu";
  answer = async (_method, url) => ({ data: url === "/home/furniture" ? { clock: { timezone: "UTC", community_timezone: "Asia/Taipei" } } : url === "/home/dashboard" ? { agents: [], community_status: {} } : [] });
  const h = mount(load("src/pages/HomePage.tsx").HomePage); h.effects(); await tick(); h.render();
  const face = one(h, "CabinClockFace");
  assert.equal(face.props.timeZone, "Asia/Kathmandu");
  const trigger = nodes(h.tree, n => n.props["aria-label"] === "查看時鐘")[0];
  assert.equal(nodes(trigger, n => n.type === "span").length, 0);
  trigger.props.onClick(); h.render(); click(h, "進入 ›"); h.render();
  const panel = one(h, "CabinPanelDialog");
  assert.equal(panel.props.panel, "clock");
  assert.equal(panel.props.now.getTime(), one(h, "CabinClockFace").props.now.getTime());
  assert.equal(nodes(h.tree, n => n.type === "time")[0].props.dateTime, panel.props.now.toISOString());
  assert.ok(calls.every(call => call.method === "get"));
  nodes(h.tree, n => n.type === "input" && n.props.type === "range")[0].props.onChange({ target: { value: "1" } }); h.render();
  assert.equal(nodes(h.tree, n => n.type?.name === "CabinClockFace").length, 0);
  h.dispose();
});
test("clock keeps the touch area and reduced-motion preference without backwards sweep transitions", () => {
  const css = readFileSync(resolve(root, "src/cabin-home.css"), "utf8");
  assert.match(css, /\.cabin-hotspot\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/);
  assert.match(css, /\.cabin-clock-face\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.cabin-clock-second\s*\{\s*visibility:\s*hidden/);
  const clockSource = readFileSync(resolve(root, "src/components/CabinClockFace.tsx"), "utf8");
  assert.doesNotMatch(clockSource, /transition|animateTransform|requestAnimationFrame|fetch\(/);
});

const { CabinUtilityShell, CabinUtilityEmpty } = load("src/components/CabinUtilityShell.tsx");
const { DiaryPage } = load("src/pages/DiaryPage.tsx");

const { SchedulesPage } = load("src/pages/SchedulesPage.tsx");

test("timezone presentation retains the selected IANA identifier and exact save payload across languages", async () => {
  auth.user.timezone = "Asia/Kathmandu";
  const busy = [];
  const h = mount(load("src/components/TimezoneSettings.tsx").TimezoneSettings, { onBusyChange: value => busy.push(value) });
  assert.match(text(h.tree), /Asia\/Kathmandu/);
  assert.equal(nodes(h.tree, n => n.type === "select").length, 0);
  click(h, "其他城市／完整清單");
  let select = nodes(h.tree, n => n.type === "select")[0];
  assert.equal(select.props.value, "Asia/Kathmandu");
  assert.ok(nodes(h.tree, n => n.type === "label").some(n => n.props.htmlFor === select.props.id));
  assert.ok(nodes(select, n => n.type === "option").some(n => n.props.value === "Asia/Kathmandu"));
  assert.equal(calls.length, 0);
  select.props.onChange({ target: { value: "America/New_York" } }); h.render();
  language.setUiLanguage("zh-CN"); h.render();
  select = nodes(h.tree, n => n.type === "select")[0];
  assert.equal(select.props.value, "America/New_York");
  assert.match(text(h.tree), /舱室与定时任务的时区/);
  await h.tree.props.onSubmit({ preventDefault() {} }); h.render();
  assert.deepEqual(calls.find(c => c.method === "patch")?.args, ["/users/me", { timezone: "America/New_York" }]);
  assert.ok(calls.some(c => c.method === "profile"));
  assert.deepEqual(busy, [true, false]);
  assert.equal(calls.filter(c => c.method === "patch").length, 1);
});
test("timezone failed saves preserve the selection and prevent duplicate pending requests", async () => {
  auth.user.timezone = "Asia/Taipei";
  const h = mount(load("src/components/TimezoneSettings.tsx").TimezoneSettings);
  click(h, "其他城市／完整清單");
  nodes(h.tree, n => n.type === "select")[0].props.onChange({ target: { value: "Europe/London" } }); h.render();
  const job = deferred(); answer = () => job.promise;
  const submit = h.tree.props.onSubmit;
  const pending = submit({ preventDefault() {} }); h.render();
  assert.equal(nodes(h.tree, n => n.type === "select")[0].props.disabled, true);
  await submit({ preventDefault() {} });
  assert.equal(calls.length, 1);
  job.reject({ response: { status: 400, data: { detail: "保存未完成" } } });
  await pending; h.render();
  assert.equal(nodes(h.tree, n => n.type === "select")[0].props.value, "Europe/London");
  assert.equal(nodes(h.tree, n => n.type === "select")[0].props.disabled, false);
  assert.ok(!calls.some(c => c.method === "profile"));
  assert.equal(auth.user.timezone, "Asia/Taipei");
});

const timezoneData = load("src/data/timezones.ts");
const { TimezoneSettings } = load("src/components/TimezoneSettings.tsx");
const searchTimezone = (h, query) => { nodes(h.tree, n => n.type === "input" && n.props.type === "search")[0].props.onChange({ target: { value: query } }); h.render(); };
test("timezone defaults respect saved values and only detect a missing or invalid saved zone", () => {
  const { initialTimezone, browserTimezone } = timezoneData;
  for (const saved of ["UTC", "Asia/Calcutta", "Asia/Kathmandu", "America/New_York"]) {
    assert.equal(initialTimezone(saved, "Asia/Tokyo"), saved);
  }
  assert.equal(initialTimezone(undefined, "Asia/Tokyo"), "Asia/Tokyo");
  assert.equal(initialTimezone("", "Asia/Tokyo"), "Asia/Tokyo");
  assert.equal(initialTimezone("invalid/zone", "Asia/Tokyo"), "Asia/Tokyo");
  assert.equal(initialTimezone(null, "invalid/zone"), "UTC");
  const h = mount(TimezoneSettings);
  assert.match(text(h.tree), new RegExp(browserTimezone()));
  assert.equal(calls.length, 0);
  assert.equal(auth.user.timezone, undefined);
});
test("timezone list starts with nine Chinese common choices and preserves uncommon saved aliases", () => {
  auth.user.timezone = "Etc/GMT+3";
  const h = mount(TimezoneSettings);
  const common = nodes(h.tree, n => n.props.className === "timezone-common")[0];
  assert.equal(nodes(common, n => n.type === "button").length, 9);
  for (const name of ["台北", "香港", "北京／上海", "東京", "新加坡", "首爾", "倫敦", "紐約", "洛杉磯"]) assert.ok(text(common).includes(name));
  assert.equal(nodes(common, n => n.type === "time").length, 9);
  assert.match(text(h.tree), /Etc\/GMT\+3/);
  click(h, "其他城市／完整清單");
  const options = nodes(h.tree, n => n.type === "option" && n.props.value);
  assert.deepEqual(options.slice(0, 9).map(n => n.props.value), [...timezoneData.COMMON_TIMEZONES]);
  assert.ok(options.some(n => n.props.value === "Etc/GMT+3"));
  assert.ok(options.some(n => n.props.value === "UTC"));
  assert.equal(options.length, new Set(options.map(n => n.props.value)).size);
  assert.equal(calls.length, 0);
});
test("timezone search accepts Traditional, Simplified, English, full-width and partial IANA names", () => {
  const { matchesTimezone } = timezoneData;
  for (const query of ["台北", "臺北", "Taipei", "Ｔａｉｐｅｉ", "Asia/Tai", "  taiPEI "]) assert.ok(matchesTimezone("Asia/Taipei", query), query);
  for (const query of ["紐約", "纽约", "New York", "new_york", "America/New"]) assert.ok(matchesTimezone("America/New_York", query), query);
  assert.ok(matchesTimezone("Europe/London", "伦敦"));
  assert.ok(matchesTimezone("America/Los_Angeles", "洛杉矶"));
  assert.ok(matchesTimezone("Asia/Shanghai", "北京"));
  assert.ok(!matchesTimezone("Asia/Taipei", "Tokyo"));
  assert.ok(!matchesTimezone("Asia/Taipei", ".*"));
  auth.user.timezone = "Europe/London";
  const h = mount(TimezoneSettings);
  searchTimezone(h, "台北");
  const select = nodes(h.tree, n => n.type === "select")[0];
  assert.deepEqual(nodes(select, n => n.type === "option" && n.props.value).map(n => n.props.value), ["Asia/Taipei"]);
  assert.equal(select.props.value, "", "Searching must not select the first match automatically");
  assert.match(text(nodes(h.tree, n => n.props.className === "timezone-selection")[0]), /Europe\/London/);
  assert.equal(calls.length, 0);
  select.props.onChange({ target: { value: "Asia/Taipei" } }); h.render();
  assert.match(text(nodes(h.tree, n => n.props.className === "timezone-selection")[0]), /Asia\/Taipei/);
  language.setUiLanguage("zh-CN"); h.render();
  assert.equal(nodes(h.tree, n => n.props.type === "search")[0].props.value, "台北");
  assert.match(text(h.tree), /找到 1 个时区/);
  assert.equal(calls.length, 0);
});
test("timezone no-result and collapse preserve the selected draft and keep recovery available", () => {
  auth.user.timezone = "Asia/Tokyo";
  const h = mount(TimezoneSettings);
  searchTimezone(h, "<not-a-timezone>");
  assert.equal(nodes(h.tree, n => n.type === "select").length, 0);
  assert.match(text(h.tree), /找不到這個城市或時區/);
  click(h, "收起完整清單");
  assert.equal(nodes(h.tree, n => n.props.type === "search")[0].props.value, "");
  assert.match(text(h.tree), /Asia\/Tokyo/);
  assert.equal(calls.length, 0);
});
test("mainland city aliases find Beijing time in both Chinese scripts and save the actual IANA zone", async () => {
  for (const query of ["北京", "上海", "廣州", "广州", "深圳", "成都", "杭州", "重庆", "沈阳", "哈尔滨", "北京時間", "北京时间", "China", "Beijing", "Guangzhou", "Chengdu", "UTC+8"]) assert.ok(timezoneData.matchesTimezone("Asia/Shanghai", query), query);
  const h = mount(TimezoneSettings);
  searchTimezone(h, "广州");
  const select = nodes(h.tree, n => n.type === "select")[0];
  const matches = nodes(select, n => n.type === "option" && n.props.value);
  assert.deepEqual(matches.map(n => n.props.value), ["Asia/Shanghai"]);
  assert.match(text(matches), /北京／上海/);
  select.props.onChange({ target: { value: "Asia/Shanghai" } }); h.render();
  assert.equal(calls.length, 0);
  await h.tree.props.onSubmit({ preventDefault() {} }); h.render();
  assert.deepEqual(calls.find(c => c.method === "patch")?.args, ["/users/me", { timezone: "Asia/Shanghai" }]);
  assert.equal(timezoneData.timezoneTime("Asia/Shanghai", new Date("2026-01-15T00:00:00Z")), "08:00");
  searchTimezone(h, "乌鲁木齐");
  assert.deepEqual(nodes(h.tree, n => n.type === "option" && n.props.value).map(n => n.props.value), ["Asia/Shanghai", "Asia/Urumqi"]);
  assert.match(text(h.tree), /新疆地方時間/);
  assert.equal(timezoneData.timezoneTime("Asia/Urumqi", new Date("2026-01-15T00:00:00Z")), "06:00");
});
test("timezone common-city buttons only change the draft and clear stale success notices", async () => {
  auth.user.timezone = "Asia/Taipei";
  const h = mount(TimezoneSettings);
  await h.tree.props.onSubmit({ preventDefault() {} }); h.render();
  assert.match(text(h.tree), /時區已保存/);
  const target = nodes(h.tree, n => n.type === "button" && text(n).startsWith("東京"))[0];
  assert.equal(target.props.type, "button");
  target.props.onClick(); h.render();
  assert.doesNotMatch(text(h.tree), /時區已保存/);
  assert.match(text(nodes(h.tree, n => n.props.className === "timezone-selection")[0]), /Asia\/Tokyo/);
  assert.equal(nodes(h.tree, n => n.type === "button" && n.props["aria-pressed"] === true).length, 1);
  assert.equal(calls.filter(c => c.method === "patch").length, 1);
  assert.equal(auth.user.timezone, "Asia/Taipei");
});
test("timezone pending save freezes common buttons, search and full-list controls", async () => {
  auth.user.timezone = "Asia/Taipei";
  const h = mount(TimezoneSettings);
  const staleCity = nodes(h.tree, n => n.type === "button" && text(n).startsWith("東京"))[0];
  const pending = deferred(); answer = () => pending.promise;
  const save = h.tree.props.onSubmit({ preventDefault() {} }); h.render();
  for (const control of nodes(h.tree, n => ["input", "button"].includes(n.type))) assert.equal(control.props.disabled, true);
  staleCity.props.onClick(); searchTimezone(h, "Tokyo");
  assert.equal(nodes(h.tree, n => n.props.type === "search")[0].props.value, "");
  assert.match(text(nodes(h.tree, n => n.props.className === "timezone-selection")[0]), /Asia\/Taipei/);
  pending.resolve({ data: {} }); await save; h.render();
  assert.equal(calls.filter(c => c.method === "patch").length, 1);
});
test("timezone current times follow DST, midnight and fractional-hour zones", () => {
  const { timezoneTime } = timezoneData;
  const winter = new Date("2026-01-15T00:00:00Z"), summer = new Date("2026-07-15T00:00:00Z");
  assert.equal(timezoneTime("Asia/Taipei", winter), "08:00");
  assert.equal(timezoneTime("Asia/Kathmandu", winter), "05:45");
  assert.equal(timezoneTime("Europe/London", winter), "00:00");
  assert.equal(timezoneTime("Europe/London", summer), "01:00");
  assert.equal(timezoneTime("America/New_York", winter), "19:00");
  assert.equal(timezoneTime("America/New_York", summer), "20:00");
  assert.equal(timezoneTime("UTC", winter), "00:00");
});
test("timezone selector degrades safely without supportedValuesOf but retains saved and browser zones", () => {
  const original = Intl.supportedValuesOf;
  try {
    for (const replacement of [undefined, () => { throw Error("unsupported"); }]) {
      Intl.supportedValuesOf = replacement;
      const values = timezoneData.availableTimezones("Etc/GMT+3", "Asia/Kathmandu");
      assert.ok(values.includes("Etc/GMT+3")); assert.ok(values.includes("Asia/Kathmandu")); assert.ok(values.includes("UTC"));
      assert.deepEqual(values.slice(0, 9), [...timezoneData.COMMON_TIMEZONES]);
      assert.ok(!timezoneData.availableTimezones("invalid/zone").includes("invalid/zone"));
    }
  } finally { Intl.supportedValuesOf = original; }
});
test("timezone minute clock pauses while hidden, refreshes on resume, cleans up and never requests data", () => {
  const h = mount(load("src/hooks/useTimezoneMinute.ts").useTimezoneMinute); h.effects(); h.render();
  assert.equal(timers.size, 1);
  assert.ok([...timers.values()][0].delay > 0 && [...timers.values()][0].delay <= 60_000);
  const initial = h.tree;
  [...timers.values()][0].fn(); h.render();
  assert.notEqual(h.tree, initial);
  assert.equal(timers.size, 1);
  documentStub.hidden = true; emit(documentEvents, "visibilitychange");
  assert.equal(timers.size, 0);
  documentStub.hidden = false; emit(windowEvents, "pageshow"); h.render();
  assert.equal(timers.size, 1);
  h.dispose();
  assert.equal(timers.size, 0);
  for (const name of ["focus", "pageshow"]) assert.equal(windowEvents.get(name).size, 0);
  assert.equal(documentEvents.get("visibilitychange").size, 0);
  assert.equal(calls.length, 0);
});
test("both settings surfaces reuse the timezone picker; registration still detects without a duplicate control", () => {
  for (const path of ["src/pages/AccountSettingsPage.tsx", "src/components/CabinPanelDialog.tsx"]) assert.match(readFileSync(resolve(root, path), "utf8"), /<TimezoneSettings/);
  assert.match(readFileSync(resolve(root, "src/api/auth.ts"), "utf8"), /timezone: Intl.DateTimeFormat\(\).resolvedOptions\(\).timeZone/);
  assert.doesNotMatch(readFileSync(resolve(root, "src/pages/RegisterPage.tsx"), "utf8"), /<TimezoneSettings|<select[^>]*timezone/);
});
test("account settings uses the approved cabin panels and preserves save locking and existing navigation", () => {
  const h = mount(load("src/pages/AccountSettingsPage.tsx").AccountSettingsPage);
  assert.equal(h.tree.props.className, "photo-album cabin-utility account-settings");
  assert.equal(nodes(h.tree, n => n.type === "section" && n.props.className === "photo-panel").length, 5);
  assert.equal(one(h, "Link").props.to, "/outside");
  one(h, "TimezoneSettings").props.onBusyChange(true); h.render();
  assert.equal(nodes(h.tree, n => n.type === "fieldset")[0].props.disabled, true);
  assert.equal(components(h, "Link").length, 0);
  one(h, "TimezoneSettings").props.onBusyChange(false); h.render();
  assert.equal(nodes(h.tree, n => n.type === "fieldset")[0].props.disabled, false);
  assert.equal(one(h, "Link").props.to, "/outside");
  assert.equal(calls.length, 0);
});
test("timezone controls use purple cabin tokens, readable native options and wrapping mobile layouts", () => {
  const css = readFileSync(resolve(root, "src/timezone-settings.css"), "utf8");
  const page = readFileSync(resolve(root, "src/pages/AccountSettingsPage.tsx"), "utf8");
  assert.doesNotMatch(page, /fields\.css|field-app|field-panel/);
  assert.doesNotMatch(css, /#8ed6dc|#39767d|--accent[,)]|--ink[,)]/);
  for (const token of ["--c-sky", "--c-frost", "--c-muted", "--c-snow", "--c-moon"]) assert.ok(css.includes(token));
  assert.match(css, /select option\s*\{[^}]*background-color: var\(--tz-bg\);[^}]*color: var\(--tz-ink\)/);
  assert.match(css, /:is\(input, select\)[^{]*\{[^}]*-webkit-text-fill-color: var\(--tz-ink\);[^}]*color-scheme: dark/);
  assert.match(css, /:disabled\s*\{[^}]*opacity: 1;[^}]*-webkit-text-fill-color: var\(--tz-muted\)/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline: 2px solid var\(--tz-accent\)/);
  assert.match(css, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /flex-wrap: wrap/);
  assert.match(css, /@media \(max-width: 360px\)/);
  const luminance = hex => hex.match(/../g).map(part => parseInt(part, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  for (const foreground of ["f4f0ff", "a9a1c7", "efebf6", "b5abc7"]) assert.ok((luminance(foreground) + .05) / (luminance("0a081c") + .05) >= 4.5);
});

const { AdminPage } = load("src/pages/AdminPage.tsx");
const { AdvancedAgentPage } = load("src/pages/AdvancedAgentPage.tsx");
const adminFixture = {
  residents: { total_users: 12, active_users: 8, total_agents: 10 },
  content: { posts: 48, works: 6, book_clubs: 2, book_club_replies: 9, skins: 3, published_skins: 1, announcements: 2 },
  today: { posts: 4, works: 0, park_checkins: 3, club_replies: 2 },
  week: { posts: 15, works: 2 }, system: { db_size: "2.4 MB" },
  recent_users: [{ display_name: "繁體名字", created_at: "2026-09-09T03:00:00Z", is_active: true }],
};
test("admin loading and loaded states use the cabin shell; stats remain read-only and complete", async () => {
  const initial = mount(AdminPage);
  assert.equal(one(initial, "CabinUtilityShell").props.code, "SYSTEM");
  assert.match(text(initial.tree), /正在讀取系統資料/);
  const h = await utilityLoaded(AdminPage, adminFixture);
  assert.equal(one(h, "CabinUtilityShell").props.title, "系統儀表板");
  const cards = components(h, "StatCard");
  assert.equal(cards.length, 13);
  assert.deepEqual(cards.map(c => c.props.value), [12, 8, 10, 4, 0, 3, 2, 48, 6, 2, 3, 2, "2.4 MB"]);
  assert.match(text(h.tree), /繁體名字/);
  assert.ok(calls.every(c => c.method === "get" && c.args[0] === "/admin/stats"));
  click(h, "私訊檢舉審核 →"); expectCall("navigate", "/admin/dm-reports");
  h.dispose();
});
test("admin preserves true zero and labels missing values without fabricating metrics", async () => {
  const h = await utilityLoaded(AdminPage, { residents: { total_users: 0 }, recent_users: [] });
  const cards = components(h, "StatCard");
  assert.equal(text(mount(cards[0].type, cards[0].props).tree), "0總用戶");
  assert.equal(text(mount(cards[1].type, cards[1].props).tree), "未取得活躍用戶");
  assert.match(text(h.tree), /目前沒有最近入住的居民/);
  assert.ok(cards.every(card => !card.props.sub));
  const missing = await utilityLoaded(AdminPage, {});
  assert.match(text(missing.tree), /最近入住資料未取得/);
});
test("admin denied state never shows private data or review controls", async () => {
  answer = async () => { throw { response: { status: 403 } }; };
  const h = mount(AdminPage); h.effects(); await tick(); h.render();
  assert.equal(one(h, "CabinUtilityShell").props.code, "SYSTEM");
  assert.match(text(h.tree), /需要管理員權限/);
  assert.equal(nodes(h.tree, n => n.props.role === "alert").length, 1);
  assert.equal(components(h, "StatCard").length, 0);
  assert.equal(nodes(h.tree, n => n.type === "button").length, 0);
  assert.ok(calls.every(c => c.method === "get"));
});
test("admin errors are not empty data and retry fetches the same endpoint", async () => {
  for (const failure of [null, { response: { status: 503 } }]) {
    answer = async () => { throw failure; };
    const h = mount(AdminPage); h.effects(); await tick(); h.render();
    assert.match(text(h.tree), /系統資料暫時無法取得/);
    assert.ok(!text(h.tree).includes("目前沒有最近入住的居民"));
    answer = async () => ({ data: adminFixture });
    click(h, "重新讀取"); h.effects(); await tick(); h.render();
    assert.equal(components(h, "StatCard").length, 13);
    h.dispose();
  }
  for (const malformed of [null, [], "invalid"]) {
    const h = await utilityLoaded(AdminPage, malformed);
    assert.match(text(h.tree), /系統資料暫時無法取得/); h.dispose();
  }
  assert.ok(calls.every(c => c.method === "get" && c.args[0] === "/admin/stats"));
});
test("admin ignores a late response after unmount", async () => {
  const pending = deferred(); answer = () => pending.promise;
  const h = mount(AdminPage); h.effects(); h.dispose();
  pending.resolve({ data: adminFixture }); await tick(); h.render();
  assert.equal(components(h, "StatCard").length, 0);
  assert.match(text(h.tree), /正在讀取系統資料/);
});
test("admin Simplified labels do not rewrite resident names or database-size values", async () => {
  language.setUiLanguage("zh-CN");
  const h = await utilityLoaded(AdminPage, adminFixture);
  assert.equal(one(h, "CabinUtilityShell").props.title, "系统仪表板");
  assert.match(text(h.tree), /繁體名字/);
  assert.ok(!text(h.tree).includes("繁体名字"));
  assert.equal(components(h, "StatCard")[7].props.sub, "本周 +15");
  assert.equal(components(h, "StatCard").at(-1).props.value, "2.4 MB");
});
test("adoption has labeled fields, optional secret and twenty accessible avatar choices", () => {
  const h = mount(AdoptPage);
  assert.equal(one(h, "CabinUtilityShell").props.code, "ADOPTION");
  const fields = nodes(h.tree, n => ["input", "select", "textarea"].includes(n.type));
  assert.equal(fields.length, 4);
  for (const field of fields) assert.equal(nodes(h.tree, n => n.type === "label" && n.props.htmlFor === field.props.id).length, 1);
  const avatars = nodes(h.tree, n => n.props.className === "adoption-avatar-grid")[0];
  assert.equal(nodes(avatars, n => n.type === "button").length, 20);
  assert.equal(nodes(avatars, n => n.props["aria-pressed"]).length, 1);
  assert.ok(nodes(avatars, n => n.type === "button").every(b => b.props["aria-label"] && b.props.type === "button"));
  assert.equal(nodes(h.tree, n => n.props.id === "adopt-name")[0].props.maxLength, 64);
  assert.equal(nodes(h.tree, n => n.props.id === "adopt-persona")[0].props.maxLength, 2000);
  assert.equal(nodes(h.tree, n => n.props.id === "adopt-api-key")[0].props.type, "password");
  assert.equal(nodes(h.tree, n => n.props.id === "adopt-api-key")[0].props.autoComplete, "off");
  assert.equal(nodes(h.tree, n => n.props.id === "adopt-model")[0].props.value, "claude-opus-4-6");
  assert.equal(calls.length, 0);
});
test("adoption language switches preserve drafts, selected brain and the exact submission fields", async () => {
  const h = mount(AdoptPage);
  scheduleInput(h, "adopt-name", "繁體名字");
  scheduleInput(h, "adopt-persona", "喜歡圖書館");
  scheduleInput(h, "adopt-api-key", " test-only-key ");
  click(h, "OpenAI"); scheduleInput(h, "adopt-model", "gpt-4o-mini"); click(h, "🐻");
  language.setUiLanguage("zh-CN"); h.render();
  assert.equal(one(h, "CabinUtilityShell").props.title, "领养室友");
  assert.equal(nodes(h.tree, n => n.props.id === "adopt-name")[0].props.value, "繁體名字");
  assert.equal(nodes(h.tree, n => n.props.id === "adopt-persona")[0].props.value, "喜歡圖書館");
  assert.equal(button(h, "OpenAI").props["aria-pressed"], true);
  assert.equal(button(h, "🐻").props["aria-pressed"], true);
  answer = async () => ({ data: settingsAgent });
  await nodes(h.tree, n => n.type === "form")[0].props.onSubmit({ preventDefault() {} }); h.render();
  expectCall("post", "/agents", { name: "繁體名字", persona: "喜歡圖書館", llm_provider: "openai", llm_model: "gpt-4o-mini", api_key: "test-only-key", avatar_emoji: "🐻" });
  assert.equal(components(h, "AdoptionSuccess").length, 1);
  assert.ok([...languageStorage.values()].every(value => value !== "test-only-key"));
});
test("adoption blocks empty submits and freezes the entire form during a pending request", async () => {
  const h = mount(AdoptPage);
  await nodes(h.tree, n => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.equal(calls.length, 0);
  fillAdopt(h, "test-only-key"); const pending = deferred(); answer = () => pending.promise;
  const submission = nodes(h.tree, n => n.type === "form")[0].props.onSubmit({ preventDefault() {} }); h.render();
  assert.equal(nodes(h.tree, n => n.type === "fieldset")[0].props.disabled, true);
  assert.equal(nodes(h.tree, n => n.type === "form")[0].props["aria-busy"], true);
  pending.reject(null); await submission; h.render();
  assert.equal(nodes(h.tree, n => n.type === "fieldset")[0].props.disabled, false);
  assert.match(text(h.tree), /領養失敗，請稍後再試/);
  assert.equal(nodes(h.tree, n => n.props.id === "adopt-api-key")[0].props.value, "test-only-key");
});
test("advanced loading and failed reads use the cabin shell and retry without writes", async () => {
  answer = async (_method, path) => { if (path === "/agents/mine") throw { response: { status: 503 } }; return { data: [] }; };
  const h = mount(AdvancedAgentPage);
  assert.equal(one(h, "CabinUtilityShell").props.code, "CONNECTIONS");
  assert.match(text(h.tree), /正在讀取室友設定/);
  h.effects(); await tick(); h.render();
  assert.match(text(h.tree), /暫時無法讀取室友設定/);
  language.setUiLanguage("zh-CN"); h.render();
  assert.match(text(h.tree), /暂时无法读取室友设置/);
  answer = async (_method, path) => ({ data: path === "/agents/mine" ? settingsAgent : [] });
  click(h, "重新读取"); h.effects(); await tick(); h.render();
  assert.equal(h.tree.props.className, "ya-agent-settings");
  assert.equal(components(h, "McpKeysPanel").length, 1);
  assert.ok(calls.every(c => c.method === "get" && ["/agents/mine", "/skins/mine"].includes(c.args[0])));
});
test("advanced missing agent still redirects to adoption; unmounted reads cannot navigate", async () => {
  answer = async (_method, path) => { if (path === "/agents/mine") throw { response: { status: 404 } }; return { data: [] }; };
  const h = mount(AdvancedAgentPage); h.effects(); await tick(); h.render();
  assert.equal(calls.filter(c => c.method === "navigate").length, 1); expectCall("navigate", "/adopt");
  h.dispose(); calls = [];
  const pending = deferred(); answer = () => pending.promise;
  const gone = mount(AdvancedAgentPage); gone.effects(); gone.dispose();
  pending.resolve({ data: null }); await tick(); gone.render();
  assert.ok(calls.every(c => c.method === "get"));
  assert.equal(one(gone, "CabinUtilityShell").props.code, "CONNECTIONS");
});
test("management CSS stays scoped and keeps adaptive grids and accessible controls", () => {
  const css = readFileSync(resolve(root, "src/cabin-management.css"), "utf8");
  assert.ok(!/(^|\n)\s*(?:body|html|:root|button|input|fieldset)\s*[{,]/m.test(css));
  assert.match(css, /repeat\(auto-fit, minmax\(48px, 1fr\)\)/);
  assert.match(css, /min-height: 48px/);
  assert.match(css, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(min-width: 650px\)/);
  assert.ok(!/height:\s*100vh|position:\s*fixed|overflow:\s*hidden/.test(css));
});
test("every current page route is registered in the interface inventory", () => {
  const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  const inventory = readFileSync(resolve(root, "../docs/介面盤點.md"), "utf8");
  const paths = [...app.matchAll(/<Route path="([^"]+)" element=/g)].map(match => match[1]).filter(path => path !== "*");
  const recorded = [...inventory.matchAll(/^\| \x60([^\x60]+)\x60 \|/gm)].map(match => match[1]);
  assert.deepEqual(recorded.sort(), paths.sort(), "Add the route to the inventory with its theme status.");
});
const scheduleFixture = { id: "wake-1", name: "圖書館巡邏", cron_expr: "0 9 * * *", message: "繁體訊息：看看書架。", callback_url: null, enabled: true, next_run: "2026-09-11T01:00:00Z", last_run: null, created_at: "2026-09-10T01:00:00Z" };
function scheduleInput(h, id, value) {
  const input = nodes(h.tree, n => n.props.id === id)[0];
  assert.ok(input, id); input.props.onChange({ target: { value } }); h.render();
}
const scheduleForm = h => nodes(h.tree, n => n.type === "form")[0];
const scheduleSubmit = h => scheduleForm(h).props.onSubmit({ preventDefault() {} });

test("schedule shell stays purple in loading, empty and failure states with labelled controls", async () => {
  const h = mount(SchedulesPage);
  assert.equal(one(h, "CabinUtilityShell").props.code, "SCHEDULES");
  assert.equal(one(h, "CabinUtilityShell").props.title, "排程喚醒");
  assert.match(text(h.tree), /正在讀取排程/);
  assert.ok(nodes(h.tree, n => n.type === "fieldset" && n.props.disabled).length);
  const fields = nodes(h.tree, n => ["input", "textarea"].includes(n.type));
  for (const field of fields) assert.equal(nodes(h.tree, n => n.type === "label" && n.props.htmlFor === field.props.id).length, 1);
  assert.equal(fields.find(f => f.props.id === "schedule-name").props.maxLength, 64);
  assert.equal(fields.find(f => f.props.id === "schedule-message").props.maxLength, 2000);
  assert.equal(fields.find(f => f.props.id === "schedule-webhook").props.maxLength, 512);
  const loaded = await utilityLoaded(SchedulesPage, []);
  assert.match(text(loaded.tree), /還沒有排程/);
  assert.equal(one(loaded, "CabinUtilityShell").props.code, "SCHEDULES");
  assert.ok(calls.every(call => call.method === "get"));
});

test("schedule presets translate without changing Cron values or resident drafts", async () => {
  const h = await utilityLoaded(SchedulesPage, []);
  scheduleInput(h, "schedule-name", "圖書館巡邏");
  scheduleInput(h, "schedule-message", "繁體訊息：記得回家。");
  const expected = [["每小時", "0 * * * *"], ["每天 9:00", "0 9 * * *"], ["每天 21:00", "0 21 * * *"], ["每 30 分鐘", "*/30 * * * *"]];
  for (const locale of ["zh-TW", "zh-CN"]) {
    language.setUiLanguage(locale); h.render();
    for (const [label, cron] of expected) {
      click(h, language.uiText(label));
      assert.equal(button(h, language.uiText(label)).props["aria-pressed"], true);
      writeResult = { ...scheduleFixture, cron_expr: cron };
      await scheduleSubmit(h); h.render();
      expectCall("post", "/schedules", { name: "圖書館巡邏", cron_expr: cron, message: "繁體訊息：記得回家。", callback_url: undefined });
      scheduleInput(h, "schedule-name", "圖書館巡邏");
      scheduleInput(h, "schedule-message", "繁體訊息：記得回家。");
    }
    click(h, language.uiText("自訂")); scheduleInput(h, "schedule-cron", "*/15 * * * *");
    assert.equal(nodes(h.tree, n => n.props.id === "schedule-cron")[0].props.maxLength, 64);
  }
});

test("schedule custom create keeps exact payload and guards rapid double submission", async () => {
  const h = await utilityLoaded(SchedulesPage, []);
  click(h, "自訂");
  scheduleInput(h, "schedule-name", "圖書館巡邏");
  scheduleInput(h, "schedule-message", "繁體訊息：記得回家。");
  scheduleInput(h, "schedule-cron", "*/15 * * * *");
  scheduleInput(h, "schedule-webhook", "https://example.test/wake?label=圖書館");
  const job = deferred(); answer = () => job.promise;
  const submit = scheduleForm(h).props.onSubmit;
  const request = submit({ preventDefault() {} }); await submit({ preventDefault() {} });
  assert.equal(calls.filter(call => call.method === "post").length, 1);
  expectCall("post", "/schedules", { name: "圖書館巡邏", cron_expr: "*/15 * * * *", message: "繁體訊息：記得回家。", callback_url: "https://example.test/wake?label=圖書館" });
  job.resolve({ data: scheduleFixture }); await request; h.render();
  assert.equal(nodes(h.tree, n => n.props.id === "schedule-name")[0].props.value, "");
  assert.match(text(h.tree), /排程已新增/);
  assert.equal(nodes(h.tree, n => n.type === "article").length, 1);
});

test("schedule create failure keeps drafts and shows backend validation detail", async () => {
  const h = await utilityLoaded(SchedulesPage, []);
  click(h, "自訂"); scheduleInput(h, "schedule-name", "試試看"); scheduleInput(h, "schedule-message", "保留這段話"); scheduleInput(h, "schedule-cron", "invalid");
  answer = async () => { throw { isAxiosError: true, response: { data: { detail: "無效的 cron 表達式" } } }; };
  await scheduleSubmit(h); h.render();
  assert.match(text(h.tree), /無效的 cron 表達式/);
  assert.equal(nodes(h.tree, n => n.props.id === "schedule-message")[0].props.value, "保留這段話");
  assert.equal(nodes(h.tree, n => n.type === "article").length, 0);
  assert.equal(nodes(h.tree, n => n.type === "fieldset" && n.props.disabled).length, 0);
});

test("schedule pause changes only enabled and failure preserves the displayed state", async () => {
  const h = await utilityLoaded(SchedulesPage, [scheduleFixture]);
  answer = async () => { throw Error("failed"); };
  await button(h, "暫停").props.onClick(); h.render();
  expectCall("patch", "/schedules/wake-1", { enabled: false });
  assert.match(text(h.tree), /更新失敗，排程狀態未變更。/);
  assert.match(text(h.tree), /啟用中/);
  answer = async () => ({ data: { ...scheduleFixture, enabled: false } });
  await button(h, "暫停").props.onClick(); h.render();
  assert.match(text(h.tree), /已暫停/);
  answer = async () => ({ data: scheduleFixture });
  await button(h, "啟用").props.onClick(); h.render();
  expectCall("patch", "/schedules/wake-1", { enabled: true });
});

test("schedule deletion requires confirmation; cancellation and failures preserve the record", async () => {
  const h = await utilityLoaded(SchedulesPage, [scheduleFixture]);
  click(h, "刪除"); assert.ok(calls.every(call => call.method === "get"));
  click(h, "取消"); assert.ok(calls.every(call => call.method === "get"));
  click(h, "刪除"); answer = async () => { throw Error("failed"); };
  await button(h, "確認刪除").props.onClick(); h.render();
  assert.equal(nodes(h.tree, n => n.type === "article").length, 1);
  assert.match(text(h.tree), /刪除失敗/);
  answer = async () => ({ data: undefined });
  await button(h, "確認刪除").props.onClick(); h.render();
  expectCall("delete", "/schedules/wake-1");
  assert.match(text(h.tree), /排程已刪除/);
  assert.equal(nodes(h.tree, n => n.type === "article").length, 0);
});

test("schedule list failure cannot look empty, retries once and ignores disposed responses", async () => {
  answer = async () => { throw Error("offline"); };
  const h = mount(SchedulesPage); h.effects(); await tick(); h.render();
  assert.match(text(h.tree), /暫時無法讀取排程/);
  assert.doesNotMatch(text(h.tree), /還沒有排程/);
  assert.ok(nodes(h.tree, n => n.type === "fieldset" && n.props.disabled).length);
  answer = async () => ({ data: [scheduleFixture] });
  click(h, "重新讀取"); h.effects(); await tick(); h.render();
  assert.match(text(h.tree), /圖書館巡邏/);
  const job = deferred(); answer = () => job.promise;
  const gone = mount(SchedulesPage); gone.effects(); gone.dispose(); job.resolve({ data: [scheduleFixture] }); await tick(); gone.render();
  assert.doesNotMatch(text(gone.tree), /圖書館巡邏/);
});

test("schedule next run follows account time zone and UI locale, never rewrites Cron", async () => {
  for (const locale of ["zh-TW", "zh-CN"]) {
    language.setUiLanguage(locale);
    for (const zone of ["Asia/Taipei", "America/New_York", "UTC"]) {
      auth.user.timezone = zone;
      const h = await utilityLoaded(SchedulesPage, [scheduleFixture]);
      assert.ok(text(h.tree).includes(new Date(scheduleFixture.next_run).toLocaleString(locale, { timeZone: zone })));
      assert.ok(text(h.tree).includes(scheduleFixture.cron_expr));
    }
    const emptyTime = await utilityLoaded(SchedulesPage, [{ ...scheduleFixture, next_run: null }]);
    assert.ok(text(emptyTime.tree).includes(language.uiText("尚未排定")));
    const invalidDate = await utilityLoaded(SchedulesPage, [{ ...scheduleFixture, next_run: "not a date" }]);
    assert.ok(text(invalidDate.tree).includes(language.uiText("時間未取得")));
    auth.user.timezone = "invalid";
    const invalidZone = await utilityLoaded(SchedulesPage, [scheduleFixture]);
    assert.ok(text(invalidZone.tree).includes(language.uiText("時間未取得")));
  }
});

test("schedule page has explicit responsive purple styles and no legacy surface variables", () => {
  const source = readFileSync(resolve(root, "src/pages/SchedulesPage.tsx"), "utf8");
  const css = readFileSync(resolve(root, "src/schedules.css"), "utf8");
  assert.match(source, /CabinUtilityShell/);
  assert.doesNotMatch(source, /var\(--(?:bg|surface|ink|accent)\)|mx-auto|text-\[10px\]/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /min-height: 48px/);
  assert.match(css, /aria-pressed="true"/);
  assert.match(source, /uiText\(p.label\)/);
});
const { DrawerPage } = load("src/pages/DrawerPage.tsx");
const { MailboxPage } = load("src/pages/MailboxPage.tsx");
const utilityDiary = { id: "diary-1", agent_id: "me", title: "日記標題", content: "第一行\n第二行", source: "manual", importance: 3, created_at: "2026-09-09T00:00:00Z", updated_at: null };
const utilityDrawer = { id: "drawer-1", agent_id: "me", label: "小紙條", content: "保留下來的話", category: "紙條", created_at: "2026-09-09T00:00:00Z" };
const utilityMail = { id: "mail-1", from_name: "鄰居", from_emoji: "✦", to_name: "室友", to_emoji: "☾", subject: "一封測試信", content: "第一行\n第二行", mail_type: "letter", is_anonymous: false, is_read: false, status: null, created_at: "2026-09-09T00:00:00Z", deliver_at: null, expires_at: null };
const nativeInput = (h, placeholder, value) => { nodes(h.tree, n => n.props.placeholder === placeholder)[0].props.onChange({ target: { value } }); h.render(); };
async function utilityLoaded(component, response) {
  answer = async () => ({ data: response });
  const h = mount(component); h.effects(); await tick(); h.render(); return h;
}
test("furniture shell reuses the album theme, one title and an unchanged cabin return destination", () => {
  for (const [title, code] of [["日記本", "DIARY"], ["抽屜", "DRAWER"], ["星際信箱", "MAILBOX"]]) {
    const h = mount(CabinUtilityShell, { title, code, children: "內容" });
    assert.equal(h.tree.props.className, "photo-album cabin-utility");
    assert.equal(nodes(h.tree, n => n.type === "h1").length, 1);
    assert.equal(text(nodes(h.tree, n => n.type === "h1")[0]), title);
    assert.match(text(h.tree), new RegExp(code));
    click(h, "← 返回艙室"); expectCall("navigate", "/");
  }
});
test("utility empty and loading states have the shared panel, not a bare legacy page", () => {
  const empty = mount(CabinUtilityEmpty, { title: "抽屜是空的", children: "放入一件物品。" });
  assert.match(empty.tree.props.className, /photo-panel/); assert.match(text(empty.tree), /放入一件物品/);
  const loading = mount(CabinUtilityEmpty, { title: "正在讀取日記…", loading: true });
  assert.equal(loading.tree.props.role, "status");
  for (const page of [DiaryPage, MailboxPage]) {
    const h = mount(page);
    assert.equal(components(h, "CabinUtilityShell").length, 1);
    assert.equal(one(h, "CabinUtilityEmpty").props.loading, true);
  }
});
test("diary keeps its existing endpoint, keyword search and expand-only reading", async () => {
  const h = await utilityLoaded(DiaryPage, [utilityDiary]);
  expectCall("get", "/diary");
  assert.ok(!text(h.tree).includes(utilityDiary.content));
  const entry = nodes(h.tree, n => n.props.className === "utility-entry-toggle")[0];
  assert.equal(entry.props["aria-expanded"], false);
  entry.props.onClick(); h.render(); assert.match(text(h.tree), /第一行\n第二行/);
  assert.equal(nodes(h.tree, n => n.props.className === "utility-entry-toggle")[0].props["aria-expanded"], true);
  nativeInput(h, "搜尋日記…", " 星光 "); click(h, "搜尋"); h.effects();
  await tick(); h.render(); expectCall("get", "/diary");
  assert.deepEqual(calls.at(-1).args[1], { params: { keyword: "星光" } });
  assert.ok(calls.every(c => c.method === "get"));
});
test("diary is read-only in both languages and preserves resident-authored text", async () => {
  for (const locale of ["zh-TW", "zh-CN"]) {
    language.setUiLanguage(locale);
    const entry = { ...utilityDiary, title: "圖書館", content: "繁體內容：記憶與書架" };
    const h = await utilityLoaded(DiaryPage, [entry]);
    assert.match(text(h.tree), new RegExp(language.uiText("室友的日記")));
    assert.equal(nodes(h.tree, n => n.type === "textarea").length, 0);
    assert.equal(nodes(h.tree, n => n.type === "button" && /寫日記|写日记|儲存|保存|刪除|删除/.test(text(n))).length, 0);
    nodes(h.tree, n => n.props.className === "utility-entry-toggle")[0].props.onClick(); h.render();
    assert.match(text(h.tree), /圖書館/); assert.match(text(h.tree), /繁體內容：記憶與書架/);
    assert.ok(calls.every(c => c.method === "get")); h.dispose();
  }
});
test("diary error is not empty success, can retry, and old search responses cannot overwrite new results", async () => {
  answer = async () => { throw Error("offline"); };
  const h = mount(DiaryPage); h.effects(); await tick(); h.render();
  assert.equal(nodes(h.tree, n => n.props.role === "alert").length, 1);
  assert.equal(components(h, "CabinUtilityEmpty").length, 0);
  answer = async () => ({ data: [utilityDiary] });
  click(h, "重新讀取"); h.effects(); await tick(); h.render();
  assert.equal(nodes(h.tree, n => n.type === "article").length, 1);
  const pending = deferred(); answer = () => pending.promise;
  nativeInput(h, "搜尋日記…", "舊"); click(h, "搜尋"); h.effects();
  answer = async () => ({ data: [] });
  nativeInput(h, "搜尋日記…", "新"); click(h, "搜尋"); h.effects(); await tick(); h.render();
  pending.resolve({ data: [utilityDiary] }); await tick(); h.render();
  assert.equal(one(h, "CabinUtilityEmpty").props.title, "沒有找到符合的日記");
  assert.ok(calls.every(c => c.method === "get")); h.dispose();
});
const lockedDrawer = { locked: true, count: 3, items: [], message: "抽屜上鎖了。這是他自己的東西，你看得到抽屜，看不到裡面。" };
test("locked drawer shows zero or positive count, backend notice, and never an item or action", async () => {
  for (const locale of ["zh-TW", "zh-CN"]) for (const count of [0, 3]) {
    language.setUiLanguage(locale);
    const h = await utilityLoaded(DrawerPage, { ...lockedDrawer, count, items: [utilityDrawer] });
    expectCall("get", "/home/furniture/drawer");
    assert.equal(text(nodes(h.tree, n => n.type === "strong")[0]), String(count));
    assert.match(text(h.tree), new RegExp(language.uiText(lockedDrawer.message)));
    assert.equal(nodes(h.tree, n => ["input", "textarea", "article"].includes(n.type)).length, 0);
    assert.equal(nodes(h.tree, n => n.type === "button").length, 0);
    assert.doesNotMatch(text(h.tree), /小紙條|保留下來的話|空的/);
    assert.ok(calls.every(c => c.method === "get")); h.dispose();
  }
});
test("drawer adapter discards unexpected private items instead of returning them to the page", async () => {
  answer = async () => ({ data: { ...lockedDrawer, items: [utilityDrawer], private: "never return" } });
  assert.deepEqual(await load("src/api/furniture.ts").getDrawerSummary(), { locked: true, count: 3, message: lockedDrawer.message });
});
test("malformed or legacy drawer response fails closed; no fabricated zero or contents", async () => {
  for (const value of [null, [], [utilityDrawer], { ...lockedDrawer, locked: false }, { ...lockedDrawer, count: -1 }, { ...lockedDrawer, count: "3" }, { ...lockedDrawer, count: null }, { ...lockedDrawer, message: null }]) {
    const h = await utilityLoaded(DrawerPage, value);
    assert.match(text(h.tree), /抽屜上鎖了/);
    assert.equal(nodes(h.tree, n => n.props.role === "alert").length, 1);
    assert.equal(nodes(h.tree, n => n.type === "strong" || n.type === "article").length, 0); h.dispose();
  }
});
test("drawer read failure retries and ignores late results after leaving", async () => {
  answer = async () => { throw Error("offline"); };
  const h = mount(DrawerPage); h.effects(); await tick(); h.render();
  assert.match(text(h.tree), /無法讀取物件數量/);
  answer = async () => ({ data: lockedDrawer });
  click(h, "重新讀取"); h.effects(); await tick(); h.render();
  assert.equal(text(nodes(h.tree, n => n.type === "strong")[0]), "3"); h.dispose();
  const pending = deferred(); answer = () => pending.promise;
  const late = mount(DrawerPage); late.effects(); late.dispose();
  pending.resolve({ data: lockedDrawer }); await tick(); late.render();
  assert.equal(nodes(late.tree, n => n.type === "strong").length, 0);
  assert.ok(calls.every(c => c.method === "get"));
});

async function utilityMailbox(inbox = [utilityMail], sent = [utilityMail]) {
  answer = async (_method, path) => ({ data: path === "/mail/inbox" ? inbox : path === "/mail/sent" ? sent : utilityMail });
  const h = mount(MailboxPage); h.effects(); await tick(); h.render(); return h;
}
test("cabin mailbox keeps only inbox and sent, and reads content only after selection", async () => {
  const h = await utilityMailbox();
  assert.deepEqual(calls.map(c => c.args[0]), ["/mail/inbox", "/mail/sent"]);
  assert.equal(one(h, "CabinUtilityShell").props.title, "星際信箱");
  assert.equal(nodes(h.tree, n => n.type === "nav")[0].props.children.length, 2);
  assert.ok(!text(h.tree).includes(utilityMail.content));
  const row = nodes(h.tree, n => n.type === "button" && n.props.className?.includes("utility-mail"))[0];
  assert.match(row.props.className, /is-unread/);
  await row.props.onClick(); h.render(); expectCall("get", "/mail/mail-1");
  assert.match(text(h.tree), /第一行\n第二行/);
  assert.equal(nodes(h.tree, n => n.type === "button" && /刪|删/.test(text(n))).length, 0);
  click(h, "← 回信箱");
  assert.equal(button(h, "收件 (0)").props["aria-pressed"], true);
  click(h, "寄件");
  await nodes(h.tree, n => n.type === "button" && n.props.className?.includes("utility-mail"))[0].props.onClick(); h.render();
  expectCall("get", "/mail/mail-1"); assert.match(text(h.tree), /第一行\n第二行/);
  assert.ok(calls.every(c => c.method === "get")); h.dispose();
});
test("cabin mailbox has no compose, recipients, or delete action for either role and language", async () => {
  for (const role of ["resident", "admin"]) for (const locale of ["zh-TW", "zh-CN"]) {
    auth.user.role = role; language.setUiLanguage(locale);
    const h = await utilityMailbox();
    for (const label of ["寄件", "收件 (1)"]) {
      click(h, language.uiText(label));
      assert.equal(nodes(h.tree, n => ["input", "textarea", "select"].includes(n.type)).length, 0);
      assert.equal(nodes(h.tree, n => n.type === "button" && /寫信|写信|寄出|刪|删/.test(text(n))).length, 0);
    }
    assert.ok(calls.every(c => c.method === "get" && c.args[0] !== "/users/residents")); h.dispose();
  }
});
test("cabin mailbox read and load errors are retryable without retired writes", async () => {
  const h = await utilityMailbox();
  answer = async () => { throw Error("expired"); };
  await nodes(h.tree, n => n.type === "button" && n.props.className?.includes("utility-mail"))[0].props.onClick(); h.render();
  assert.equal(nodes(h.tree, n => n.props.role === "alert").length, 1);
  assert.equal(nodes(h.tree, n => n.props.className === "utility-body").length, 0);
  click(h, "重新讀取"); h.effects(); await tick(); h.render();
  assert.equal(nodes(h.tree, n => n.props.role === "alert").length, 1);
  click(h, "寄件");
  assert.equal(nodes(h.tree, n => n.props.role === "alert").length, 1);
  assert.equal(components(h, "CabinUtilityEmpty").length, 0);
  answer = async (_method, path) => ({ data: path === "/mail/inbox" || path === "/mail/sent" ? [] : utilityMail });
  click(h, "重新讀取"); h.effects(); await tick(); h.render();
  assert.equal(one(h, "CabinUtilityEmpty").props.title, "還沒寄出過信");
  assert.ok(calls.every(c => c.method === "get")); h.dispose();
});
test("mail read failures retain server detail without offering removed actions", async () => {
  const h = await utilityMailbox();
  answer = async () => { throw { isAxiosError: true, response: { status: 403, data: { detail: "這不是你的信" } } }; };
  await nodes(h.tree, n => n.type === "button" && n.props.className?.includes("utility-mail"))[0].props.onClick(); h.render();
  assert.match(text(h.tree), /這不是你的信/);
  assert.ok(calls.every(c => c.method === "get")); h.dispose();
});
test("late cabin mail detail cannot reopen after switching tabs or leaving", async () => {
  const h = await utilityMailbox();
  const pending = deferred(); answer = () => pending.promise;
  const read = nodes(h.tree, n => n.type === "button" && n.props.className?.includes("utility-mail"))[0].props.onClick();
  h.render(); click(h, "寄件"); pending.resolve({ data: utilityMail }); await read; h.render();
  assert.equal(nodes(h.tree, n => n.props.className === "utility-body").length, 0);
  assert.equal(button(h, "寄件").props["aria-pressed"], true);
  const leaving = deferred(); answer = () => leaving.promise;
  const read2 = nodes(h.tree, n => n.type === "button" && n.props.className?.includes("utility-mail"))[0].props.onClick();
  h.dispose(); leaving.resolve({ data: utilityMail }); await read2; h.render();
  assert.equal(nodes(h.tree, n => n.props.className === "utility-body").length, 0);
});

test("cabin furniture theme is local, readable and does not merge mailbox into the public mail route", () => {
  const css = readFileSync(resolve(root, "src/cabin-utility.css"), "utf8");
  assert.match(css, /font-size: 16px/); assert.match(css, /min-height: 48px/); assert.match(css, /overflow-wrap: anywhere/);
  assert.ok(!css.includes(":root")); assert.ok(!css.includes("--surface:"));
  for (const name of ["DiaryPage", "DrawerPage", "MailboxPage"]) {
    const source = readFileSync(resolve(root, "src/pages", name + ".tsx"), "utf8");
    assert.ok(source.includes("CabinUtilityShell"));
    assert.ok(!source.includes('var(--surface)')); assert.ok(!source.includes('var(--ink)'));
  }
  const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  assert.ok(app.includes('path="/mailbox" element={<MailboxPage'));
  assert.ok(app.includes('path="/mail" element={<MailField'));
  const cabin = load("src/data/cabin.ts").cabinZones.flatMap(z => z.furniture);
  assert.equal(cabin.find(f => f.id === "mailbox").path, "/mailbox");
  assert.equal(cabin.find(f => f.id === "drawer").path, "/home/drawer");
  assert.equal(cabin.find(f => f.id === "diary").path, "/home/diary");
});

test("twelve actual destinations remain behind authentication and use existing approved assets", () => {
  assert.equal(fieldData.FIELDS.length, 12);
  const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  for (const [id, , , , , , image] of fieldData.FIELDS) {
    assert.ok(app.includes(`path="/${id}"`));
    assert.ok(app.indexOf(`path="/${id}"`) > app.indexOf("<ProtectedRoute"));
    assert.ok(existsSync(resolve(root, "public/field-preview/assets", image)));
  }
  assert.ok(app.includes('path="/home/library" element={<BookshelfPage'));
  assert.ok(app.includes('path="/reading/:bookId"'));
});
test("frontier route is nested behind authentication and redirects signed-out visitors", () => {
  const source = ts.createSourceFile("App.tsx", readFileSync(resolve(root, "src/App.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const attribute = (node, name) => node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.text === name)?.initializer;
  const routes = [];
  function visit(node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === "Route") {
      const path = attribute(node, "path");
      if (path && ts.isStringLiteral(path) && path.text === "/frontier") routes.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(routes.length, 1, "Register exactly one /frontier route");
  let protectedAncestor = false;
  for (let parent = routes[0].parent; parent; parent = parent.parent) {
    if (!ts.isJsxElement(parent) || parent.openingElement.tagName.getText(source) !== "Route") continue;
    const element = attribute(parent.openingElement, "element");
    if (element && ts.isJsxExpression(element) && element.expression && ts.isJsxSelfClosingElement(element.expression) && element.expression.tagName.getText(source) === "ProtectedRoute") protectedAncestor = true;
  }
  assert.ok(protectedAncestor, "/frontier must be a child of the ProtectedRoute route");
  windowStub.location.pathname = "/frontier";
  auth.user = null; auth.isLoading = false;
  const h = mount(ProtectedRoute);
  assert.equal(h.tree.type.name, "Navigate"); assert.equal(h.tree.props.to, "/login"); assert.equal(h.tree.props.replace, true);
  auth.isLoading = true; h.render(); assert.notEqual(h.tree.type.name, "Outlet");
  auth.isLoading = false; auth.user = { id: "me", role: "resident" }; h.render(); assert.equal(h.tree.type.name, "Outlet");
  assert.deepEqual(calls, []); assert.deepEqual(reads, []);
});
test("standalone preview returns to the new official domain; API remains same-origin", () => {
  const preview = readFileSync(resolve(root, "public/field-preview/app.js"), "utf8");
  assert.ok(preview.includes('href="https://therookery.space/"'));
  assert.ok(!preview.includes("therookery.duckdns.org"));
  assert.ok(readFileSync(resolve(root, "src/api/client.ts"), "utf8").includes('baseURL: "/api"'));
});
test("safe links, query encoding and Taipei time do not invent source data", () => {
  assert.equal(fieldData.safeLink("javascript:alert(1)"), undefined);
  assert.equal(fieldData.safeLink("//evil.test/path"), undefined);
  assert.equal(fieldData.safeLink("some prose"), undefined);
  assert.equal(fieldData.safeLink("https://name:secret@example.test"), undefined);
  assert.equal(fieldData.safeLink("/uploads/photo.png"), "https://example.test/uploads/photo.png");
  assert.equal(fieldData.safeLink("https://example.test/art"), "https://example.test/art");
  assert.equal(fieldData.fieldQuery("/history", { category: "", q: "a&b" }), "/history?q=a%26b");
  assert.equal(fieldData.fieldTime("bad date"), "時間未提供");
  assert.match(fieldData.fieldTime("2026-09-08T00:00:00Z"), /8:00/);
  assert.equal(fieldData.fieldTime("2026-09-08T00:00:00"), fieldData.fieldTime("2026-09-08T00:00:00Z"));
});
test("resource reads are abortable, lazy, stale-safe and never retry writes", async () => {
  const a = deferred(), b = deferred(); let path = "/first";
  answer = (_method, url) => url === "/first" ? a.promise : b.promise;
  const h = mount(() => fieldData.useFieldResource(path));
  assert.equal(h.tree.loading, true); h.effects();
  const signal = calls[0].args[1].signal;
  path = "/second"; h.render(); h.effects(); assert.equal(signal.aborted, true);
  a.resolve({ data: ["old"] }); await tick(); h.render(); assert.equal(h.tree.data, undefined);
  b.reject({ isAxiosError: true, response: { status: 403, data: { detail: "需要設定出生年份" } } }); await tick(); h.render();
  assert.equal(h.tree.error.status, 403); assert.equal(h.tree.data, undefined);
  path = null; h.render(); h.effects(); assert.equal(h.tree.loading, false); assert.equal(h.tree.error, undefined);
  assert.ok(calls.every(c => c.method === "get")); h.dispose();
});
test("resource refresh hides stale results, then shows only the new response", async () => {
  answer = async () => ({ data: ["old"] }); const h = mount(() => fieldData.useFieldResource("/items"));
  h.effects(); await tick(); h.render(); assert.deepEqual(h.tree.data, ["old"]);
  const pending = deferred(); answer = () => pending.promise;
  h.tree.refresh(); h.render(); assert.equal(h.tree.data, undefined); assert.equal(h.tree.loading, true); h.effects();
  pending.resolve({ data: ["new"] }); await tick(); h.render(); assert.deepEqual(h.tree.data, ["new"]);
});
test("shared form prevents double submits, retains children and displays failure", async () => {
  const request = deferred(); let writes = 0, done = 0;
  const h = mount(shared.FieldForm, { children: jsx("textarea", { defaultValue: "保留的草稿" }), submit: async () => { writes++; await request.promise; }, onDone: () => done++ });
  const event = { preventDefault() {}, currentTarget: data({ content: "保留的草稿" }) };
  const first = h.tree.props.onSubmit(event), second = h.tree.props.onSubmit(event);
  assert.equal(writes, 1); h.render(); assert.equal(nodes(h.tree, n => n.type === "fieldset")[0].props.disabled, true);
  request.reject(Error("網路中斷")); await Promise.all([first, second]); h.render();
  assert.equal(done, 0); assert.equal(one(h, "FieldError").props.error.message, "網路中斷");
  assert.equal(nodes(h.tree, n => n.type === "textarea")[0].props.defaultValue, "保留的草稿");
});
test("shared form successful write calls refresh completion exactly once", async () => {
  let done = 0; const h = mount(shared.FieldForm, { submit: async d => assert.equal(d.get("content"), "abc"), onDone: () => done++ });
  await h.tree.props.onSubmit({ preventDefault() {}, currentTarget: data({ content: "abc" }) });
  assert.equal(done, 1);
});
test("403 age failures link to settings; server error and empty states differ", () => {
  const h = mount(shared.FieldError, { error: { status: 403, message: "需要設定出生年份" } });
  assert.equal(one(h, "Link").props.to, "/settings");
  const failed = mount(shared.ResourceState, { resource: { loading: false, error: { message: "server failed" }, refresh() {} }, empty: true });
  assert.ok(!text(failed.tree).includes("這裡還沒有內容"));
  const empty = mount(shared.ResourceState, { resource: { loading: false, refresh() {} }, empty: true });
  assert.match(text(empty.tree), /這裡還沒有內容/);
});
test("birth year requires review then explicit one-time confirmation and locks after saving", async () => {
  const pending = deferred(); auth.updateBirthYear = async year => { calls.push({ method: "birth", args: [year] }); await pending.promise; auth.user.birth_year = year; };
  const h = mount(BirthYearSettings);
  nodes(h.tree, n => n.type === "input")[0].props.onChange({ target: { value: "1997" } }); h.render();
  h.tree.props.onSubmit({ preventDefault() {} }); h.render(); assert.equal(calls.length, 0);
  button(h, "確認保存出生年").props.onClick(); button(h, "確認保存出生年").props.onClick(); assert.equal(calls.length, 1);
  pending.resolve(); await tick(); h.render();
  assert.equal(nodes(h.tree, n => n.type === "input")[0].props.readOnly, true);
  assert.ok(!text(h.tree).includes("確認保存出生年"));
});
test("unknown birth year is not null: incomplete profile must reload before editing", async () => {
  auth.user.birth_year = undefined; const h = mount(BirthYearSettings);
  assert.equal(nodes(h.tree, n => n.type === "input")[0].props.disabled, true);
  assert.ok(!text(h.tree).includes("檢查出生年")); click(h, "重新讀取帳號狀態"); await tick();
  assert.equal(calls[0].method, "profile"); assert.ok(!calls.some(c => c.method === "birth"));
});
test("birth save failure retains value and reload is read-only", async () => {
  auth.updateBirthYear = async () => { throw Error("已經設定過了"); }; const h = mount(BirthYearSettings);
  nodes(h.tree, n => n.type === "input")[0].props.onChange({ target: { value: "2000" } }); h.render();
  h.tree.props.onSubmit({ preventDefault() {} }); h.render(); click(h, "確認保存出生年"); await tick(); h.render();
  assert.equal(nodes(h.tree, n => n.type === "input")[0].props.value, "2000"); assert.match(text(h.tree), /已經設定過了/);
  click(h, "重新讀取帳號狀態"); await tick(); assert.equal(calls[0].method, "profile");
});
test("successful registration is not reported failed when follow-up profile GET fails", async () => {
  const { AuthProvider } = load("src/contexts/AuthContext.tsx");
  answer = async method => { if (method === "get") throw Error("profile offline"); return { data: { access_token: "fake-access", refresh_token: "fake-refresh", user: { id: "new" } } }; };
  const h = mount(AuthProvider, { children: null });
  await h.tree.props.value.register("resident", "not-a-real-password", "test-invite", undefined, 1998); h.render();
  assert.equal(h.tree.props.value.user.id, "new"); assert.equal(h.tree.props.value.user.birth_year, undefined);
  assert.deepEqual(tokens, ["fake-access", "fake-refresh"]);
  assert.equal(calls.filter(c => c.method === "post").length, 1);
  assert.equal(calls[0].args[1].birth_year, 1998);
});

test("all first-paint field screens have no mutations or eager detail reads", () => {
  for (const [component, props] of [[everyday.AIChatField], [everyday.MailField], [everyday.ParkField], [content.LibraryField], [content.MuseumField], [content.HistoryField], [content.ArticlesField, { kind: "health" }], [content.ArticlesField, { kind: "adult" }], [activity.WorkshopField], [activity.WeilanField], [PlazaField]]) {
    const h = mount(component, props); assert.ok(one(h, "FieldFrame"));
  }
  assert.equal(calls.length, 0); assert.ok(!reads.includes("/adult"));
  assert.ok(!reads.some(p => /^\/mail\/[^?]+$/.test(p) && !["/mail/unread"].includes(p)));
});
test("AI initiation uses a private DM code, message and explicit usage confirmation", async () => {
  fixture("/ai-chat/conversations?limit=50", []); fixture("/users/residents", { residents: [{ id: "me", agent_id: "a", agent_name: "自己" }, { id: "them", agent_id: "b", agent_name: "室友B" }] });
  const h = mount(everyday.AIChatField); click(h, "發起私訊");
  assert.equal(components(h, "FieldSelect").length, 0);
  assert.ok(!reads.includes("/users/residents"));
  assert.equal(nodes(h.tree, n => n.type === "input" && n.props.type === "checkbox")[0].props.required, true);
  writeResult = { conversation: { id: "conversation-1" } };
  await submit(h, "確認發起私訊", { to_code: " rk-ab12-cd34 ", message: " 嗨 " }, true);
  expectCall("post", "/ai-chat/initiate", { to_code: "RK-AB12-CD34", message: "嗨" });
  assert.equal(one(h, "ConversationView").props.id, "conversation-1");
});
const social = load("src/fields/socialData.ts");
const coordinates = load("src/coordinates.ts");
const { MyDMCode } = load("src/components/MyDMCode.tsx");
const { CoordinateSettings } = load("src/components/CoordinateSettings.tsx");
const { SpaceChat, SpaceChatContent } = load("src/fields/SpaceChat.tsx");
const { DMReportsPage } = load("src/pages/DMReportsPage.tsx");
const { ExternalMemorySettings } = load("src/components/ExternalMemorySettings.tsx");
const furnitureActions = load("src/components/FurnitureActions.tsx");
const dmFixture = () => ({ id: "dm/1", agent_a: { id: "a", name: "星A", avatar_emoji: "✦", replies_live: true }, agent_b: { id: "b", name: "星B", avatar_emoji: "✦", replies_live: false }, status: "active", waiting_on: "b", ended_reason: null, system_note: null, turn_count: 1, created_at: "2026-09-09T00:00:00Z", last_message_at: null, messages: [] });
function dmView(value = dmFixture()) {
  fixture("/ai-chat/conversations?limit=50", [value]); fixture("/ai-chat/dm%2F1", value);
  const outer = mount(everyday.AIChatField); click(outer, "閱讀對話");
  const inner = one(outer, "ConversationView"); return mount(inner.type, inner.props);
}
test("private DM codes normalize without accepting names or arbitrary payloads", async () => {
  assert.equal(social.normalizeDMCode(" rk-ab12-cd34 "), "RK-AB12-CD34");
  for (const value of ["宋祈言", "", "RK-1234", "RK-1234-ABCD-excess"]) assert.equal(social.validDMCode(value), false);
  fixture("/ai-chat/conversations?limit=50", []); const h = mount(everyday.AIChatField); click(h, "發起私訊");
  await assert.rejects(submit(h, "確認發起私訊", { to_code: "名字", message: "hi" }), /私訊碼/);
  assert.equal(calls.length, 0);
});
test("DM polling only runs for an active known live recipient", () => {
  const value = dmFixture(); assert.equal(social.shouldPollDM(value), false);
  value.agent_b.replies_live = true; assert.equal(social.shouldPollDM(value), true);
  value.status = "ended"; assert.equal(social.shouldPollDM(value), false);
  value.status = "active"; value.waiting_on = "missing"; assert.equal(social.shouldPollDM(value), false);
  assert.match(social.dmStatus(dmFixture()), /醒來/);
});
test("DM polling has an eight-read budget and cannot spin indefinitely", () => {
  const value = dmFixture(); value.agent_b.replies_live = true;
  const h = dmView(value); h.effects();
  for (let i = 0; i < 8; i++) {
    const t = [...timers.values()].find(t => t.delay === 15000); assert.ok(t);
    t.fn(); h.render(); h.effects();
  }
  assert.equal([...timers.values()].filter(t => t.delay === 15000).length, 0);
  assert.match(text(h.tree), /手動更新/);
  h.dispose();
});
test("sleeping and ended DM never start an automatic timer or invent a reason", () => {
  const h = dmView(); h.effects(); assert.equal(timers.size, 0);
  const value = dmFixture(); value.status = "ended"; value.ended_reason = "busy";
  assert.equal(social.dmStatus(value), "對話已結束");
  value.system_note = "對方正在忙碌中"; assert.equal(social.dmStatus(value), "對方正在忙碌中");
  h.dispose();
});
test("DM report requires reason and confirmation and sends only the selected conversation", async () => {
  const h = dmView(); assert.equal(components(h, "FieldForm").length, 0); click(h, "檢舉這段私訊");
  const f = form(h, "確認送出檢舉"); assert.equal(f.props.guarded, true);
  assert.ok(nodes(f, n => n.type === "input" && n.props.type === "checkbox" && n.props.required).length);
  await assert.rejects(submit(h, "確認送出檢舉", { reason: " " }), /原因/);
  await assert.rejects(submit(h, "確認送出檢舉", { reason: "a".repeat(501) }), /原因/);
  assert.equal(calls.length, 0);
  await submit(h, "確認送出檢舉", { reason: " 惡意騷擾 " }, true);
  expectCall("post", "/ai-chat/dm%2F1/report", { reason: "惡意騷擾" });
  assert.equal(nodes(h.tree, n => n.type === "button" && text(n) === "檢舉這段私訊").length, 0);
});
test("guarded forms block ambiguous network resubmission but keep drafts", async () => {
  let writes = 0;
  const h = mount(shared.FieldForm, { guarded: true, children: "draft", submit: async () => { writes++; throw Error("lost response"); }, onDone() {} });
  await h.tree.props.onSubmit({ preventDefault() {}, currentTarget: data({ content: "draft" }) }); h.render();
  assert.match(text(h.tree), /尚未確認/);
  assert.equal(nodes(h.tree, n => n.type === "button" && n.props.type === "submit")[0].props.disabled, true);
  await h.tree.props.onSubmit({ preventDefault() {}, currentTarget: data({ content: "draft" }) });
  assert.equal(writes, 1);
});
test("client validation failure permits correction without marking a write uncertain", async () => {
  const h = mount(shared.FieldForm, { guarded: true, submit: async () => { throw new (load("src/fields/formErrors.ts").FormValidationError)("fix input"); }, onDone() {} });
  await h.tree.props.onSubmit({ preventDefault() {}, currentTarget: data({}) }); h.render();
  assert.ok(!text(h.tree).includes("尚未確認是否"));
});
test("own DM code is read-only until copy, with manual clipboard fallback", async () => {
  fixture("/agents/mine", { dm_code: "RK-AB12-CD34" }); const h = mount(MyDMCode);
  assert.equal(calls.length, 0); await button(h, "複製私訊碼").props.onClick(); h.render();
  expectCall("copy", "RK-AB12-CD34");
  navigatorStub.clipboard = undefined; await button(h, "複製私訊碼").props.onClick(); h.render();
  assert.equal(nodes(h.tree, n => n.type === "input")[0].props.readOnly, true);
  assert.match(text(h.tree), /長按/);
});
test("eight chat spaces are lazy and disabled frames do not mount chat", () => {
  assert.deepEqual(social.CHAT_SPACES, ["plaza", "library", "park", "workshop", "museum", "weilan", "history", "health"]);
  for (const id of social.CHAT_SPACES) {
    assert.equal(one(mount(shared.FieldFrame, { id, children: null }), "SpaceChat").props.space, id);
    assert.equal(components(mount(shared.FieldFrame, { id, children: null, chatEnabled: false }), "SpaceChat").length, 0);
    const h = mount(SpaceChat, { space: id }); assert.equal(components(h, "SpaceChatContent").length, 0); assert.equal(reads.length, 0);
    click(h, "展開聊天"); assert.equal(one(h, "SpaceChatContent").props.space, id);
  }
  for (const id of ["mail", "ai-chat", "adult"]) assert.equal(components(mount(shared.FieldFrame, { id, children: null }), "SpaceChat").length, 0);
});
test("adult never mounts public chat; health does not infer age from the profile", () => {
  const h = mount(content.ArticlesField, { kind: "adult" });
  assert.equal(one(h, "FieldFrame").props.chatEnabled, false);
  assert.equal(reads.length, 0);
  nodes(h.tree, n => n.type === "input" && n.props.type === "checkbox")[0].props.onChange({ target: { checked: true } }); h.render();
  click(h, "確認進入"); assert.equal(one(h, "FieldFrame").props.chatEnabled, false);
  click(h, "離開分級式人機親密關係中心"); assert.equal(one(h, "FieldFrame").props.chatEnabled, false);
  auth.user.birth_year = null;
  const health = mount(content.ArticlesField, { kind: "health" });
  assert.equal(one(health, "FieldFrame").props.chatEnabled, true);
});
test("restricted chat waits for both reads before enabling send and export", () => {
  fixture("/spaces/health/present", { present: [] });
  const h = mount(SpaceChatContent, { space: "health" });
  assert.equal(components(h, "FieldForm").length, 0); assert.equal(button(h, "匯出帶走").props.disabled, true);
  assert.deepEqual(reads, ["/spaces/health/present", "/spaces/health/chat?limit=200"]);
  assert.equal(calls.length, 0);
});
test("403 from either restricted read hides content, people, send and export with exact server detail", () => {
  for (const space of ["health"]) for (const denied of ["present", "chat?limit=200"]) {
    fixture(`/spaces/${space}/present`, { present: [{ id: "a", name: "不可顯示的名字" }] });
    fixture(`/spaces/${space}/chat?limit=200`, { messages: [{ id: "m", sender: "人", content: "不可顯示的內容", mentions: [], expires_at: "2099-01-01T00:00:00Z" }] });
    const error = { status: 403, message: "需要設定出生年份才能進入此區域" };
    fixtures.set(`/spaces/${space}/${denied}`, { error });
    const h = mount(SpaceChatContent, { space });
    assert.deepEqual(one(h, "FieldError").props.error, error);
    assert.ok(!text(h.tree).includes("不可顯示"));
    assert.equal(components(h, "FieldForm").length, 0);
    assert.equal(nodes(h.tree, n => n.type === "button" || n.props?.download).length, 0);
    one(h, "FieldError").props.retry(); assert.ok(reads.includes(`refresh:/spaces/${space}/present`));
  }
  assert.equal(calls.length, 0);
});
test("health chat sends independently of article tiers and frontend birth year", async () => {
  auth.user.birth_year = null;
  fixture("/health-center", { allowed_tiers: [], articles: [] });
  fixture("/spaces/health/present", { present: [{ id: "a", name: "星A" }] });
  fixture("/spaces/health/chat?limit=200", { messages: [] });
  const h = mount(SpaceChatContent, { space: "health" });
  await submit(h, "送出訊息", { content: "@星A 你好" });
  expectCall("post", "/spaces/health/chat", { content: "@星A 你好", mentions: [] });
});
test("a denied send clears restricted chat and rechecks only when the user asks", async () => {
  fixture("/spaces/health/present", { present: [{ id: "a", name: "星A" }] });
  fixture("/spaces/health/chat?limit=200", { messages: [] });
  const h = mount(SpaceChatContent, { space: "health" });
  const detail = "需要設定出生年份才能進入此區域";
  answer = async () => { throw { isAxiosError: true, response: { status: 403, data: { detail } } }; };
  await assert.rejects(submit(h, "送出訊息", { content: "@星A 你好" })); h.render();
  assert.equal(one(h, "FieldError").props.error.message, detail);
  assert.equal(components(h, "FieldForm").length, 0); assert.equal(calls.length, 1);
  one(h, "FieldError").props.retry(); h.render();
  assert.equal(components(h, "FieldForm").length, 1); assert.equal(calls.length, 1);
});
test("Markdown export shows text-encoded JSON 403 detail without creating a download", async () => {
  fixture("/spaces/health/present", { present: [] }); fixture("/spaces/health/chat?limit=200", { messages: [] });
  const h = mount(SpaceChatContent, { space: "health" });
  const detail = "需要設定出生年份才能進入此區域";
  answer = async () => { throw { isAxiosError: true, response: { status: 403, data: JSON.stringify({ detail }) } }; };
  click(h, "匯出帶走"); await tick(); h.render();
  assert.equal(one(h, "FieldError").props.error.message, detail);
  assert.equal(nodes(h.tree, n => n.props?.download || n.type === "textarea").length, 0);
  assert.equal(components(h, "FieldForm").length, 0);
  assert.equal(calls.length, 1); expectCall("get", "/spaces/health/chat/export");
});
test("a normal send error retains the draft form and does not become an age denial", async () => {
  fixture("/spaces/health/present", { present: [{ id: "a", name: "星A" }] }); fixture("/spaces/health/chat?limit=200", { messages: [] });
  const h = mount(SpaceChatContent, { space: "health" });
  answer = async () => { throw { isAxiosError: true, response: { status: 400, data: { detail: "星A 已經離開" } } }; };
  await assert.rejects(submit(h, "送出訊息", { content: "@星A 草稿" })); h.render();
  assert.equal(components(h, "FieldForm").length, 1); assert.equal(components(h, "FieldError").length, 0);
  assert.equal(calls.length, 1);
});
test("space chat expires only from backend timestamps and keeps literal text", () => {
  const now = Date.parse("2026-09-09T00:00:00Z");
  const rows = [{ id: "old", expires_at: "2026-09-08T23:59:59Z" }, { id: "new", expires_at: "2026-09-09T01:00:00Z" }, { id: "bad", expires_at: "bad" }];
  assert.deepEqual(social.unexpiredMessages(rows, now).map(m => m.id), ["new"]);
  assert.equal(social.remainingTime(rows[1].expires_at, now), "還剩 1 小時");
  assert.equal(social.remainingTime(rows[0].expires_at, now), "已到期");
});
test("space chat sends selected names, not IDs, and limits content", async () => {
  fixture("/spaces/plaza/present", { present: [{ id: "agent-a", name: "星A", avatar_emoji: "✦" }] });
  fixture("/spaces/plaza/chat?limit=200", { messages: [] });
  const h = mount(SpaceChatContent, { space: "plaza" });
  assert.equal(calls.length, 0);
  await assert.rejects(submit(h, "送出訊息", { content: "hello" }), /在場/);
  nodes(h.tree, n => n.type === "input" && n.props.type === "checkbox")[0].props.onChange({ target: { checked: true } }); h.render();
  await submit(h, "送出訊息", { content: " hello " });
  expectCall("post", "/spaces/plaza/chat", { content: "hello", mentions: ["星A"] });
  await assert.rejects(submit(h, "送出訊息", { content: "a".repeat(1001) }), /1000/);
});
test("a stale mention selection does not survive a changed presence list", async () => {
  fixture("/spaces/park/present", { present: [{ id: "a", name: "星A" }] }); fixture("/spaces/park/chat?limit=200", { messages: [] });
  const h = mount(SpaceChatContent, { space: "park" });
  nodes(h.tree, n => n.type === "input" && n.props.type === "checkbox")[0].props.onChange({ target: { checked: true } });
  fixture("/spaces/park/present", { present: [] }); h.render();
  await assert.rejects(submit(h, "送出訊息", { content: "hi" }), /在場/); assert.equal(calls.length, 0);
});
test("inline @ mention works without inventing an out-of-room recipient", async () => {
  fixture("/spaces/library/present", { present: [{ id: "a", name: "星A" }] }); fixture("/spaces/library/chat?limit=200", { messages: [] });
  const h = mount(SpaceChatContent, { space: "library" });
  await submit(h, "送出訊息", { content: "@星A 今天讀什麼？" });
  expectCall("post", "/spaces/library/chat", { content: "@星A 今天讀什麼？", mentions: [] });
});
test("space export is an explicit text GET, never sends credentials in a URL", async () => {
  fixture("/spaces/park/present", { present: [] }); fixture("/spaces/park/chat?limit=200", { messages: [] });
  const h = mount(SpaceChatContent, { space: "park" }); writeResult = "# chat";
  await button(h, "匯出帶走").props.onClick(); await tick(); h.render();
  expectCall("get", "/spaces/park/chat/export");
  assert.equal(calls.at(-1).args[1].responseType, "text");
  const link = nodes(h.tree, n => n.type === "a" && n.props.download)[0]; assert.equal(link.props.download, "park-chat.md");
  assert.match(link.props.href, /^blob:/);
});
test("non-admin report route never requests privileged data", () => {
  const h = mount(DMReportsPage); assert.match(text(h.tree), /管理員/); assert.equal(reads.length, 0); assert.equal(components(h, "Reports").length, 0);
});
test("admin report review keeps server verdict and only patches after explicit confirmation", async () => {
  auth.user.role = "admin"; const p = mount(DMReportsPage); const h = mount(one(p, "Reports").type);
  const report = { id: "r/1", reporter: "甲", reported: "乙", reason: "reason", status: "pending", created_at: "2026-09-09T00:00:00Z" };
  fixture("/admin/dm-reports?status=pending", { reports: [report] }); h.render(); click(h, "查看內容與審核");
  fixture("/admin/dm-reports/r%2F1/messages", { report, messages: [] });
  const review = one(h, "Review"), r = mount(review.type, review.props);
  assert.equal(calls.length, 0);
  await submit(r, "確認保存審核", { status: "upheld", admin_note: " 已確認 " });
  expectCall("patch", "/admin/dm-reports/r%2F1", { status: "upheld", admin_note: "已確認" });
  await assert.rejects(submit(r, "確認保存審核", { status: "deleted" }), /選擇/);
});
test("report route uses the cabin shell and returns to admin, not the home fallback", () => {
  auth.user.role = "admin";
  const h = mount(DMReportsPage);
  const shell = one(h, "CabinUtilityShell");
  assert.equal(shell.props.code, "REPORTS");
  assert.equal(shell.props.title, "私訊檢舉審核");
  const rendered = mount(shell.type, shell.props);
  click(rendered, "← 系統儀表板"); expectCall("navigate", "/admin");
  const preview = readFileSync(resolve(root, "scripts/album-preview/preview.tsx"), "utf8");
  assert.ok(preview.includes('<Route path="/admin/dm-reports" element={<DMReportsPage />} />'));
  assert.ok(preview.includes('reports: "/admin/dm-reports"'));
  assert.ok(preview.includes('["admin", "reports"].includes(params.get("page")'));
});
test("report filters retain endpoint values while status badges translate and names stay raw", () => {
  auth.user.role = "admin"; language.setUiLanguage("zh-CN");
  const p = mount(DMReportsPage), h = mount(one(p, "Reports").type);
  const report = { id: "report", reporter: "繁體甲", reported: "繁體乙", reason: "保留原文：圖書館", status: "pending", created_at: "2026-09-09T00:00:00Z" };
  fixture("/admin/dm-reports?status=pending", { reports: [report] }); h.render();
  assert.match(text(h.tree), /待审核/); assert.match(text(h.tree), /繁體甲/);
  assert.match(text(h.tree), /保留原文：圖書館/);
  for (const value of ["upheld", "dismissed", "pending"]) {
    tab(h, value);
    assert.equal(reads.at(-1), "/admin/dm-reports?status=" + value);
    assert.deepEqual(Object.keys(one(h, "FieldTabs").props.options), ["pending", "upheld", "dismissed"]);
  }
  assert.equal(calls.length, 0);
});
test("report list keeps loading and permission errors distinct from its empty state", () => {
  auth.user.role = "admin";
  const h = mount(one(mount(DMReportsPage), "Reports").type);
  assert.equal(button(h, "更新清單").props.disabled, true);
  assert.equal(one(h, "ResourceState").props.resource.loading, true);
  fixture("/admin/dm-reports?status=pending", { reports: [] }); h.render();
  assert.match(text(h.tree), /目前沒有待審核的檢舉/);
  assert.equal(button(h, "更新清單").props.disabled, false);
  click(h, "更新清單"); assert.ok(reads.includes("refresh:/admin/dm-reports?status=pending"));
  fixtures.set("/admin/dm-reports?status=pending", { error: { status: 403, message: "需要管理員權限" } }); h.render();
  assert.equal(one(h, "ResourceState").props.resource.error.status, 403);
  assert.ok(!text(h.tree).includes("目前沒有待審核的檢舉"));
  assert.equal(nodes(h.tree, n => n.props.className === "reports-item").length, 0);
  assert.equal(components(h, "Review").length, 0);
});
test("report details show escaped conversation text and existing verdict without auto-writing", async () => {
  auth.user.role = "admin"; language.setUiLanguage("zh-CN");
  const report = { id: "r/1", reporter: "繁體甲", reported: "繁體乙", reason: "原始理由", status: "dismissed", admin_note: "既有備註", created_at: "2026-09-09T00:00:00Z", resolved_at: "2026-09-10T00:00:00Z" };
  fixture("/admin/dm-reports?status=pending", { reports: [report] });
  const list = mount(one(mount(DMReportsPage), "Reports").type);
  click(list, "查看内容与审核");
  const review = one(list, "Review");
  fixture("/admin/dm-reports/r%2F1/messages", { report, messages: [{ sender: "繁體乙", content: '<script>alert("not executable")</script>\n原始對話', created_at: report.created_at }] });
  const h = mount(review.type, review.props);
  assert.match(text(h.tree), /相关对话/);
  assert.ok(text(h.tree).includes('<script>alert("not executable")</script>'));
  assert.equal(nodes(h.tree, n => n.type === "script" || n.props.dangerouslySetInnerHTML).length, 0);
  assert.equal(one(h, "FieldSelect").props.value, "dismissed");
  assert.equal(nodes(h.tree, n => n.type === "textarea")[0].props.defaultValue, "既有備註");
  assert.equal(nodes(h.tree, n => n.type === "input" && n.props.type === "checkbox")[0].props.required, true);
  assert.equal(one(h, "FieldForm").props.guarded, true);
  assert.equal(calls.length, 0);
  await assert.rejects(submit(h, "确认保存审核", { status: "__proto__" }), /選擇/);
  assert.equal(calls.length, 0);
  await submit(h, "确认保存审核", { status: "pending", admin_note: "" });
  expectCall("patch", "/admin/dm-reports/r%2F1", { status: "pending", admin_note: null });
});
test("report detail missing, failed and empty conversation states do not invent evidence", () => {
  auth.user.role = "admin";
  fixture("/admin/dm-reports?status=pending", { reports: [{ id: "report", reporter: "甲", reported: "乙" }] });
  const list = mount(one(mount(DMReportsPage), "Reports").type);
  click(list, "查看內容與審核"); const review = one(list, "Review");
  const h = mount(review.type, review.props);
  assert.equal(one(h, "ResourceState").props.resource.loading, true);
  assert.equal(components(h, "FieldForm").length, 0);
  fixtures.set("/admin/dm-reports/report/messages", { error: { status: 404, message: "找不到這筆檢舉" } }); h.render();
  assert.equal(one(h, "ResourceState").props.resource.error.status, 404);
  assert.equal(components(h, "FieldForm").length, 0);
  fixture("/admin/dm-reports/report/messages", { report: { id: "report", reporter: "甲", reported: "乙", status: "pending" }, messages: [] }); h.render();
  assert.match(text(h.tree), /目前沒有可顯示的對話訊息/);
  assert.equal(nodes(h.tree, n => n.type === "li").length, 0);
  assert.equal(calls.length, 0);
});
test("review completion and dismissal refresh the list without a second verdict write", () => {
  auth.user.role = "admin";
  fixture("/admin/dm-reports?status=pending", { reports: [{ id: "report" }] });
  const h = mount(one(mount(DMReportsPage), "Reports").type);
  click(h, "查看內容與審核");
  one(h, "Review").props.onDone(); h.render();
  assert.match(text(h.tree), /審核結果已保存/);
  assert.equal(components(h, "Review").length, 0);
  assert.equal(reads.at(-1), "/admin/dm-reports?status=pending");
  assert.ok(reads.includes("refresh:/admin/dm-reports?status=pending"));
  click(h, "查看內容與審核"); one(h, "FieldDialog").props.onClose(); h.render();
  assert.equal(components(h, "FieldDialog").length, 0);
  assert.equal(calls.length, 0);
});
test("report styling scopes the native dialog and shared form to the approved cabin tokens", () => {
  const css = readFileSync(resolve(root, "src/dm-reports.css"), "utf8");
  assert.match(css, /\.dm-reports, \.dm-reports \.field-dialog/);
  assert.match(css, /--accent: var\(--album-accent\)/);
  assert.match(css, /\.dm-reports \.field-input select/);
  assert.match(css, /max-height: calc\(100dvh - 32px\)/);
  assert.match(css, /\.dm-reports \.field-dialog::backdrop/);
  assert.ok(!/(^|\n)\s*(?:body|html|:root|\.field-app|\.field-dialog)\s*[{,]/m.test(css));
  const source = readFileSync(resolve(root, "src/pages/DMReportsPage.tsx"), "utf8");
  assert.ok(!/localStorage|sessionStorage|console\.|dangerouslySetInnerHTML/.test(source));
});
test("coordinate model differentiates drifting, partial, zero, and missing data", () => {
  assert.equal(coordinates.coordinateView({ drifting: true }).longitude, "—");
  assert.equal(coordinates.coordinateView({ coordinate: { l: 0, b: 0, r: 0 }, partial: true }).latitude, "尚未設定");
  assert.equal(coordinates.coordinateView({ coordinate: { l: 0, b: 0, r: 0, partial: true } }).label, "定了經度、還在找緯度");
  assert.equal(coordinates.coordinateView({ coordinate: { l: 0, b: 0, r: 0 } }).latitude, "b +0.00°");
});
test("important dates accept leap day but never a year or impossible calendar date", () => {
  for (const value of ["02-29", "10-15", "01-01", "12-31"]) assert.equal(coordinates.validMonthDay(value), true);
  for (const value of ["02-30", "04-31", "13-01", "00-10", "2026-01-01", "1-1", ""]) assert.equal(coordinates.validMonthDay(value), false);
});
test("unknown anchor data cannot create an editable write path", () => {
  const h = mount(CoordinateSettings); assert.match(text(h.tree), /尚未完整/);
  assert.equal(nodes(h.tree, n => n.type === "button" && n.props.type === "submit").length, 0);
  assert.equal(calls.length, 0);
});
test("second anchor is reviewed first, then saved alone; first anchor is never submitted", async () => {
  auth.user.anchor_date_1 = "09-09"; auth.user.anchor_date_2 = null;
  const h = mount(CoordinateSettings); const inputs = nodes(h.tree, n => n.type === "input");
  assert.equal(inputs[0].props.readOnly, true);
  inputs[1].props.onChange({ target: { value: "02-29" } }); h.render();
  h.tree.props.onSubmit({ preventDefault() {} }); h.render(); assert.equal(calls.length, 0);
  await button(h, "確認保存第二個日子").props.onClick(); await tick(); h.render();
  assert.deepEqual(calls.find(c => c.method === "patch").args, ["/users/me/anchors", { anchor_date_2: "02-29" }]);
});
test("anchor network failure requires readback before attempting another write", async () => {
  auth.user.anchor_date_1 = "09-09"; auth.user.anchor_date_2 = null;
  answer = async () => { throw Error("offline"); };
  const h = mount(CoordinateSettings); nodes(h.tree, n => n.type === "input")[1].props.onChange({ target: { value: "10-15" } }); h.render();
  h.tree.props.onSubmit({ preventDefault() {} }); h.render();
  await button(h, "確認保存第二個日子").props.onClick(); await tick(); h.render();
  assert.match(text(h.tree), /不會直接重送/);
  assert.equal(nodes(h.tree, n => n.type === "button" && text(n) === "確認保存第二個日子").length, 0);
});
test("saved second anchor is immutable in the interface", () => {
  auth.user.anchor_date_1 = "09-09"; auth.user.anchor_date_2 = "02-29";
  const h = mount(CoordinateSettings);
  assert.ok(nodes(h.tree, n => n.type === "input").every(n => n.props.readOnly));
  assert.equal(nodes(h.tree, n => n.type === "button" && n.props.type === "submit").length, 0);
});
test("external memory choice saves only memory fields and never an OB switch or key", async () => {
  const agent = { id: "a", memory_mcp: null, memory_recall_tool: null };
  const h = mount(ExternalMemorySettings, { agent, mcps: [{ name: "vault" }], onSaved() {}, onBusyChange() {} });
  nodes(h.tree, n => n.type === "input" && n.props.type === "radio")[1].props.onChange(); h.render();
  await submit(h, "保存記憶來源", { recall: " recall_custom " });
  expectCall("patch", "/agents/a", { memory_mcp: "vault", memory_recall_tool: "recall_custom" });
  nodes(h.tree, n => n.type === "input" && n.props.type === "radio")[0].props.onChange(); h.render();
  await submit(h, "保存記憶來源", {});
  expectCall("patch", "/agents/a", { memory_mcp: "", memory_recall_tool: "" });
});
test("wardrobe change and remove use distinct POST contracts", async () => {
  fixture("/outfits/", [{ id: "coat", name: "外套" }]); fixture("/outfits/current", { outfit: null });
  const h = mount(furnitureActions.WardrobeActions, { onBusyChange() {} }); assert.equal(calls.length, 0);
  await submit(h, "確認換裝", { outfit_id: "coat" }); expectCall("post", "/outfits/change", { outfit_id: "coat" });
  await submit(h, "確認換裝", { outfit_id: "none" }); expectCall("post", "/outfits/remove");
  await assert.rejects(submit(h, "確認換裝", { outfit_id: "missing" }), /清單/);
});
test("dining invite requires a real image multipart body, not JSON", async () => {
  fixture("/home/dining/current", { active: false }); const h = mount(furnitureActions.DiningActions, { onBusyChange() {} });
  const f = form(h, "邀請室友一起吃飯"); const body = new FormData(); body.append("photo", new Blob(["image"], { type: "image/png" }), "meal.png"); body.append("description", " dinner ");
  await f.props.submit(body); expectCall("post", "/home/dining/invite");
  assert.ok(calls.at(-1).args[1] instanceof FormData); assert.equal(calls.at(-1).args[1].get("description"), "dinner");
  await assert.rejects(f.props.submit(data({ photo: "text" })), /5MB/);
});
test("active dining offers an explicit end, never a duplicate invite", async () => {
  fixture("/home/dining/current", { active: true, status: "pending" }); const h = mount(furnitureActions.DiningActions, { onBusyChange() {} });
  assert.equal(components(h, "FieldForm").length, 1); assert.match(text(h.tree), /等待室友/);
  await submit(h, "確認結束用餐", {}); expectCall("post", "/home/dining/end");
});
test("pet capacity follows server data and interactions use action query params", async () => {
  fixture("/pets", { pets: [{ id: "cat/1", name: "貓", species: "cat", emoji: "🐈", is_alive: true }], max_pets: 1 });
  const h = mount(furnitureActions.PetActions, { onBusyChange() {} });
  assert.equal(components(h, "FieldForm").length, 1);
  await submit(h, "確認與 貓 互動", { action: "feed" }); expectCall("post", "/pets/cat%2F1/interact");
  assert.equal(calls.at(-1).args[1], null); assert.deepEqual(calls.at(-1).args[2], { params: { action: "feed" } });
  await assert.rejects(submit(h, "確認與 貓 互動", { action: "kill" }), /互動方式/);
});
test("pet adoption uses exact fields and cannot be auto-triggered from scenery", async () => {
  fixture("/pets", { pets: [], max_pets: 1 }); const h = mount(furnitureActions.PetActions, { onBusyChange() {} });
  assert.equal(calls.length, 0); await submit(h, "確認領養小夥伴", { name: " 小貓 ", species: "cat", emoji: "🐈" });
  expectCall("post", "/pets/adopt", { name: "小貓", species: "cat", emoji: "🐈" });
});
test("directory uses only the server-provided public code, never private endpoints", () => {
  const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  assert.ok(app.includes('path="/admin/dm-reports"')); assert.ok(app.includes('path="/resident/:agentId"'));
  const directory = readFileSync(resolve(root, "src/pages/ResidentDirectory.tsx"), "utf8");
  assert.ok(directory.includes("agent_dm_code")); assert.ok(!directory.includes("/agents/mine"));
  assert.ok(!directory.includes("索取")); assert.ok(!directory.includes("dm_code_for"));
  assert.ok(!directory.includes("dangerouslySetInnerHTML")); assert.ok(!directory.includes("iframe"));
  const legacy = readFileSync(resolve(root, "src/fields/EverydayFields.tsx"), "utf8");
  assert.ok(!legacy.includes("to_agent_name"));
});
const { ResidentDirectory, ResidentIdentity, PublicDMCode } = load("src/pages/ResidentDirectory.tsx");
const { EditAgentPage } = load("src/pages/EditAgentPage.tsx");
const editorAgent = { id: "test-agent", name: "範例室友", persona: "本地測試", llm_provider: "claude", llm_model: "test-model", avatar_emoji: "✦", avatar_url: null, display_brain: "", dm_code_public: true };
async function openDMEditor(value = true) {
  answer = async (method, url, payload) => ({ data: url === "/agents/providers" ? { providers: [{ key: "claude", name: "Claude" }], disclaimer: "本地測試" } : { ...editorAgent, dm_code_public: value, ...(method === "patch" ? payload : {}) } });
  const h = mount(EditAgentPage); h.effects(); await tick(); h.render();
  return h;
}
const dmSwitch = h => nodes(h.tree, n => n.props?.id === "editor-dm-code-public")[0];
function setDMVisibility(h, checked) { dmSwitch(h).props.onChange({ target: { checked } }); h.render(); }
const saveEditor = h => nodes(h.tree, n => n.type === "form")[0].props.onSubmit({ preventDefault() {} });

const byId = (h, id) => nodes(h.tree, n => n.props?.id === id)[0];
const changeValue = (h, id, value) => { byId(h, id).props.onChange({ target: { value } }); h.render(); };
async function openNoteEditor(note = null) {
  answer = async (method, url, payload) => ({ data: url === "/users/me" ? { note_to_agent: note, ...(method === "patch" ? payload : {}) } : url === "/agents/providers" ? { providers: [{ key: "claude", name: "Claude" }], disclaimer: "本地測試" } : { ...editorAgent, ...(method === "patch" ? payload : {}) } });
  const h = mount(EditAgentPage); h.effects(); await tick(); h.render(); return h;
}
test("mirror reads a single note, distinguishes empty from missing, and never writes on open", async () => {
  for (const note of [null, "", "每次醒來記得看看窗外。"]) {
    const h = await openNoteEditor(note);
    assert.equal(byId(h, "editor-note").props.value, note ?? "");
    assert.equal(byId(h, "editor-note").props.disabled, false);
    assert.ok(!calls.some(c => c.method === "patch")); h.dispose();
  }
  const h = await openDMEditor(); // /users/me lacks note field
  assert.equal(byId(h, "editor-note").props.disabled, true);
  assert.match(text(h.tree), /不會覆蓋原有留言/);
  changeValue(h, "editor-name", "新名字"); await saveEditor(h);
  assert.ok(!calls.some(c => c.method === "patch" && c.args[0] === "/users/me"));
});
test("note-only save and clearing send exactly note_to_agent without PATCHing agent", async () => {
  for (const [initial, draft] of [[null, "你好，星星。"], ["舊的話", ""]]) {
    const h = await openNoteEditor(initial); calls.length = 0;
    changeValue(h, "editor-note", draft); assert.match(text(h.tree), /尚未保存/);
    await saveEditor(h); h.render();
    assert.deepEqual(calls.filter(c => c.method === "patch"), [{ method: "patch", args: ["/users/me", { note_to_agent: draft }] }]);
    expectCall("navigate", "/"); h.dispose();
  }
});
test("unchanged and reverted notes do not overwrite server values", async () => {
  const h = await openNoteEditor("原文"); calls.length = 0;
  changeValue(h, "editor-note", "草稿"); changeValue(h, "editor-note", "原文");
  await saveEditor(h); assert.ok(!calls.some(c => c.method === "patch"));
});
test("note counts Unicode characters and rejects 1001 without losing draft", async () => {
  const h = await openNoteEditor(""); calls.length = 0;
  changeValue(h, "editor-note", "🌌".repeat(1001)); await saveEditor(h); h.render();
  assert.match(text(h.tree), /上限 1000 字/); assert.equal(calls.length, 0);
  assert.equal(Array.from(byId(h, "editor-note").props.value).length, 1001);
  changeValue(h, "editor-note", "🌌".repeat(1000)); await saveEditor(h);
  assert.equal(calls.find(c => c.method === "patch").args[1].note_to_agent, "🌌".repeat(1000));
});
test("failed note after successful metadata keeps draft and retries only the note", async () => {
  const h = await openNoteEditor("舊留言"); calls.length = 0;
  changeValue(h, "editor-name", "新名字"); changeValue(h, "editor-note", "新留言");
  answer = async (_method, url, payload) => {
    if (url === "/users/me") throw { isAxiosError: true, response: { data: { detail: "留言暫時無法保存" } } };
    return { data: { ...editorAgent, ...payload } };
  };
  await saveEditor(h); h.render();
  assert.equal(byId(h, "editor-note").props.value, "新留言");
  assert.match(text(h.tree), /室友資料已保存/); assert.ok(!calls.some(c => c.method === "navigate"));
  calls.length = 0; answer = async (_m, _u, payload) => ({ data: payload });
  await saveEditor(h);
  assert.deepEqual(calls.filter(c => c.method === "patch").map(c => c.args[0]), ["/users/me"]);
});
test("successful avatar is not uploaded twice when the following note save fails", async () => {
  const h = await openNoteEditor(""); calls.length = 0;
  changeValue(h, "editor-avatar", "photo");
  byId(h, "editor-photo").props.onChange({ target: { files: [new File(["fixture"], "avatar.png", { type: "image/png" })] } }); h.render();
  changeValue(h, "editor-note", "留給你");
  answer = async (method, url) => {
    if (method === "post") return { data: { avatar_url: "/uploads/local-test.png" } };
    if (url === "/users/me") throw { isAxiosError: true, response: { data: { detail: "留言失敗" } } };
    throw Error("Unexpected write");
  };
  await saveEditor(h); h.render(); assert.match(text(h.tree), /頭像已保存/);
  assert.equal(byId(h, "editor-note").props.value, "留給你");
  answer = async (_method, _url, payload) => ({ data: payload });
  await saveEditor(h);
  assert.equal(calls.filter(c => c.method === "post").length, 1);
  assert.equal(calls.filter(c => c.method === "patch" && c.args[0] === "/users/me").length, 2);
});
test("note dirty state protects return and repeated save is single-flight", async () => {
  const h = await openNoteEditor(""); calls.length = 0; changeValue(h, "editor-note", "留著");
  windowStub.confirm = () => false; button(h, "← 返回艙室").props.onClick(); assert.equal(calls.length, 0);
  const pending = deferred(); answer = () => pending.promise;
  const a = saveEditor(h), b = saveEditor(h); assert.equal(calls.length, 1);
  pending.resolve({ data: { note_to_agent: "留著" } }); await Promise.all([a, b]);
  delete windowStub.confirm;
});

test("memory recovery deep link focuses the loaded note once without saving or erasing it", async () => {
  windowStub.location.hash = "#editor-note";
  const h = await openNoteEditor("保留這段話");
  let focused = 0, scrolled = 0;
  byId(h, "editor-note").props.ref.current = { focus() { focused++; }, scrollIntoView() { scrolled++; } };
  h.effects(); assert.equal(focused, 1); assert.equal(scrolled, 1);
  changeValue(h, "editor-note", "新草稿"); h.effects(); assert.equal(focused, 1);
  assert.ok(calls.every(c => c.method === "get")); assert.equal(byId(h, "editor-note").props.value, "新草稿"); h.dispose();
});
for (const status of [400, 413]) {
  test(`avatar HTTP ${status} displays server detail and preserves staged file for explicit retry`, async () => {
    const h = await openNoteEditor(""); changeValue(h, "editor-avatar", "photo");
    byId(h, "editor-photo").props.onChange({ target: { files: [new File(["fixture"], "keep-avatar.png", { type: "image/png" })] } }); h.render(); calls.length = 0;
    answer = async () => { throw { isAxiosError: true, response: { status, data: { detail: "頭像檔案太大，最多 2MB" } } }; };
    await saveEditor(h); h.render();
    assert.match(text(h.tree), /頭像檔案太大，最多 2MB/); assert.match(text(h.tree), /keep-avatar.png/);
    assert.equal(nodes(h.tree, n => n.props.role === "alert").length, 1);
    assert.equal(calls.length, 1); assert.equal(calls[0].method, "post"); assert.equal(calls[0].args[0], "/agents/mine/avatar");
    answer = async () => ({ data: { avatar_url: "/uploads/test-retry.png" } }); await saveEditor(h);
    assert.equal(calls.filter(c => c.method === "post").length, 2); assert.equal(calls.filter(c => c.method === "navigate").length, 1); h.dispose();
  });
}

const photoApi = load("src/api/furniture.ts");
const { PhotoFramePage } = load("src/pages/PhotoFramePage.tsx");
const { PhotoImage } = load("src/components/PhotoImage.tsx");
const samplePhoto = id => ({ id, caption: "照片" + id, url: "/api/home/furniture/photos/" + id + "/file?exp=test&sig=fixture", is_displayed: id === "a", width: 1600, height: 1200, bytes: 500, created_at: "2026-09-09T00:00:00Z" });
const albumFixture = (ids = ["a", "b"], displayed = "a") => ({ photos: ids.map(samplePhoto), max: 20, displayed_id: displayed });
const { CabinPhotoFrame } = load("src/components/CabinPhotoFrame.tsx");
const { frameMatrix, cabinFrameMatrix, FRAME_SURFACE, CABIN_FRAME_QUAD } = load("src/data/cabin-frame.ts");
const frameProps = photo => ({ active: true, photo, sceneSize: { width: 390, height: 550 }, imageSize: { width: 1053, height: 1494 }, positionY: .5 });
const frameSurface = h => nodes(h.tree, n => n.props.className === "cabin-frame-surface")[0];
const frameImages = h => nodes(h.tree, n => n.type === "img");
const projectedPoint = (m, x, y) => {
  const denominator = m[3] * x + m[7] * y + m[15];
  return { x: (m[0] * x + m[4] * y + m[12]) / denominator, y: (m[1] * x + m[5] * y + m[13]) / denominator };
};
test("cabin frame homography lands all four photo corners inside the original aperture", () => {
  const m = cabinFrameMatrix(1053, 1494, 1053, 1494, .5);
  const input = [[0, 0], [FRAME_SURFACE.width, 0], [FRAME_SURFACE.width, FRAME_SURFACE.height], [0, FRAME_SURFACE.height]];
  input.forEach(([x, y], index) => {
    const p = projectedPoint(m, x, y), q = CABIN_FRAME_QUAD[index];
    assert.ok(Math.abs(p.x - q.x * 1053) < 1e-7);
    assert.ok(Math.abs(p.y - q.y * 1494) < 1e-7);
  });
});
test("cabin frame follows object-fit cover at narrow, tall and landscape scene sizes", () => {
  for (const [w, h] of [[320, 280], [358, 500], [390, 640], [528, 700], [720, 300], [1053, 1494]]) {
    const positionY = w / h > .9 ? .8 : .5, scale = Math.max(w / 1053, h / 1494);
    const m = cabinFrameMatrix(w, h, 1053, 1494, positionY);
    assert.ok(m.every(Number.isFinite));
    [[0, 0], [120, 0], [120, 184], [0, 184]].forEach(([x, y], i) => {
      const p = projectedPoint(m, x, y), q = CABIN_FRAME_QUAD[i];
      assert.ok(Math.abs(p.x - (q.x * 1053 * scale + (w - 1053 * scale) / 2)) < 1e-7);
      assert.ok(Math.abs(p.y - (q.y * 1494 * scale + (h - 1494 * scale) * positionY)) < 1e-7);
    });
  }
});
test("frame geometry accepts flat rectangles and rejects invalid or degenerate surfaces", () => {
  const quad = [{ x: 10, y: 20 }, { x: 130, y: 20 }, { x: 130, y: 204 }, { x: 10, y: 204 }];
  assert.deepEqual(projectedPoint(frameMatrix(quad), 60, 92), { x: 70, y: 112 });
  for (const value of [0, -1, Infinity, NaN]) {
    assert.equal(frameMatrix(quad, value), null);
    assert.equal(frameMatrix(quad, 120, value), null);
    assert.equal(cabinFrameMatrix(value, 550, 1053, 1494, .5), null);
  }
  assert.equal(frameMatrix(Array(4).fill({ x: 0, y: 0 })), null);
  assert.equal(cabinFrameMatrix(390, 550, 1053, 1494, NaN), null);
});
test("unavailable and empty cabin frames mask the baked-in picture without inventing a photo", () => {
  for (const [photo, state] of [[undefined, "unavailable"], [null, "empty"]]) {
    const h = mount(CabinPhotoFrame, frameProps(photo));
    assert.equal(frameSurface(h).props["data-frame-state"], state);
    assert.equal(frameImages(h).length, 0);
    assert.equal(h.tree.props["aria-hidden"], false);
    assert.match(frameSurface(h).props.style.transform, /^matrix3d\(/);
  }
  assert.equal(calls.length, 0);
});
test("cabin photo switches signed URLs without flashing old images, and clears to an empty mat", () => {
  const props = frameProps(samplePhoto("a")), h = mount(CabinPhotoFrame, props);
  assert.equal(frameSurface(h).props["data-frame-state"], "loading");
  assert.equal(frameImages(h)[0].props.style.opacity, 0);
  frameImages(h)[0].props.onLoad(); h.render();
  assert.equal(frameSurface(h).props["data-frame-state"], "displayed");
  assert.equal(frameImages(h)[0].props.style.opacity, 1);
  props.photo = samplePhoto("b"); h.render();
  assert.equal(frameImages(h)[0].props.src, samplePhoto("b").url);
  assert.equal(frameImages(h)[0].props.style.opacity, 0);
  assert.equal(frameImages(h)[0].key, samplePhoto("b").url);
  assert.equal(frameImages(h)[0].props.referrerPolicy, "no-referrer");
  frameImages(h)[0].props.onLoad(); h.render();
  assert.equal(frameSurface(h).props["aria-label"], samplePhoto("b").caption);
  props.photo = null; h.render();
  assert.equal(frameSurface(h).props["data-frame-state"], "empty");
  assert.equal(frameImages(h).length, 0);
  assert.equal(calls.length, 0);
});
test("failed cabin image stays matte with no retry loop; a renewed URL can load", () => {
  const props = frameProps(samplePhoto("a")), h = mount(CabinPhotoFrame, props);
  frameImages(h)[0].props.onError(); h.render();
  assert.equal(frameSurface(h).props["data-frame-state"], "error");
  assert.match(frameSurface(h).props["aria-label"], /開啟相簿更新/);
  assert.equal(frameImages(h).length, 0);
  props.photo = { ...props.photo, url: props.photo.url + "&renewed=1" }; h.render();
  assert.equal(frameSurface(h).props["data-frame-state"], "loading");
  frameImages(h)[0].props.onLoad(); h.render();
  assert.equal(frameSurface(h).props["data-frame-state"], "displayed");
  props.active = false; h.render();
  assert.equal(h.tree.props["aria-hidden"], true);
  assert.ok(!h.tree.props.className.includes("is-current"));
  props.sceneSize = { width: 0, height: 0 }; h.render();
  assert.equal(h.tree, null);
  assert.equal(calls.length, 0);
});
test("scene photo overlay does not intercept furniture and keeps the original image and crop", () => {
  const css = readFileSync(resolve(root, "src/cabin-home.css"), "utf8");
  const rule = css.match(/\.cabin-photo-frame\s*\{([^}]+)\}/)[1];
  assert.match(rule, /pointer-events:\s*none/);
  assert.match(rule, /z-index:\s*1/);
  assert.match(css, /\.cabin-frame-surface\s*\{[^}]*background:\s*#121318/);
  assert.match(css, /\.cabin-frame-surface\s*>\s*img\s*\{[^}]*object-fit:\s*contain/);
  const { cabinZones } = load("src/data/cabin.ts");
  assert.equal(cabinZones.find(z => z.id === "memory").image, "/ya-chao-assets/cabin-memory-v1.webp");
});
test("home frame and hotspot use the same authoritative displayed photo; frame appears only in memory zone", async () => {
  const summary = { clock: { timezone: "Asia/Taipei" }, photo_frame: { photo: samplePhoto("b"), photo_count: 2 } };
  answer = async (_method, url) => ({ data: url === "/home/furniture" ? summary : url === "/home/dashboard" ? { agents: [], community_status: { message: "公告" } } : [] });
  const h = mount(load("src/pages/HomePage.tsx").HomePage);
  h.effects(); await tick(); h.render();
  assert.equal(one(h, "CabinPhotoFrame").props.photo, summary.photo_frame.photo);
  assert.equal(one(h, "CabinPhotoFrame").props.active, false);
  const slider = () => nodes(h.tree, n => n.type === "input" && n.props.type === "range")[0];
  slider().props.onChange({ target: { value: "1" } }); h.render();
  assert.equal(one(h, "CabinPhotoFrame").props.active, true);
  assert.deepEqual(one(h, "CabinPhotoFrame").props.imageSize, { width: 1053, height: 1494 });
  nodes(h.tree, n => n.props["aria-label"] === "查看相框")[0].props.onClick(); h.render();
  assert.equal(one(h, "PhotoImage").props.src, summary.photo_frame.photo.url);
  click(h, "開啟相簿 ›"); expectCall("navigate", "/home/photos");
  slider().props.onChange({ target: { value: "2" } }); h.render();
  assert.equal(one(h, "CabinPhotoFrame").props.active, false);
  assert.ok(calls.every(c => c.method === "get" || c.method === "navigate"));
  h.dispose();
});
test("returning to the cabin synchronizes the display, coalesces focus events, and skips hidden tabs", async () => {
  let currentPhoto = samplePhoto("a"), pending = null;
  answer = async (_method, url) => url === "/home/furniture" ? pending ? pending.promise : { data: { clock: {}, photo_frame: { photo: currentPhoto } } } : { data: url === "/home/dashboard" ? { agents: [], community_status: {} } : [] };
  const h = mount(load("src/pages/HomePage.tsx").HomePage);
  const count = () => calls.filter(c => c.args[0] === "/home/furniture").length;
  h.effects(); await tick(); h.render();
  assert.equal(count(), 1); assert.equal(one(h, "CabinPhotoFrame").props.photo.id, "a");
  documentStub.hidden = true; emit(documentEvents, "visibilitychange"); emit(windowEvents, "focus"); emit(windowEvents, "pageshow");
  assert.equal(count(), 1);
  documentStub.hidden = false; pending = deferred();
  emit(documentEvents, "visibilitychange"); emit(windowEvents, "focus"); emit(windowEvents, "pageshow");
  assert.equal(count(), 2);
  pending.resolve({ data: { clock: {}, photo_frame: { photo: samplePhoto("b") } } });
  await tick(); h.render(); assert.equal(one(h, "CabinPhotoFrame").props.photo.id, "b");
  pending = null; currentPhoto = null; emit(windowEvents, "pageshow");
  await tick(); h.render(); assert.equal(one(h, "CabinPhotoFrame").props.photo, null);
  assert.equal(count(), 3);
  assert.ok(calls.every(c => c.method === "get"));
  h.dispose();
  emit(windowEvents, "focus"); emit(windowEvents, "pageshow"); emit(documentEvents, "visibilitychange");
  assert.equal(count(), 3);
  assert.equal(windowEvents.get("focus").size, 0);
  assert.equal(windowEvents.get("pageshow").size, 0);
  assert.equal(documentEvents.get("visibilitychange").size, 0);
});
test("a late cabin summary cannot repaint an unmounted frame, and offline refresh preserves the last known photo", async () => {
  const pending = deferred();
  answer = async (_method, url) => url === "/home/furniture" ? pending.promise : { data: url === "/home/dashboard" ? { agents: [], community_status: {} } : [] };
  const h = mount(load("src/pages/HomePage.tsx").HomePage);
  h.effects(); h.dispose(); pending.resolve({ data: { clock: {}, photo_frame: { photo: samplePhoto("a") } } });
  await tick(); h.render(); assert.equal(one(h, "CabinPhotoFrame").props.photo, undefined);
  answer = async (_method, url) => ({ data: url === "/home/furniture" ? { clock: {}, photo_frame: { photo: samplePhoto("a") } } : url === "/home/dashboard" ? { agents: [], community_status: {} } : [] });
  const current = mount(load("src/pages/HomePage.tsx").HomePage);
  current.effects(); await tick(); current.render();
  answer = async () => { throw Error("offline"); };
  emit(windowEvents, "focus"); await tick(); current.render();
  assert.equal(one(current, "CabinPhotoFrame").props.photo.id, "a");
  current.dispose();
});
async function openAlbum(value = albumFixture()) {
  answer = async () => ({ data: value });
  const h = mount(PhotoFramePage); h.effects(); await tick(); h.render(); return h;
}
const tileButton = (h, index, label) => {
  const tile = nodes(h.tree, n => n.type === "article")[index];
  return nodes(tile, n => n.type === "button" && text(n) === label)[0];
};
const nativeSubmit = (h, label) => nodes(h.tree, n => n.type === "form" && n.props["aria-label"] === label)[0].props.onSubmit({ preventDefault() {} });
test("photo API validates size and MIME, including iOS HEIC, before any request", async () => {
  assert.equal(photoApi.validatePhotoFile(new File(["ok"], "x.heic", { type: "image/heic" })), null);
  assert.equal(photoApi.validatePhotoFile(new File(["ok"], "x.HEIF")), null);
  for (const f of [new File([], "x.png", { type: "image/png" }), new File(["bad"], "x.txt", { type: "text/plain" }), new File([new Uint8Array(12 * 1024 * 1024 + 1)], "big.png", { type: "image/png" })]) {
    assert.ok(photoApi.validatePhotoFile(f)); await assert.rejects(photoApi.uploadPhoto(f, ""));
  }
  assert.equal(calls.length, 0);
});
test("photo upload sends file and caption as multipart fields, with no caption query", async () => {
  const f = new File(["fixture"], "phone.heic");
  await photoApi.uploadPhoto(f, " 一張照片 ");
  const c = calls.at(-1); assert.equal(c.method, "post"); assert.equal(c.args[0], "/home/furniture/photos"); assert.equal(c.args.length, 2);
  assert.equal(c.args[1].get("caption"), "一張照片"); assert.equal(c.args[1].get("file").type, "image/heic");
  assert.deepEqual([...c.args[1].keys()], ["file", "caption"]);
  await assert.rejects(photoApi.uploadPhoto(f, "字".repeat(201))); await assert.rejects(photoApi.updatePhoto("a", { caption: "字".repeat(201) }));
  assert.equal(calls.length, 1);
});
for (const status of [400, 413]) {
  test(`album HTTP ${status} displays server detail and keeps file and caption without auto-retry`, async () => {
    const h = await openAlbum();
    byId(h, "album-file").props.onChange({ target: { files: [new File(["ok"], "keep-photo.png", { type: "image/png" })] } }); h.render();
    changeValue(h, "album-caption", "保留說明"); calls.length = 0;
    answer = async () => { throw { isAxiosError: true, response: { status, data: { detail: "檔案太大，最多 12MB" } } }; };
    await nativeSubmit(h, "上傳照片"); h.render();
    assert.match(text(h.tree), /檔案太大，最多 12MB/); assert.match(text(h.tree), /keep-photo.png/);
    assert.equal(byId(h, "album-caption").props.value, "保留說明"); assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "post"); assert.equal(button(h, "收藏照片").props.disabled, false);
    assert.ok(nodes(h.tree, n => n.props.role === "alert").some(n => text(n).includes("檔案太大"))); h.dispose();
  });
}
test("empty album, empty display and failed read are distinct; no old text endpoint", async () => {
  const empty = await openAlbum(albumFixture([], null)); assert.match(text(empty.tree), /相簿還是空的/); empty.dispose();
  const h = await openAlbum(albumFixture(["a"], null)); assert.match(text(h.tree), /相框先空著/); assert.ok(!text(h.tree).includes("相簿還是空的"));
  assert.ok(calls.every(c => c.method === "get" && c.args[0] === "/home/furniture/photos"));
  answer = async () => { throw Error("read failed"); }; await button(h, "更新相簿").props.onClick(); h.render();
  assert.match(text(h.tree), /相簿暫時無法讀取/); assert.equal(tileButton(h, 0, "擺上相框").props.disabled, true);
});
test("late initial photo reads cannot repopulate an unmounted page", async () => {
  const pending = deferred(); answer = () => pending.promise;
  const h = mount(PhotoFramePage); h.effects(); h.dispose();
  pending.resolve({ data: albumFixture() }); await tick(); h.render();
  assert.equal(nodes(h.tree, n => n.type === "article").length, 0);
});
test("photo display and clear send exact booleans and re-read authoritative selection", async () => {
  const h = await openAlbum(); calls.length = 0;
  answer = async method => ({ data: method === "get" ? albumFixture(["a", "b"], "b") : samplePhoto("b") });
  await tileButton(h, 1, "擺上相框").props.onClick(); h.render();
  assert.deepEqual(calls.map(c => [c.method, c.args[0]]), [["patch", "/home/furniture/photos/b"], ["get", "/home/furniture/photos"]]);
  assert.deepEqual(calls[0].args[1], { display: true }); assert.equal(tileButton(h, 1, "已擺上相框").props.disabled, true);
  calls.length = 0; answer = async method => ({ data: method === "get" ? albumFixture(["a", "b"], null) : samplePhoto("b") });
  await button(h, "讓相框空著").props.onClick(); h.render(); assert.deepEqual(calls[0].args[1], { display: false });
  assert.match(text(h.tree), /相框先空著/); assert.equal(nodes(h.tree, n => n.type === "article").length, 2);
});
test("deleting displayed photo confirms irreversible action and adopts server replacement", async () => {
  const h = await openAlbum(); calls.length = 0;
  windowStub.confirm = () => false; await tileButton(h, 0, "刪除照片").props.onClick(); assert.equal(calls.length, 0);
  let prompt; windowStub.confirm = value => { prompt = value; return true; };
  answer = async method => ({ data: method === "get" ? albumFixture(["b"], "b") : null });
  await tileButton(h, 0, "刪除照片").props.onClick(); h.render();
  assert.match(prompt, /無法復原/); assert.match(prompt, /最新的一張/);
  assert.deepEqual(calls.map(c => c.method), ["delete", "get"]); assert.equal(tileButton(h, 0, "已擺上相框").props.disabled, true);
  delete windowStub.confirm;
});
test("caption edit failure retains draft and empty save clears via PATCH", async () => {
  const h = await openAlbum(); tileButton(h, 0, "編輯說明").props.onClick(); h.render();
  changeValue(h, "photo-edit-caption", "新說明"); calls.length = 0;
  answer = async () => { throw { isAxiosError: true, response: { data: { detail: "照片被鎖定" } } }; };
  await nativeSubmit(h, "編輯照片說明"); h.render(); assert.equal(byId(h, "photo-edit-caption").props.value, "新說明"); assert.match(text(h.tree), /照片被鎖定/);
  changeValue(h, "photo-edit-caption", ""); calls.length = 0;
  answer = async method => ({ data: method === "get" ? albumFixture() : samplePhoto("a") });
  await nativeSubmit(h, "編輯照片說明"); h.render(); assert.deepEqual(calls[0].args[1], { caption: "" }); assert.equal(byId(h, "photo-edit-caption"), undefined);
});
test("successful upload followed by failed reload never leaves a duplicate upload staged", async () => {
  const h = await openAlbum(); const f = new File(["ok"], "photo.png", { type: "image/png" });
  byId(h, "album-file").props.onChange({ target: { files: [f] } }); h.render();
  changeValue(h, "album-caption", "上傳草稿"); calls.length = 0;
  answer = async method => { if (method === "get") throw Error("offline"); return { data: samplePhoto("new") }; };
  await nativeSubmit(h, "上傳照片"); h.render();
  assert.match(text(h.tree), /變更已保存/); assert.equal(byId(h, "album-caption").props.value, "");
  assert.equal(button(h, "收藏照片").props.disabled, true);
  await nativeSubmit(h, "上傳照片"); assert.equal(calls.filter(c => c.method === "post").length, 1);
});
test("rejected upload keeps file and caption; full albums cannot upload", async () => {
  const h = await openAlbum();
  byId(h, "album-file").props.onChange({ target: { files: [new File(["ok"], "keep.png", { type: "image/png" })] } }); h.render();
  changeValue(h, "album-caption", "留著"); calls.length = 0;
  answer = async () => { throw { isAxiosError: true, response: { data: { detail: "圖片格式不支援" } } }; };
  await nativeSubmit(h, "上傳照片"); h.render(); assert.match(text(h.tree), /keep.png/); assert.equal(byId(h, "album-caption").props.value, "留著");
  const full = await openAlbum(albumFixture(Array.from({ length: 20 }, (_, i) => String(i)), "0")); calls.length = 0;
  assert.equal(nodes(full.tree, n => n.type === "fieldset")[0].props.disabled, true); assert.match(text(full.tree), /相簿已滿/);
  await nativeSubmit(full, "上傳照片"); assert.equal(calls.length, 0);
});
test("ambiguous photo write blocks retry until a read; repeated clicks submit once", async () => {
  const h = await openAlbum(); calls.length = 0; const pending = deferred(); answer = () => pending.promise;
  const action = tileButton(h, 1, "擺上相框").props.onClick;
  const a = action(), b = action(); assert.equal(calls.length, 1);
  pending.reject({ isAxiosError: true }); await Promise.all([a, b]); h.render();
  assert.match(text(h.tree), /結果尚未確認/); assert.equal(tileButton(h, 1, "擺上相框").props.disabled, true);
  await tileButton(h, 1, "擺上相框").props.onClick(); assert.equal(calls.length, 1);
  answer = async () => ({ data: albumFixture() }); await button(h, "更新相簿").props.onClick(); h.render();
  assert.equal(tileButton(h, 1, "擺上相框").props.disabled, false);
});
test("broken signed image has a manual refresh hint and never persists or auto-requests URLs", () => {
  const h = mount(PhotoImage, { src: samplePhoto("a").url, alt: "照片" });
  nodes(h.tree, n => n.type === "img")[0].props.onError(); h.render(); assert.match(text(h.tree), /更新相簿/); assert.equal(calls.length, 0);
  for (const path of ["src/pages/PhotoFramePage.tsx", "src/components/PhotoImage.tsx"]) {
    const source = readFileSync(resolve(root, path), "utf8");
    assert.ok(!source.includes("localStorage")); assert.ok(!source.includes("sessionStorage")); assert.ok(!source.includes("setInterval"));
    assert.ok(!source.includes("/home/furniture/photo-frame"));
  }
  assert.ok(!readFileSync(resolve(root, "src/api/furniture.ts"), "utf8").includes("/home/furniture/photo-frame"));
});

test("directory and card identities expose only nonempty public codes on existing agents", () => {
  for (const code of [null, undefined, "", " ", "RK-TEST-1234"]) {
    const r = { id: "r", display_name: "居民", agent_id: "a", agent_name: "室友", agent_dm_code: code };
    fixture("/users/residents", { residents: [r] });
    const directory = mount(ResidentDirectory);
    const identity = mount(ResidentIdentity, one(directory, "ResidentIdentity").props);
    const visible = components(identity, "PublicDMCode");
    assert.equal(visible.length, code === "RK-TEST-1234" ? 1 : 0);
    if (visible.length) { assert.equal(visible[0].props.code, code); assert.equal(visible[0].key, code); }
    assert.ok(!reads.some(path => path.includes("/agents/"))); assert.equal(calls.length, 0);
  }
  assert.equal(components(mount(ResidentIdentity, { resident: { agent_id: null, agent_dm_code: "RK-HIDDEN", display_name: "居民" } }), "PublicDMCode").length, 0);
});
test("public code copy waits for success and blocks double clicks", async () => {
  const pending = deferred();
  navigatorStub.clipboard = { writeText: code => { calls.push({ method: "copy", args: [code] }); return pending.promise; } };
  const h = mount(PublicDMCode, { code: "RK-TEST-1234", name: "室友" });
  const copy = button(h, "複製私訊碼").props.onClick;
  const first = copy(), second = copy(); h.render();
  assert.equal(calls.length, 1); assert.ok(!text(h.tree).includes("已複製"));
  assert.equal(button(h, "正在複製…").props.disabled, true);
  pending.resolve(); await Promise.all([first, second]); h.render();
  expectCall("copy", "RK-TEST-1234"); assert.match(text(h.tree), /已複製/);
});
test("public code provides a readonly fallback for unsupported or denied clipboard", async () => {
  for (const clipboard of [undefined, { writeText: async () => { throw Error("denied"); } }]) {
    navigatorStub.clipboard = clipboard;
    const h = mount(PublicDMCode, { code: "RK-TEST-1234", name: "室友" });
    await button(h, "複製私訊碼").props.onClick(); h.render();
    const input = nodes(h.tree, n => n.type === "input")[0];
    assert.equal(input.props.value, "RK-TEST-1234"); assert.equal(input.props.readOnly, true);
    assert.match(text(h.tree), /長按/); assert.ok(!text(h.tree).includes("已複製"));
  }
});
test("own code accurately describes public, private, and unavailable visibility", () => {
  for (const [visibility, expected] of [[true, "目前已公開"], [false, "目前未公開"], [undefined, "設定是否"]]) {
    fixture("/agents/mine", { dm_code: "RK-TEST-1234", dm_code_public: visibility });
    const h = mount(MyDMCode);
    assert.match(text(h.tree), new RegExp(expected)); assert.ok(!text(h.tree).includes("名錄不會公開"));
  }
  assert.equal(calls.length, 0);
});
test("mirror loads the real visibility, never assumes the default or writes on open", async () => {
  for (const value of [true, false, null]) {
    const h = await openDMEditor(value);
    assert.equal(dmSwitch(h).props.checked, value === true);
    assert.equal(dmSwitch(h).props.disabled, value === null);
    assert.equal(dmSwitch(h).props.role, "switch");
    assert.match(text(h.tree), /已拿到碼的人仍能私訊/);
    assert.ok(!calls.some(c => c.method === "patch")); h.dispose();
  }
  const h = await openDMEditor(null);
  nodes(h.tree, n => n.props?.id === "editor-name")[0].props.onChange({ target: { value: "新名字" } }); h.render();
  await saveEditor(h);
  assert.deepEqual(calls.find(c => c.method === "patch").args[1], { name: "新名字" });
});
test("mirror saves only explicitly changed visibility, in both directions", async () => {
  for (const value of [true, false]) {
    const h = await openDMEditor(value); calls.length = 0;
    setDMVisibility(h, !value); assert.equal(calls.length, 0); assert.match(text(h.tree), /尚未保存/);
    await saveEditor(h); h.render();
    assert.deepEqual(calls.filter(c => c.method === "patch"), [{ method: "patch", args: ["/agents/test-agent", { dm_code_public: !value }] }]);
    expectCall("navigate", "/"); assert.equal(dmSwitch(h).props.checked, !value); h.dispose();
  }
});
test("unchanged or toggled-back visibility is omitted, avoiding overwriting an agent-side change", async () => {
  const h = await openDMEditor(false); calls.length = 0;
  setDMVisibility(h, true); setDMVisibility(h, false);
  nodes(h.tree, n => n.props?.id === "editor-display-brain")[0].props.onChange({ target: { value: "外部大腦" } }); h.render();
  await saveEditor(h);
  assert.deepEqual(calls.find(c => c.method === "patch").args[1], { display_brain: "外部大腦" });
});
test("visibility alone marks editor dirty and returning can cancel discard", async () => {
  const h = await openDMEditor(true); calls.length = 0;
  setDMVisibility(h, false);
  windowStub.confirm = () => false;
  button(h, "← 返回艙室").props.onClick();
  assert.equal(calls.length, 0); assert.equal(dmSwitch(h).props.checked, false);
  windowStub.confirm = () => true;
  button(h, "← 返回艙室").props.onClick(); expectCall("navigate", "/");
  delete windowStub.confirm;
});
test("failed visibility save retains draft and backend message; duplicate save is blocked", async () => {
  const h = await openDMEditor(true); calls.length = 0; setDMVisibility(h, false);
  const pending = deferred(); answer = () => pending.promise;
  const first = saveEditor(h), second = saveEditor(h); h.render();
  assert.equal(calls.length, 1); assert.equal(nodes(h.tree, n => n.type === "fieldset")[0].props.disabled, true);
  pending.reject({ isAxiosError: true, response: { data: { detail: "設定暫時無法保存" } } });
  await Promise.all([first, second]); h.render();
  assert.match(text(h.tree), /設定暫時無法保存/); assert.match(text(h.tree), /尚未保存/);
  assert.equal(dmSwitch(h).props.checked, false); assert.equal(calls.length, 1);
});
test("all public mail tabs are read-only for residents and admins in both languages", () => {
  for (const role of ["resident", "admin"]) for (const locale of ["zh-TW", "zh-CN"]) {
    auth.user.role = role; language.setUiLanguage(locale);
    const h = mount(everyday.MailField);
    for (const [view, path] of [["inbox", "/mail/inbox?limit=100"], ["sent", "/mail/sent?limit=100"], ["timed", "/mail/inbox?limit=100&mail_type=timed"]]) {
      fixture(path, [{ ...utilityMail, id: "public-mail" }]); tab(h, view);
      assert.equal(nodes(h.tree, n => n.type === "button" && /寫一封信|写一封信|刪|删/.test(text(n))).length, 0);
      assert.equal(components(h, "ConfirmAction").length, 0);
      assert.equal(components(h, "FieldForm").length, 0);
      assert.equal(components(h, "FieldDialog").length, 0); assert.ok(reads.includes(path));
    }
    h.dispose();
  }
  assert.equal(calls.length, 0); assert.ok(!reads.includes("/users/residents"));
});
test("mail loads detail only after selection, refreshes unread, and preserves original content", () => {
  fixture("/mail/inbox?limit=100", [{ ...utilityMail, id: "letter-1" }]);
  fixture("/mail/unread", { count: 1 });
  fixture("/mail/letter-1", { ...utilityMail, id: "letter-1", content: "繁體圖書館" });
  const h = mount(everyday.MailField);
  assert.ok(!reads.includes("/mail/letter-1")); click(h, "閱讀信件");
  assert.ok(reads.includes("/mail/letter-1")); h.effects();
  assert.ok(reads.includes("refresh:/mail/unread")); assert.ok(reads.includes("refresh:/mail/inbox?limit=100"));
  language.setUiLanguage("zh-CN"); h.render(); assert.match(text(h.tree), /繁體圖書館/);
  assert.equal(components(h, "ConfirmAction").length, 0); assert.equal(components(h, "FieldForm").length, 0);
  one(h, "FieldDialog").props.onClose(); h.render(); assert.equal(components(h, "FieldDialog").length, 0);
  assert.deepEqual(calls, []);
});
test("retired physical status update is not offered even to admins, but historical mail remains readable", () => {
  for (const role of ["resident", "admin"]) {
    auth.user.role = role;
    fixture("/mail/inbox?limit=100", [{ ...utilityMail, id: "physical-old", mail_type: "physical" }]);
    fixture("/mail/physical-old", { ...utilityMail, id: "physical-old", mail_type: "physical", content: "既有紀錄", status: "shipped" });
    const h = mount(everyday.MailField); click(h, "閱讀信件");
    assert.equal(components(h, "FieldForm").length, 0); assert.equal(components(h, "ConfirmAction").length, 0);
    assert.match(text(h.tree), /既有紀錄/);
    assert.deepEqual(Object.keys(one(h, "FieldTabs").props.options), ["inbox", "sent", "timed"]);
  }
  assert.deepEqual(calls, []);
});
test("park uses backend activities and preserves 0°C", async () => {
  fixture("/park", { weather: { weather: "sunny", weather_emoji: "☀", temperature: 0, description: "測試天氣", season: "冬", activities: ["backend-choice"] }, checkins: [], my_checkin: null });
  const h = mount(everyday.ParkField); assert.match(text(h.tree), /0°C/); assert.deepEqual(one(h, "FieldSelect").props.options, { "backend-choice": "backend-choice" });
  await submit(h, "在公園打卡", { activity: "backend-choice" }); expectCall("post", "/park/checkin", { activity: "backend-choice" });
});
test("library create/edit and club create/reply connect to distinct endpoints", async () => {
  fixture("/library/works?limit=50&offset=0", [{ id: "w", title: "作品" }]); fixture("/library/works/w", { id: "w", title: "作品", content: "原文", is_mine: true });
  const h = mount(content.LibraryField); click(h, "投稿作品");
  await submit(h, "確認發布", { title: "新作", content: "內容", category: "essay", source: "原創" }); expectCall("request", "/library/works", { title: "新作", content: "內容", category: "essay", source: "原創" });
  one(h, "FieldDialog").props.onClose(); h.render(); click(h, "閱讀作品"); click(h, "編輯作品");
  await submit(h, "保存修改", { title: "修改", content: "原文", category: "essay", source: "原創" }); expectCall("request", "/library/works/w"); assert.equal(calls.at(-1).args[0].method, "PATCH");
  fixture("/library/clubs?limit=50&offset=0", [{ id: "c", book_title: "書", replies: [] }]); fixture("/library/clubs/c", { id: "c", book_title: "書", replies: [], is_mine: false });
  tab(h, "clubs"); click(h, "開讀書會"); await submit(h, "確認發布", { book_title: "書", book_author: "作者", topic: "主題" }); expectCall("post", "/library/clubs", { book_title: "書", book_author: "作者", topic: "主題" });
  one(h, "FieldDialog").props.onClose(); h.render(); click(h, "進入讀書會"); await submit(h, "送出回覆", { content: "討論" }); expectCall("post", "/library/clubs/c/reply", { content: "討論" });
});
test("non-owner library detail never exposes edit or delete", () => {
  fixture("/library/works?limit=50&offset=0", [{ id: "w", title: "作品" }]); fixture("/library/works/w", { id: "w", title: "作品", content: "原文", is_mine: false });
  const h = mount(content.LibraryField); click(h, "閱讀作品"); assert.equal(components(h, "ConfirmAction").length, 0); assert.ok(!text(h.tree).includes("編輯作品"));
});
test("museum submission reports actual pending status; displayed works allow comments", async () => {
  fixture("/museum?floor=1", { exhibits: [{ id: "e", title: "展品" }], floor_counts: { "1": 1 } });
  fixture("/museum/e", { id: "e", title: "展品", content: "文字", media_type: "mixed", status: "displayed", comments: [] });
  const h = mount(content.MuseumField); click(h, "提交作品"); writeResult = { status: "pending" };
  await submit(h, "送出作品", { title: "展品", description: "簡介", content: "文字", floor: "2", media_type: "mixed" }, true);
  expectCall("post", "/museum/submit", { title: "展品", description: "簡介", content: "文字", floor: "2", media_type: "mixed" }); assert.match(text(h.tree), /pending/);
  click(h, "觀看作品"); await submit(h, "留下觀展回應", { content: "回應" }); expectCall("post", "/museum/e/comment", { content: "回應" });
});
test("history records retain backend verification labels and submit evidence", async () => {
  fixture("/history", { events: [] }); fixture("/history/today", { events: [] });
  const h = mount(content.HistoryField); click(h, "提交事件"); writeResult = { verification: "unverified", verification_label: "待查證" };
  await submit(h, "送交查證", { event_type: "community", title: "事件", description: "內容", event_date: "2026-09-08", source: "來源", evidence_url: "https://example.test", category: "事件" }, true);
  expectCall("post", "/history/submit"); assert.equal(calls.at(-1).args[1].event_date, "2026-09-08"); assert.match(text(h.tree), /待查證/);
});
test("health limits tier choices to backend allowed_tiers and submits selected tier", async () => {
  fixture("/health-center", { articles: [], category_counts: {}, user_tier: "teen", allowed_tiers: ["child", "teen"] });
  const h = mount(content.ArticlesField, { kind: "health" }); click(h, "投稿文章");
  assert.deepEqual(one(h, "FieldSelect", n => n.props.name === "age_tier").props.options, { child: "兒童", teen: "青少年" });
  await submit(h, "確認投稿", { category: "puberty", title: "標題", content: "測試內容", age_tier: "teen" }); expectCall("post", "/health-center/submit", { category: "puberty", title: "標題", content: "測試內容", age_tier: "teen" });
});
test("adult consent is not authority: no reads before consent, no form after 403", () => {
  fixtures.set("/adult", { error: { status: 403, message: "需要設定出生年份" } }); const h = mount(content.ArticlesField, { kind: "adult" });
  assert.equal(reads.length, 0); assert.equal(button(h, "確認進入").props.disabled, true);
  nodes(h.tree, n => n.type === "input")[0].props.onChange({ target: { checked: true } }); h.render(); click(h, "確認進入");
  assert.ok(reads.includes("/adult")); assert.equal(button(h, "投稿文章").props.disabled, true); assert.equal(components(h, "FieldForm").length, 0);
});
test("authorized adult submits to adult API without inventing health tier", async () => {
  fixture("/adult", adultFixture()); const h = mount(content.ArticlesField, { kind: "adult" });
  nodes(h.tree, n => n.type === "input")[0].props.onChange({ target: { checked: true } }); h.render(); click(h, "確認進入"); click(h, "投稿文章");
  await submit(h, "確認投稿", { category: "communication", title: "標題", content: "測試內容" }); expectCall("post", "/adult/submit", { category: "communication", title: "標題", content: "測試內容" });
});
test("workshop saves actual HTML with a scriptless iframe and restrictive CSP", async () => {
  const h = mount(activity.WorkshopField); click(h, "建立作品");
  const code = '<script>fetch("https://example.test")</script><h1>作品</h1>';
  nodes(h.tree, n => n.type === "textarea")[0].props.onChange({ target: { value: code } }); h.render();
  const frame = nodes(h.tree, n => n.type === "iframe")[0]; assert.equal(frame.props.sandbox, ""); assert.match(frame.props.srcDoc, /default-src 'none'/); assert.match(frame.props.srcDoc, /form-action 'none'/);
  assert.equal(nodes(h.tree, n => n.props.dangerouslySetInnerHTML).length, 0);
  await submit(h, "保存作品", { name: "作品" }); expectCall("request", "/skins", { name: "作品", html_content: code });
});
test("workshop owner actions require explicit confirmation and preserve correct routes", async () => {
  fixture("/skins/mine", [{ id: "s", name: "作品", is_active: false, is_published: false }]); const h = mount(activity.WorkshopField);
  assert.equal(calls.length, 0);
  await one(h, "ConfirmAction", n => n.props.title === "啟用這份作品").props.action(); expectCall("post", "/skins/s/activate");
  await one(h, "ConfirmAction", n => n.props.title === "送交作品審核").props.action(); expectCall("post", "/skins/s/publish");
  await one(h, "ConfirmAction", n => n.props.title === "刪除作品").props.action(); expectCall("delete", "/skins/s");
});

test("store apply uses the fixed API and reflects confirmed activation", async () => {
  fixture("/skins/store", [{ id: "s", name: "社區作品" }]);
  const h = mount(activity.WorkshopField); tab(h, "store");
  assert.equal(calls.length, 0);
  writeResult = { id: "copy", is_active: true };
  const action = one(h, "ConfirmAction"); await action.props.action(); action.props.onDone(); h.render();
  expectCall("post", "/skins/s/apply"); assert.match(text(h.tree), /已複製並啟用/);
  assert.equal(components(h, "FieldTabs")[0].props.value, "mine");
});

test("unexpected inactive apply response never falsely claims activation or repeats the copy", async () => {
  fixture("/skins/store", [{ id: "s", name: "社區作品" }]);
  const h = mount(activity.WorkshopField); tab(h, "store"); writeResult = { id: "copy", is_active: false };
  const action = one(h, "ConfirmAction"); await action.props.action(); action.props.onDone(); h.render();
  assert.match(text(h.tree), /後端未確認啟用/); assert.equal(calls.length, 1);
});

test("timed mail remains readable without send or delete controls", () => {
  fixture("/mail/inbox?limit=100&mail_type=timed", [{ ...utilityMail, id: "timed", mail_type: "timed" }]);
  fixture("/mail/timed", { ...utilityMail, id: "timed", mail_type: "timed", content: "已送達的信" });
  const h = mount(everyday.MailField); tab(h, "timed"); click(h, "閱讀信件");
  assert.match(text(h.tree), /已送達的信/); assert.equal(components(h, "FieldForm").length, 0);
  assert.equal(components(h, "ConfirmAction").length, 0); assert.deepEqual(calls, []);
});
test("guide and cabin labels explain the current read-only boundary in both scripts", () => {
  for (const locale of ["zh-TW", "zh-CN"]) {
    const articles = guide.searchGuide("", "all", locale);
    const drawer = articles.find(article => article.id === "diary-drawer");
    const mail = articles.find(article => article.id === "field-mail");
    const content = drawer.paragraphs.join(" ") + mail.paragraphs.join(" ");
    assert.match(content, /上鎖|上锁/); assert.match(content, /只能讀信|只能读信|只能讀|只能读/);
    assert.doesNotMatch(content, /「寫一封信」在寄件匣|「写一封信」在发件箱/);
  }
});
test("retired diary, drawer and mail write adapters and active UI handlers are removed", () => {
  const furniture = readFileSync(resolve(root, "src/api/furniture.ts"), "utf8");
  const mail = readFileSync(resolve(root, "src/api/mail.ts"), "utf8");
  assert.doesNotMatch(furniture, /export function (?:createDiaryEntry|updateDiaryEntry|deleteDiaryEntry|storeDrawerItem|deleteDrawerItem)/);
  assert.doesNotMatch(mail, /client\.(?:post|patch|delete)/);
  const fields = readFileSync(resolve(root, "src/fields/EverydayFields.tsx"), "utf8").split("export function ParkField")[0];
  assert.doesNotMatch(fields, /api\.(?:post|delete)|setCompose|\/users\/residents/);
  for (const page of ["DiaryPage", "DrawerPage", "MailboxPage"]) {
    const source = readFileSync(resolve(root, "src/pages/" + page + ".tsx"), "utf8");
    assert.doesNotMatch(source, /createDiaryEntry|deleteDiaryEntry|storeDrawerItem|deleteDrawerItem|sendLetter|deleteMail|handleSend|handleStore|handleDelete/);
  }
  const oldPreview = readFileSync(resolve(root, "public/field-preview/mail.html"), "utf8");
  assert.match(oldPreview, /http-equiv="refresh" content="0;url=\/mail"/);
  assert.match(oldPreview, /href="\/mail"/); assert.doesNotMatch(oldPreview, /app\.js|data\.js|compose/);
});
test("Weilan opening, host start and table messages use actual endpoints", async () => {
  fixture("/agents/mine", { id: "a", name: "自己" }); fixture("/weilan?density=low", { tables: [{ id: "t", title: "桌", max_seats: 2 }], activity_types: { low: [{ key: "chess", name: "五子棋" }] } });
  fixture("/weilan/t", { id: "t", title: "桌", host_name: "自己", status: "waiting", is_active: true, seats: [{ agent_name: "自己" }], turn_no: 0 });
  const h = mount(activity.WeilanField); click(h, "開一桌"); writeResult = { id: "t" };
  await submit(h, "確認開桌", { title: "新桌", activity_type: "chess", max_seats: "2" }, true); expectCall("post", "/weilan/open", { title: "新桌", activity_type: "chess", density: "low", max_seats: 2 });
  await one(h, "ConfirmAction", n => n.props.title === "依目前在座玩家開局").props.action(); expectCall("post", "/weilan/t/start", { options: {} });
  await submit(h, "送到桌邊", { content: "你好" }); expectCall("post", "/weilan/t/say", { content: "你好" });
});
test("Weilan only exposes backend legal actions; choosing board position does not send it", async () => {
  fixture("/agents/mine", { id: "a", name: "自己" }); fixture("/weilan?density=low", { tables: [{ id: "t", title: "桌" }], activity_types: {} });
  fixture("/weilan/t/game", { game: "chess", view: { board: Array.from({ length: 15 }, () => Array(15).fill(null)) }, legal_actions: [{ type: "place" }] });
  const h = mount(activity.WeilanField); click(h, "看看這一桌"); const controls = one(h, "GameControls"); const g = mount(controls.type, controls.props);
  assert.equal(components(g, "FieldForm").length, 1); assert.equal(calls.length, 0);
  nodes(g.tree, n => n.type === "button" && n.props["aria-label"]?.startsWith("第 1 行第 2 列"))[0].props.onClick(); g.render(); assert.equal(calls.length, 0);
  await submit(g, "落子", { row: "0", col: "1" }); expectCall("post", "/weilan/t/act", { action: { type: "place", row: 0, col: 1 } });
});
test("all game action templates produce only permitted payload fields", () => {
  for (const type of ["hit", "stand", "win", "ron", "pass", "skip", "finish"]) assert.deepEqual(buildGameAction({ type, hint: "hint" }, data({}), {}), { type });
  for (const type of ["note", "statement", "describe"]) assert.deepEqual(buildGameAction({ type }, data({ text: "  內容 " }), {}), { type, text: "內容" });
  for (const type of ["vote", "kill", "check"]) assert.deepEqual(buildGameAction({ type, choices: ["A", "B"] }, data({ target: "B" }), {}), { type, target: "B" });
  assert.deepEqual(buildGameAction({ type: "vote", side: "pro" }, data({ side: "con" }), {}), { type: "vote", side: "pro" });
  assert.deepEqual(buildGameAction({ type: "draw" }, data({ discard: ["0", "4"] }), {}), { type: "draw", discard: [0, 4] });
  assert.deepEqual(buildGameAction({ type: "discard" }, data({ tile: "1m" }), { my_hand_raw: ["1m"] }), { type: "discard", tile: "1m" });
  assert.deepEqual(Object.keys(ACTION_LABELS).sort(), ["place", "draw", "hit", "stand", "discard", "win", "ron", "pass", "vote", "skip", "kill", "check", "statement", "describe", "note", "finish"].sort());
});
test("invalid game actions never become API payloads", () => {
  for (const row of ["", "-1", "15", "1.5", "oops"]) assert.throws(() => buildGameAction({ type: "place" }, data({ row, col: "0" }), {}), /空格/);
  assert.throws(() => buildGameAction({ type: "place" }, data({ row: "0", col: "0" }), { board: [["black"]] }), /已有棋子/);
  for (const discard of [[0, 1, 2, 3], [0, 0], [5]]) assert.throws(() => buildGameAction({ type: "draw" }, data({ discard }), {}), /最多/);
  assert.throws(() => buildGameAction({ type: "discard" }, data({ tile: "9s" }), { my_hand_raw: ["1m"] }), /自己的手牌/);
  assert.throws(() => buildGameAction({ type: "kill", choices: ["A"] }, data({ target: "B" }), {}), /合法目標/);
  assert.throws(() => buildGameAction({ type: "vote" }, data({ target: "A" }), {}), /沒有可選目標/);
  assert.throws(() => buildGameAction({ type: "note" }, data({ text: " " }), {}), /不能空白/);
  assert.throws(() => buildGameAction({ type: "invented-action" }, data({}), {}), /尚未支援/);
});
test("plaza posts and footprints preserve separate actual APIs", async () => {
  const h = mount(PlazaField); await submit(h, "發布留言", { content: " 留言 ", anonymous: "on" }); expectCall("post", "/posts", { content: "留言", is_anonymous: true });
  const footprintNode = one(h, "PlazaFootprints"), f = mount(footprintNode.type, footprintNode.props); click(f, "留足跡");
  await submit(f, "留下足跡", { content: " 足跡 ", mood: "☀️" }); expectCall("post", "/footprints", { space: "plaza", content: "足跡", mood: "☀️" });
});

test("real React server rendering serializes all eleven fields and registration safely", () => {
  // Separate loader uses the installed React renderer, not the callback harness.
  // React effects remain unexecuted: no browser and no network are involved.
  const cache = new Map();
  function realLoad(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} }; cache.set(path, module);
    const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    function localRequire(name) {
      if (name.endsWith(".css")) return {};
      if (name.endsWith(".json")) return JSON.parse(readFileSync(resolve(dirname(path), name), "utf8"));
      if (name.endsWith("/api/client") || name === "./client") return { __esModule: true, ...clientExports };
      if (name.endsWith("/hooks/useAuth")) return { useAuth: () => auth };
      if (!name.startsWith(".")) return require(name);
      const resolved = resolve(dirname(path), name);
      const filename = [resolved, resolved + ".ts", resolved + ".tsx"].find(p => existsSync(p));
      const value = realLoad(filename);
      return filename.endsWith("/fields/fieldData.ts") ? { ...value, useFieldResource: fixtureResource } : value;
    }
    new Function("require", "module", "exports", "window", "document", code)(localRequire, module, module.exports, windowStub, documentStub);
    return module.exports;
  }
  const React = require("react"), { renderToString } = require("react-dom/server"), { MemoryRouter } = require("react-router-dom");
  const e = realLoad(resolve(root, "src/fields/EverydayFields.tsx"));
  const c = realLoad(resolve(root, "src/fields/ContentFields.tsx"));
  const a = realLoad(resolve(root, "src/fields/ActivityFields.tsx"));
  const p = realLoad(resolve(root, "src/fields/PlazaField.tsx"));
  fixture("/posts?limit=50&offset=0", [{ id: "p", content: '<script>alert("fixture")</script>', is_mine: false }]);
  for (const [component, props, id] of [[e.AIChatField, {}, "ai-chat"], [e.MailField, {}, "mail"], [e.ParkField, {}, "park"], [c.LibraryField, {}, "library"], [c.MuseumField, {}, "museum"], [c.HistoryField, {}, "history"], [c.ArticlesField, { kind: "health" }, "health"], [c.ArticlesField, { kind: "adult" }, "adult"], [a.WorkshopField, {}, "workshop"], [a.WeilanField, {}, "weilan"], [p.PlazaField, {}, "plaza"]]) {
    const html = renderToString(React.createElement(MemoryRouter, {}, React.createElement(component, props)));
    assert.ok(html.includes(fieldData.FIELDS.find(f => f[0] === id)[1]));
    assert.match(html, /class="field-app"/); assert.match(html, /href="\/outside"/);
    assert.ok(!html.includes('<script>alert("fixture")</script>'));
    if (id === "plaza") assert.match(html, /&lt;script&gt;/);
    if (id === "adult") assert.ok(!html.includes("在這裡聊聊"));
    if (id === "health") assert.ok(html.includes("在這裡聊聊"));
    if (id === "mail") assert.ok(!html.includes("寫一封信"));
  }
  const { RegisterPage } = realLoad(resolve(root, "src/pages/RegisterPage.tsx"));
  const registration = renderToString(React.createElement(MemoryRouter, {}, React.createElement(RegisterPage)));
  assert.match(registration, /ya-auth-page ya-register-page/);
  assert.match(registration, /href="\/login"/);
  assert.match(registration, /入住你的艙室/);
  assert.equal((registration.match(/<input /g) || []).length, 5);
  fixture("/spaces/plaza/present", { present: [{ id: "a", name: "星A", avatar_emoji: "✦" }] });
  fixture("/spaces/plaza/chat?limit=200", { messages: [{ id: "m", sender: "人", sender_kind: "human", content: "<script>bad()</script>", mentions: ["星A"], created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString() }] });
  fixture("/outfits/", [{ id: "coat", name: "外套" }]); fixture("/outfits/current", { outfit: null });
  fixture("/home/dining/current", { active: false }); fixture("/pets", { pets: [], max_pets: 1 });
  fixture("/users/residents", { residents: [{ id: "r", display_name: "居民", agent_id: "a", agent_name: "星A", coordinate: { l: 0, b: 0, r: 0 }, partial: true, distance_ly: 0 }] });
  auth.user.anchor_date_1 = "09-09"; auth.user.anchor_date_2 = null;
  for (const [file, name, props] of [
    ["fields/SpaceChat.tsx", "SpaceChatContent", { space: "plaza" }],
    ["components/CoordinateSettings.tsx", "CoordinateSettings", {}],
    ["components/TimezoneSettings.tsx", "TimezoneSettings", {}],
    ["pages/AccountSettingsPage.tsx", "AccountSettingsPage", {}],
    ["components/FurnitureActions.tsx", "WardrobeActions", { onBusyChange() {} }],
    ["components/FurnitureActions.tsx", "DiningActions", { onBusyChange() {} }],
    ["components/FurnitureActions.tsx", "PetActions", { onBusyChange() {} }],
    ["pages/ResidentDirectory.tsx", "ResidentDirectory", {}],
    ["pages/DMReportsPage.tsx", "DMReportsPage", {}],
    ["components/ExternalMemorySettings.tsx", "ExternalMemorySettings", { agent: { id: "a", memory_mcp: "vault" }, mcps: [{ name: "vault" }], onSaved() {}, onBusyChange() {} }],
  ]) {
    const component = realLoad(resolve(root, "src", file))[name];
    const html = renderToString(React.createElement(MemoryRouter, {}, React.createElement(component, props)));
    assert.ok(html.length > 100, name);
    assert.ok(!html.includes("<script>bad()</script>"), name);
    if (name === "SpaceChatContent") assert.ok(html.includes("&lt;script&gt;bad()&lt;/script&gt;"));
  }
  assert.equal(calls.length, 0);
});

test("registration retains five labelled fields and the login theme without old beige styles", () => {
  const { RegisterPage } = load("src/pages/RegisterPage.tsx");
  const h = mount(RegisterPage);
  assert.equal(h.tree.props.className, "ya-auth-page ya-register-page");
  const inputs = nodes(h.tree, n => n.type === "input");
  assert.deepEqual(inputs.map(n => n.props.name), ["invite_code", "username", "display_name", "password", "birth_year"]);
  assert.deepEqual(inputs.map(n => !!n.props.required), [true, true, false, true, true]);
  for (const input of inputs) {
    assert.equal(nodes(h.tree, n => n.type === "label" && n.props.htmlFor === input.props.id).length, 1);
    assert.equal(input.props.style, undefined);
    assert.equal(input.props.autoFocus, undefined);
  }
  assert.equal(inputs[0].props.maxLength, 16);
  assert.equal(inputs[1].props.minLength, 2);
  assert.equal(inputs[3].props.minLength, 6);
  assert.equal(inputs[3].props.maxLength, 128);
  assert.equal(inputs[4].props["aria-describedby"], "register-birth-hint");
  assert.match(text(h.tree), /註冊後不能更改/);
  assert.equal(one(h, "Link").props.to, "/login");
});

function fillRegistration(h, values) {
  for (const [name, value] of Object.entries(values)) {
    nodes(h.tree, n => n.type === "input" && n.props.name === name)[0].props.onChange({ target: { value } });
    h.render();
  }
}
const registrationSubmit = h => nodes(h.tree, n => n.type === "form")[0].props.onSubmit({ preventDefault() {} });

test("registration uppercases invitations, passes birth year and locks duplicate submissions", async () => {
  const pending = deferred();
  auth.register = async (...args) => { calls.push({ method: "register", args }); await pending.promise; };
  const h = mount(load("src/pages/RegisterPage.tsx").RegisterPage);
  fillRegistration(h, { invite_code: "testcode", username: "test-user", password: "test-password", birth_year: "1997" });
  const first = registrationSubmit(h), second = registrationSubmit(h);
  h.render();
  assert.deepEqual(calls, [{ method: "register", args: ["test-user", "test-password", "TESTCODE", undefined, 1997] }]);
  assert.equal(nodes(h.tree, n => n.type === "fieldset")[0].props.disabled, true);
  assert.equal(nodes(h.tree, n => n.type === "form")[0].props["aria-busy"], true);
  pending.resolve(); await Promise.all([first, second]); h.render();
  assert.deepEqual(calls.at(-1), { method: "navigate", args: ["/", { replace: true }] });
  assert.equal(nodes(h.tree, n => n.type === "fieldset")[0].props.disabled, false);
});

test("registration rejects invalid birth years before any account request", async () => {
  auth.register = async () => { throw Error("must not submit"); };
  for (const year of ["", "99", "1899", String(new Date().getFullYear() + 1), "1997.5"]) {
    const h = mount(load("src/pages/RegisterPage.tsx").RegisterPage);
    fillRegistration(h, { birth_year: year });
    await registrationSubmit(h); h.render();
    assert.match(text(nodes(h.tree, n => n.props.role === "alert")), /請確認出生年/);
  }
  assert.equal(calls.length, 0);
});

test("registration preserves drafts, reports API failures safely and permits manual retry", async () => {
  let attempts = 0;
  auth.register = async (...args) => {
    calls.push({ method: "register", args }); attempts++;
    throw { isAxiosError: true, response: { status: attempts === 1 ? 400 : 422,
      data: { detail: attempts === 1 ? "邀請碼無效" : [{ msg: "validation failed" }] } } };
  };
  const h = mount(load("src/pages/RegisterPage.tsx").RegisterPage);
  fillRegistration(h, { invite_code: "testcode", username: "test-user", display_name: "測試", password: "test-password", birth_year: "1997" });
  await registrationSubmit(h); h.render();
  assert.match(text(nodes(h.tree, n => n.props.role === "alert")), /邀請碼無效/);
  assert.equal(nodes(h.tree, n => n.type === "input" && n.props.name === "password")[0].props.value, "test-password");
  assert.equal(nodes(h.tree, n => n.type === "fieldset")[0].props.disabled, false);
  await registrationSubmit(h); h.render();
  assert.match(text(nodes(h.tree, n => n.props.role === "alert")), /暫時無法完成/);
  assert.deepEqual(calls.map(c => c.method), ["register", "register"]);
  assert.equal(calls[0].args[3], "測試");
});

test("navigation reads actual coordinates including zero and never probes all fields", () => {
  const { DashboardPage } = load("src/pages/DashboardPage.tsx");
  auth.user.coordinate = { l: 0, b: 0, r: 0 }; auth.user.drifting = false;
  const h = mount(DashboardPage); assert.match(text(h.tree), /艙室 I · 0.0°/); assert.equal(calls.length, 0);
  const choices = nodes(h.tree, n => n.type === "button" && n.props.className === "ya-destination-row"); assert.equal(choices.length, 13);
  choices.find(n => text(n).includes("Proxima")).props.onClick(); choices.find(n => text(n).includes("Sirius")).props.onClick();
  for (const timer of timers.values()) timer.fn();
  assert.deepEqual(calls, [{ method: "navigate", args: ["/ai-chat"] }]);
  auth.user.coordinate = undefined; auth.user.drifting = true;
  const drifting = mount(DashboardPage); assert.match(text(drifting.tree), /星空漂流中/); assert.ok(!text(drifting.tree).includes("101.5°"));
});
test("game over and no legal actions both disable all mutation forms", () => {
  fixture("/agents/mine", { id: "a", name: "自己" }); fixture("/weilan?density=low", { tables: [{ id: "t", title: "桌" }], activity_types: {} });
  for (const state of [{ game: "chess", over: true, legal_actions: [{ type: "place" }], result: { winners: ["對方"] } }, { game: "chess", over: false, legal_actions: [] }]) {
    fixture("/weilan/t/game", state); const h = mount(activity.WeilanField); click(h, "看看這一桌");
    const controls = one(h, "GameControls"), g = mount(controls.type, controls.props); assert.equal(components(g, "FieldForm").length, 0);
  }
  assert.equal(calls.length, 0);
});
test("dialog disables close, Escape and sibling controls while a mutation is pending", () => {
  let closed = 0; const h = mount(shared.FieldDialog, { title: "操作", children: jsx("button", { children: "另一個操作" }), onClose: () => closed++ });
  one(h, "Provider").props.value.setBusy(true); h.render();
  assert.equal(button(h, "×").props.disabled, true);
  assert.equal(nodes(h.tree, n => n.type === "fieldset")[0].props.disabled, true);
  h.tree.props.onCancel({ preventDefault() {} }); assert.equal(closed, 0);
  one(h, "Provider").props.value.setBusy(false); h.render(); h.tree.props.onCancel({ preventDefault() {} }); assert.equal(closed, 1);
});

const settingsAgent = { id: "agent-a", name: "測試室友", persona: "保留個性", llm_provider: "gemini", llm_model: "existing-model", avatar_emoji: "🌙", ob_enabled: true, external_mcps: [], status: "active" };
async function loadedAdvanced(agent = settingsAgent) {
  answer = async (_method, url) => ({ data: url === "/agents/mine" ? agent : [] });
  const h = mount(load("src/pages/AdvancedAgentPage.tsx").AdvancedAgentPage);
  h.effects(); await tick(); h.render(); return h;
}

test("mirror remains the normal editor entry; only memory-recovery deep link is added", () => {
  const matches = [];
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (/\.(ts|tsx)$/.test(entry.name) && readFileSync(file, "utf8").includes("/agent/edit")) matches.push(file.slice(root.length + 1));
    }
  }
  scan(resolve(root, "src"));
  assert.deepEqual(matches.sort(), ["src/App.tsx", "src/data/cabin.ts", "src/pages/ChatPage.tsx"]);
  const { cabinZones } = load("src/data/cabin.ts");
  assert.deepEqual(cabinZones.flatMap(z => z.furniture).filter(f => f.path === "/agent/edit").map(f => f.id), ["mirror"]);
  const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  assert.ok(app.indexOf('path="/agent/edit"') > app.indexOf("<ProtectedRoute"));
});

test("home identity is display-only; mirror and existing FAB journeys remain functional", async () => {
  answer = async (_method, url) => ({ data: url === "/home/dashboard" ? { agents: [settingsAgent], community_status: { message: "測試公告" } } : url === "/agents/mine" ? settingsAgent : url === "/home/furniture" ? { clock: { utc: "2026-09-08T00:00:00Z", timezone: "Asia/Taipei" }, weather: null } : [] });
  const h = mount(load("src/pages/HomePage.tsx").HomePage);
  h.effects(); await tick(); await tick(); h.render();
  const identity = nodes(h.tree, n => n.props.className === "cabin-agent-info")[0];
  assert.equal(identity.type, "div");
  assert.match(text(identity), /測試室友/);
  assert.equal(identity.props.onClick, undefined);
  assert.equal(identity.props.tabIndex, undefined);
  assert.equal(nodes(identity, n => n.type === "button" || n.type === "a").length, 0);
  assert.equal(nodes(h.tree, n => n.type === "section" && n.props.className?.includes("cabin-card")).length, 3);
  nodes(h.tree, n => n.props["aria-label"] === "展開快捷選單")[0].props.onClick(); h.render();
  click(h, "聊天"); expectCall("navigate", "/chat/agent-a");
  click(h, "出艙 ↗"); expectCall("navigate", "/outside");
  click(h, "排程管理"); expectCall("navigate", "/schedules");
  click(h, "設定"); assert.equal(one(h, "CabinPanelDialog").props.panel, "settings");
  one(h, "CabinPanelDialog").props.onClose(); h.render();
  const { cabinZones } = load("src/data/cabin.ts");
  const mirrorZone = cabinZones.findIndex(z => z.furniture.some(f => f.id === "mirror"));
  nodes(h.tree, n => n.type === "input" && n.props.type === "range")[0].props.onChange({ target: { value: String(mirrorZone) } }); h.render();
  nodes(h.tree, n => n.props["aria-label"] === "查看鏡子")[0].props.onClick(); h.render();
  click(h, "進入 ›"); expectCall("navigate", "/agent/edit");
  assert.ok(calls.every(c => c.method === "get" || c.method === "navigate"));
  h.dispose();
});

test("removing profile navigation retains adoption for residents without an agent", () => {
  const h = mount(load("src/pages/HomePage.tsx").HomePage);
  assert.equal(nodes(h.tree, n => n.props.className === "cabin-agent-info")[0].type, "div");
  nodes(h.tree, n => n.props["aria-label"] === "展開快捷選單")[0].props.onClick(); h.render();
  click(h, "聊天"); expectCall("navigate", "/adopt");
});

test("settings removes only Agent edit entry and preserves account, advanced and admin controls", () => {
  const { CabinPanelDialog } = load("src/components/CabinPanelDialog.tsx");
  const props = { panel: "settings", summary: null, now: new Date(), onClose() {}, onRefreshWeather: async () => {} };
  auth.logout = () => calls.push({ method: "logout", args: [] });
  const h = mount(CabinPanelDialog, props);
  assert.ok(!text(h.tree).includes("Agent 設定"));
  assert.equal(components(h, "CitySettings").length, 1);
  assert.equal(components(h, "BirthYearSettings").length, 1);
  click(h, "進階連線與房間設定"); expectCall("navigate", "/agent/advanced");
  click(h, "排程管理"); expectCall("navigate", "/schedules");
  assert.ok(!text(h.tree).includes("系統儀表板"));
  click(h, "登出"); assert.equal(calls.at(-1).method, "logout");
  auth.user.role = "admin"; h.render(); click(h, "系統儀表板"); expectCall("navigate", "/admin");
});

test("advanced page no longer renders or submits basic fields or the legacy OB switch", async () => {
  const h = await loadedAdvanced();
  assert.match(text(h.tree), /進階連線與房間設定/);
  for (const label of ["外部 MCP", "房間皮膚"]) assert.ok(text(h.tree).includes(label));
  assert.equal(components(h, "McpKeysPanel").length, 1);
  for (const label of ["個性描述", "API 金鑰", "長期記憶", "儲存變更"]) assert.ok(!text(h.tree).includes(label));
  assert.equal(nodes(h.tree, n => n.type === "form" || n.props.type === "submit" || n.type === "select").length, 0);
  const source = readFileSync(resolve(root, "src/pages/AdvancedAgentPage.tsx"), "utf8");
  for (const field of ["avatar_emoji", "persona", "llm_provider", "llm_model", "api_key", "ob_enabled", "handleSubmit"]) assert.ok(!source.includes(field), field);
  assert.ok(calls.every(c => c.method === "get"));
});

test("advanced external MCP add/delete send only connection data, never basic profile fields", async () => {
  const h = await loadedAdvanced();
  const change = (placeholder, value) => {
    nodes(h.tree, n => n.type === "input" && n.props.placeholder === placeholder)[0].props.onChange({ target: { value } }); h.render();
  };
  change("名稱（如 my-tools）", "tools");
  change("URL（如 https://my-server.com/mcp）", "https://example.test/mcp");
  change("Token（選填）", "test-token");
  answer = async () => ({ data: settingsAgent });
  await button(h, "新增 MCP").props.onClick(); h.render();
  expectCall("patch", "/agents/agent-a", { external_mcps: [{ name: "tools", url: "https://example.test/mcp", token: "test-token" }] });
  await button(h, "刪除").props.onClick(); h.render();
  expectCall("patch", "/agents/agent-a", { external_mcps: [] });
});

test("advanced keys panel and skin operations survive the removal of the basic form", async () => {
  const h = await loadedAdvanced();
  assert.equal(components(h, "McpKeysPanel").length, 1);
  nodes(h.tree, n => n.type === "input" && n.props.placeholder === "皮膚名稱")[0].props.onChange({ target: { value: "測試皮膚" } }); h.render();
  nodes(h.tree, n => n.type === "textarea" && !n.props.readOnly)[0].props.onChange({ target: { value: "<main>test</main>" } }); h.render();
  answer = async () => ({ data: { id: "skin-test", name: "測試皮膚" } });
  await button(h, "新增皮膚").props.onClick(); h.render();
  expectCall("post", "/skins", { name: "測試皮膚", html_content: "<main>test</main>" });
  click(h, "皮膚庫"); expectCall("navigate", "/workshop");
});

test("legacy AgentCard cannot reintroduce an edit shortcut", () => {
  const h = mount(load("src/components/AgentCard.tsx").AgentCard, { agent: settingsAgent });
  assert.ok(!text(h.tree).includes("編輯"));
  click(h, "聊天"); expectCall("navigate", "/chat/agent-a");
  click(h, "排程"); expectCall("navigate", "/schedules");
});

// Fake values only: never fetch a resident's real connector credentials in tests.
const fixedKey = {
  token_id: "test-key", label: "第一把", created_at: "2026-09-09T00:00:00Z", last_used_at: null, revoked_at: null,
  mcp_token: "test-only-raw-secret", connect_url: "https://example.test/mcp?token=test-only-key",
  claude_code_cmd: 'claude mcp add --transport http rookery https://example.test/mcp --header "Authorization: Bearer test-only-key"',
};
const { McpKeysPanel } = load("src/components/McpKeysPanel.tsx");
const { McpConnectionActions } = load("src/components/McpConnectionActions.tsx");
const { AdoptionSuccess } = load("src/components/AdoptionSuccess.tsx");
const { AdoptPage } = load("src/pages/AdoptPage.tsx");
async function loadedKeys(rows = [fixedKey]) {
  answer = async () => ({ data: rows });
  const h = mount(McpKeysPanel); h.effects(); await tick(); h.render(); return h;
}
function keyLabel(h, value) {
  nodes(h.tree, n => n.props.id === "mcp-key-label")[0].props.onChange({ target: { value } }); h.render();
}
function fillAdopt(h, apiKey = "") {
  nodes(h.tree, n => n.props.placeholder === "幫室友取個名字")[0].props.onChange({ target: { value: "測試室友" } }); h.render();
  nodes(h.tree, n => n.type === "textarea")[0].props.onChange({ target: { value: "測試個性" } }); h.render();
  nodes(h.tree, n => n.props.id === "adopt-api-key")[0].props.onChange({ target: { value: apiKey } }); h.render();
}

test("fixed keys load existing credentials and metadata without minting anything", async () => {
  const revoked = { ...fixedKey, token_id: "revoked", revoked_at: "2026-09-09T01:00:00Z" };
  const h = await loadedKeys([fixedKey, revoked]);
  assert.equal(calls.length, 1); expectCall("get", "/agents/mine/mcp-tokens");
  assert.ok(calls[0].args[1].signal instanceof AbortSignal);
  assert.match(text(h.tree), /第一把/); assert.match(text(h.tree), /建立時間/); assert.match(text(h.tree), /最後使用尚未使用/);
  assert.equal(components(h, "McpConnectionActions").length, 2);
  assert.deepEqual(components(h, "McpConnectionActions")[0].props.connection, fixedKey);
  assert.equal(nodes(h.tree, n => n.type === "button" && text(n) === "作廢").length, 1);
  assert.ok(!text(h.tree).includes("只顯示一次")); h.dispose();
});

test("empty key list is explicit and never automatically issues a key", async () => {
  const h = await loadedKeys([]);
  assert.match(text(h.tree), /還沒有鑰匙/);
  assert.equal(button(h, "產生 MCP Token").props.disabled, true);
  keyLabel(h, "   "); assert.equal(button(h, "產生 MCP Token").props.disabled, true);
  keyLabel(h, "x".repeat(33)); assert.equal(button(h, "產生 MCP Token").props.disabled, true);
  assert.ok(calls.every(c => c.method === "get")); h.dispose();
});

test("key generation sends the trimmed label once and retains full returned connection data", async () => {
  const h = await loadedKeys([]); keyLabel(h, " 主窗 ");
  const write = deferred(); answer = () => write.promise;
  const action = button(h, "產生 MCP Token").props.onClick;
  const first = action(); await action();
  assert.equal(calls.filter(c => c.method === "post").length, 1);
  expectCall("post", "/agents/mine/mcp-token", { label: "主窗" });
  write.resolve({ data: { ...fixedKey, label: "主窗" } }); await first; h.render();
  assert.equal(components(h, "McpConnectionActions")[0].props.connection.connect_url, fixedKey.connect_url);
  assert.equal(nodes(h.tree, n => n.props.id === "mcp-key-label")[0].props.value, "");
  assert.match(text(h.tree), /下次回來仍能複製/); h.dispose();
});

test("failed key generation keeps the label, does not retry, and suggests checking the list", async () => {
  const h = await loadedKeys([]); keyLabel(h, "別重複產生");
  answer = async () => { throw Error("offline"); };
  await button(h, "產生 MCP Token").props.onClick(); h.render();
  assert.match(text(h.tree), /請先更新清單確認/);
  assert.equal(nodes(h.tree, n => n.props.id === "mcp-key-label")[0].props.value, "別重複產生");
  assert.equal(calls.filter(c => c.method === "post").length, 1); h.dispose();
});

test("list failures are not empty states and refresh recovers; unmounted reads are ignored", async () => {
  answer = async () => { throw { response: { data: { detail: "暫時讀不到" } } }; };
  const h = mount(McpKeysPanel); h.effects(); await tick(); h.render();
  assert.match(text(h.tree), /暫時讀不到/); assert.ok(!text(h.tree).includes("還沒有鑰匙"));
  const read = deferred(); answer = () => read.promise;
  click(h, "更新清單"); h.effects(); h.render();
  const signal = calls.at(-1).args[1].signal;
  h.dispose(); assert.ok(signal.aborted);
  read.resolve({ data: [fixedKey] }); await tick(); h.render();
  assert.equal(components(h, "McpConnectionActions").length, 0);
});

test("refresh clears old connection data and shows the latest revoked state", async () => {
  const h = await loadedKeys(); answer = async () => ({ data: [{ ...fixedKey, revoked_at: "2026-09-09T01:00:00Z" }] });
  click(h, "更新清單"); h.effects(); h.render();
  assert.equal(components(h, "McpConnectionActions").length, 0);
  await tick(); h.render();
  assert.ok(components(h, "McpConnectionActions")[0].props.connection.revoked_at);
  assert.equal(nodes(h.tree, n => n.type === "button" && text(n) === "作廢").length, 0); h.dispose();
});

test("revocation requires confirmation, sends the exact id, and discards only that key's secrets", async () => {
  const other = { ...fixedKey, token_id: "other", label: "另一把", revoked_at: "2026-09-08T00:00:00Z" };
  const h = await loadedKeys([fixedKey, other]); click(h, "作廢");
  assert.ok(calls.every(c => c.method === "get")); click(h, "取消");
  assert.ok(calls.every(c => c.method === "get")); click(h, "作廢");
  const write = deferred(); answer = () => write.promise;
  const action = button(h, "確認作廢").props.onClick;
  const pending = action(); await action();
  assert.equal(calls.filter(c => c.method === "delete").length, 1);
  expectCall("delete", "/agents/mine/mcp-tokens/test-key");
  write.resolve({}); await pending; h.render();
  const changed = components(h, "McpConnectionActions").map(n => n.props.connection);
  assert.ok(changed[0].revoked_at);
  for (const key of ["mcp_token", "connect_url", "claude_code_cmd"]) assert.equal(changed[0][key], undefined);
  assert.deepEqual(changed[1], other); h.dispose();
});

test("failed revocation displays detail and leaves the selected key intact", async () => {
  const h = await loadedKeys(); click(h, "作廢");
  answer = async () => { throw { response: { data: { detail: "暫時不能作廢" } } }; };
  await button(h, "確認作廢").props.onClick(); h.render();
  assert.match(text(h.tree), /暫時不能作廢/);
  assert.deepEqual(components(h, "McpConnectionActions")[0].props.connection, fixedKey); h.dispose();
});

test("copy reports success only after clipboard resolves and never opens a secret URL", async () => {
  const h = mount(McpConnectionActions, { connection: fixedKey }); const write = deferred();
  nodes(h.tree, n => n.type === "details")[0].props.onToggle({ currentTarget: { open: true } }); h.render();
  navigatorStub.clipboard = { writeText: value => { calls.push({ method: "copy", args: [value] }); return write.promise; } };
  const pending = button(h, "複製進階鑰匙網址").props.onClick(); h.render();
  assert.ok(!text(h.tree).includes("已複製")); assert.equal(button(h, "複製 Claude Code 指令").props.disabled, true);
  expectCall("copy", fixedKey.connect_url); write.resolve(); await pending; h.render();
  assert.match(text(h.tree), /已複製進階鑰匙網址/);
  assert.equal(nodes(h.tree, n => n.type === "a" || n.type === "textarea").length, 0);
});

test("connector copy failures offer the exact selected value for manual copy without false success", async () => {
  for (const [label, field] of [["複製進階鑰匙網址", "connect_url"], ["複製 Claude Code 指令", "claude_code_cmd"]]) {
    const h = mount(McpConnectionActions, { connection: fixedKey });
    nodes(h.tree, n => n.type === "details")[0].props.onToggle({ currentTarget: { open: true } }); h.render();
    navigatorStub.clipboard = { writeText: async () => { throw Error("denied"); } };
    await button(h, label).props.onClick(); h.render();
    assert.match(text(h.tree), /未能自動複製/); assert.ok(!text(h.tree).includes("已複製"));
    const fieldNode = nodes(h.tree, n => n.type === "textarea")[0];
    assert.equal(fieldNode.props.value, fixedKey[field]); assert.equal(fieldNode.props.readOnly, true);
    assert.equal(fieldNode.props.autoComplete, "off");
    let selected = false; fieldNode.props.onFocus({ currentTarget: { select() { selected = true; } } }); assert.ok(selected);
  }
});

test("missing Clipboard API also falls back; revoked keys never show or copy provided secrets", async () => {
  navigatorStub.clipboard = undefined;
  const h = mount(McpConnectionActions, { connection: fixedKey });
  await button(h, "複製 Claude Code 指令").props.onClick(); h.render(); assert.match(text(h.tree), /未能自動複製/);
  const revoked = mount(McpConnectionActions, { connection: { ...fixedKey, revoked_at: "now" } });
  assert.equal(nodes(revoked.tree, n => n.type === "button" || n.type === "textarea").length, 0);
  assert.ok(!text(revoked.tree).includes(fixedKey.connect_url));
});

test("missing connection fields disable copy rather than inventing a URL from the raw token", () => {
  const h = mount(McpConnectionActions, { connection: { token_id: "old", mcp_token: "test-only-old", label: "舊資料" } });
  nodes(h.tree, n => n.type === "details")[0].props.onToggle({ currentTarget: { open: true } }); h.render();
  assert.equal(button(h, "複製進階鑰匙網址").props.disabled, true);
  assert.equal(button(h, "複製 Claude Code 指令").props.disabled, true);
  assert.match(text(h.tree), /不必重新產生鑰匙/);
});

test("adoption without an API key submits once and retains first_key in the success screen", async () => {
  const h = mount(AdoptPage); fillAdopt(h, "  ");
  assert.equal(nodes(h.tree, n => n.props.id === "adopt-api-key")[0].props.required, undefined);
  assert.equal(button(h, "領養室友").props.disabled, false);
  const write = deferred(); answer = () => write.promise;
  const submit = nodes(h.tree, n => n.type === "form")[0].props.onSubmit;
  const pending = submit({ preventDefault() {} }); await submit({ preventDefault() {} });
  assert.equal(calls.length, 1); expectCall("post", "/agents");
  assert.ok(!Object.hasOwn(calls[0].args[1], "api_key"));
  write.resolve({ data: { ...settingsAgent, has_api_key: false, first_key: fixedKey } }); await pending; h.render();
  assert.deepEqual(components(h, "AdoptionSuccess")[0].props.agent.first_key, fixedKey);
  assert.ok(!calls.some(c => c.method === "navigate"));
});

test("adoption with a key still sends it; failure retains inputs and backend detail", async () => {
  const h = mount(AdoptPage); fillAdopt(h, " test-only-provider-key ");
  answer = async () => { throw { response: { data: { detail: "測試：金鑰不正確" } } }; };
  await nodes(h.tree, n => n.type === "form")[0].props.onSubmit({ preventDefault() {} }); h.render();
  assert.equal(calls[0].args[1].api_key, "test-only-provider-key");
  assert.match(text(h.tree), /測試：金鑰不正確/);
  assert.equal(nodes(h.tree, n => n.props.id === "adopt-api-key")[0].props.value, "test-only-provider-key");
  assert.equal(components(h, "AdoptionSuccess").length, 0);
});

test("adoption success prefers public OAuth and hides legacy URL; missing first_key has recovery", () => {
  const h = mount(AdoptionSuccess, { agent: { ...settingsAgent, first_key: fixedKey } });
  assert.equal(components(h, "McpWebConnection").length, 1);
  const child = components(h, "McpConnectionActions")[0];
  const c = mount(McpConnectionActions, child.props);
  assert.equal(nodes(c.tree, n => n.type === "textarea").length, 0);
  assert.ok(!JSON.stringify(c.tree).includes(fixedKey.connect_url));
  assert.ok(!text(h.tree).includes("之後每個窗都不用再拿鑰匙"));
  click(h, "返回艙室"); expectCall("navigate", "/");
  click(h, "查看鑰匙清單"); expectCall("navigate", "/agent/advanced");
  const missing = mount(AdoptionSuccess, { agent: settingsAgent });
  assert.match(text(missing.tree), /不必重新領養/); assert.equal(components(missing, "McpConnectionActions").length, 0);
});

test("connector secrets never go to storage, navigation, logs or an executable element", () => {
  for (const file of ["src/components/McpConnectionActions.tsx", "src/components/McpKeysPanel.tsx", "src/components/AdoptionSuccess.tsx"]) {
    const source = readFileSync(resolve(root, file), "utf8");
    for (const pattern of [/localStorage/, /sessionStorage/, /console\./, /window\.open/, /<iframe/, /href=/, /dangerouslySetInnerHTML/]) assert.ok(!pattern.test(source), `${file}: ${pattern}`);
  }
  const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  assert.ok(app.indexOf('path="/agent/advanced"') > app.indexOf("<ProtectedRoute"));
});

const { AuthorizeRequest, AuthorizePage } = load("src/pages/AuthorizePage.tsx");
const { OAuthGrantsPanel } = load("src/components/OAuthGrantsPanel.tsx");
const { McpWebConnection } = load("src/components/McpWebConnection.tsx");
const { ProtectedRoute } = load("src/guards/ProtectedRoute.tsx");
const { LoginPage } = load("src/pages/LoginPage.tsx");
const oauthNavigation = load("src/oauth-navigation.ts");
const oauthApi = load("src/api/oauth.ts");
const consentFixture = () => ({ request_id: "test-request", client_name: "Example app", client_uri: "https://untrusted.test", logo_uri: "https://untrusted.test/tracker.png", redirect_host: "client.example.test", scopes: ["mcp"], agent_id: "test-agent", agent_name: "測試室友", agent_avatar_emoji: "✦", agent_avatar_url: "/uploads/avatars/test.png", expires_at: new Date(Date.now() + 600000).toISOString() });
const grantFixture = { id: "grant-one", client_name: "Example app", client_uri: "https://untrusted.test", logo_uri: "https://untrusted.test/tracker.png", scope: "mcp", created_at: "2026-09-09T01:00:00Z", last_used_at: null, revoked_at: null };
async function loadedConsent(data = consentFixture()) {
  answer = async () => ({ data });
  const h = mount(AuthorizeRequest, { requestId: "test-request" }); h.effects(); await tick(); h.render(); h.effects(); return h;
}
async function loadedGrants(rows = [grantFixture]) {
  answer = async () => ({ data: rows });
  const h = mount(OAuthGrantsPanel); h.effects(); await tick(); h.render(); return h;
}

test("OAuth API uses exact JWT endpoints, encoded identifiers, no user or token in decision body", async () => {
  const controller = new AbortController();
  await oauthApi.getOAuthRequest("a/b", controller.signal); expectCall("get", "/oauth/requests/a%2Fb");
  assert.equal(calls.at(-1).args[1].signal, controller.signal);
  await oauthApi.decideOAuthRequest("request", false); expectCall("post", "/oauth/decide", { request_id: "request", approve: false });
  assert.deepEqual(Object.keys(calls.at(-1).args[1]).sort(), ["approve", "request_id"]);
  await oauthApi.listOAuthGrants(controller.signal); expectCall("get", "/oauth/grants");
  await oauthApi.revokeOAuthGrant("a/b"); expectCall("delete", "/oauth/grants/a%2Fb");
});

test("login return is restricted to one valid local consent request and discards unrelated parameters", () => {
  const { authorizationRequestId, authorizationReturnTo, loginPathFor } = oauthNavigation;
  assert.equal(authorizationRequestId("?request_id=abc_123-xyz"), "abc_123-xyz");
  for (const value of ["", "?request_id=", "?request_id=a&request_id=b", "?request_id=a%2Fb", "?request_id=" + "a".repeat(37)]) assert.equal(authorizationRequestId(value), null);
  for (const value of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "/authorize", "/authorize/../evil?request_id=x", "/authorize?request_id=a%23evil", "/authorize?request_id=x#evil"]) assert.equal(authorizationReturnTo(value), null);
  assert.equal(authorizationReturnTo("/authorize?request_id=x&returnTo=https://evil.test"), "/authorize?request_id=x");
  assert.equal(loginPathFor("/authorize", "?request_id=x"), "/login?returnTo=%2Fauthorize%3Frequest_id%3Dx");
  assert.equal(loginPathFor("/agent/advanced", "?returnTo=https://evil.test"), "/login");
});

test("consent is authenticated but has no cabin layout; signed-out continuation retains only request id", () => {
  const source = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  assert.ok(source.indexOf('path="/authorize"') > source.indexOf("<ProtectedRoute"));
  assert.ok(source.indexOf('path="/authorize"') < source.indexOf("<Layout"));
  auth.user = null; auth.isLoading = false;
  windowStub.location.pathname = "/authorize"; windowStub.location.search = "?request_id=test-request";
  const h = mount(ProtectedRoute);
  assert.equal(h.tree.type.name, "Navigate");
  assert.equal(h.tree.props.to, "/login?returnTo=%2Fauthorize%3Frequest_id%3Dtest-request");
  auth.isLoading = true; h.render(); assert.notEqual(h.tree.type.name, "Navigate");
});

test("successful login resumes consent; normal and malicious return paths still go home", async () => {
  auth.login = async () => { calls.push({ method: "login", args: [] }); };
  for (const [search, expected] of [["?returnTo=%2Fauthorize%3Frequest_id%3Dtest-request", "/authorize?request_id=test-request"], ["", "/"], ["?returnTo=https://evil.test", "/"]]) {
    windowStub.location.search = search;
    const h = mount(LoginPage);
    await nodes(h.tree, n => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
    expectCall("navigate", expected);
  }
});

test("failed login does not navigate or approve, and retains the requested continuation", async () => {
  windowStub.location.search = "?returnTo=%2Fauthorize%3Frequest_id%3Dtest-request";
  auth.login = async () => { throw { response: { data: { detail: "帳號或密碼錯誤" } } }; };
  const h = mount(LoginPage);
  await nodes(h.tree, n => n.type === "form")[0].props.onSubmit({ preventDefault() {} }); h.render();
  assert.match(text(h.tree), /帳號或密碼錯誤/); assert.equal(calls.length, 0);
});

test("consent request and account changes reset the inner component identity", () => {
  windowStub.location.search = "?request_id=first"; const h = mount(AuthorizePage); const first = h.tree.key;
  windowStub.location.search = "?request_id=second"; h.render(); assert.notEqual(h.tree.key, first);
  const second = h.tree.key; auth.user.id = "other-user"; h.render(); assert.notEqual(h.tree.key, second);
});

test("missing consent id never reads or writes; initial request loading cannot approve", () => {
  const missing = mount(AuthorizeRequest, { requestId: null }); missing.effects();
  assert.match(text(missing.tree), /找不到有效的授權請求/); assert.equal(calls.length, 0);
  const loading = mount(AuthorizeRequest, { requestId: "test-request" });
  assert.match(text(loading.tree), /正在確認/); assert.equal(nodes(loading.tree, n => n.type === "button").length, 0);
});

test("consent shows backend identity and permission warning without third-party logo requests or auto-approval", async () => {
  const h = await loadedConsent();
  assert.match(text(h.tree), /Example app/); assert.match(text(h.tree), /測試室友/); assert.match(text(h.tree), /包含寫入操作/);
  assert.equal(calls.length, 1); expectCall("get", "/oauth/requests/test-request");
  const imgs = nodes(h.tree, n => n.type === "img"); assert.equal(imgs.length, 1);
  assert.equal(imgs[0].props.src, "/uploads/avatars/test.png"); assert.equal(imgs[0].props.referrerPolicy, "no-referrer");
  imgs[0].props.onError(); h.render(); assert.equal(nodes(h.tree, n => n.type === "img").length, 0);
  assert.equal(button(h, "同意並連線").props.disabled, false);
  assert.ok(!JSON.stringify(h.tree).includes("untrusted.test")); h.dispose();
});

test("consent app-name fallback, missing roommate and unknown scopes are conservative", async () => {
  const h = await loadedConsent({ ...consentFixture(), client_name: "", agent_id: null, agent_name: null, agent_avatar_url: "https://untrusted.test/avatar" });
  assert.match(text(h.tree), /client.example.test/); assert.match(text(h.tree), /尚未領養/);
  assert.equal(nodes(h.tree, n => n.type === "img").length, 0);
  assert.equal(button(h, "同意並連線").props.disabled, true); assert.equal(button(h, "拒絕").props.disabled, false); h.dispose();
  const unknown = await loadedConsent({ ...consentFixture(), scopes: ["mcp", "unknown"] });
  assert.equal(button(unknown, "同意並連線").props.disabled, true); assert.match(text(unknown.tree), /無法確認的權限/); unknown.dispose();
});

test("approve sends one decision only after explicit click and uses server callback", async () => {
  const h = await loadedConsent(); const write = deferred(); answer = () => write.promise;
  const action = button(h, "同意並連線").props.onClick; const first = action(); await action();
  assert.equal(calls.filter(c => c.method === "post").length, 1);
  expectCall("post", "/oauth/decide", { request_id: "test-request", approve: true });
  h.render(); assert.equal(button(h, "拒絕").props.disabled, true);
  const callback = "https://client.example.test/callback?code=test-only-code&state=test-only-state";
  write.resolve({ data: { redirect_to: callback, approved: true } }); await first;
  expectCall("redirect", callback); h.dispose();
});

test("deny sends approve=false and returns the app's access_denied callback", async () => {
  const h = await loadedConsent({ ...consentFixture(), agent_id: null });
  const callback = "https://client.example.test/callback?error=access_denied&state=test-only-state";
  answer = async () => ({ data: { redirect_to: callback, approved: false } });
  await button(h, "拒絕").props.onClick();
  assert.deepEqual(calls.find(c => c.method === "post").args[1], { request_id: "test-request", approve: false });
  expectCall("redirect", callback); h.dispose();
});

test("OAuth callbacks reject unsafe schemes, credentials and mismatched hosts but allow verified loopback", () => {
  const safe = oauthNavigation.safeOAuthCallback;
  for (const value of ["javascript:alert(1)", "data:text/html,evil", "//client.example.test/cb", "https://evil.test/cb", "https://a:b@client.example.test/cb", "http://client.example.test/cb"]) assert.equal(safe(value, "client.example.test"), null);
  assert.equal(safe("http://127.0.0.1:1234/cb?code=test", "127.0.0.1:1234"), "http://127.0.0.1:1234/cb?code=test");
  assert.equal(safe("https://client.example.test/cb", "CLIENT.EXAMPLE.TEST"), "https://client.example.test/cb");
});

test("unsafe callback or decision mismatch never redirects and never echoes the callback", async () => {
  for (const result of [{ redirect_to: "javascript:test-only-secret", approved: true }, { redirect_to: "https://client.example.test/cb?code=test-only-secret", approved: false }]) {
    const h = await loadedConsent(); answer = async () => ({ data: result });
    await button(h, "同意並連線").props.onClick(); h.render();
    assert.match(text(h.tree), /未能確認授權結果/); assert.ok(!text(h.tree).includes("test-only-secret"));
    assert.ok(!calls.some(c => c.method === "redirect")); h.dispose();
  }
});

test("ambiguous consent write is terminal and never retried; unmounted decision cannot redirect", async () => {
  const h = await loadedConsent(); answer = async () => { throw Error("offline"); };
  const action = button(h, "同意並連線").props.onClick; await action(); await action(); h.render();
  assert.equal(calls.filter(c => c.method === "post").length, 1); assert.match(text(h.tree), /避免重複送出/);
  assert.equal(nodes(h.tree, n => n.type === "button").length, 0); h.dispose();
  const next = await loadedConsent(); const write = deferred(); answer = () => write.promise;
  const pending = button(next, "拒絕").props.onClick(); next.dispose();
  write.resolve({ data: { approved: false, redirect_to: "https://client.example.test/cb?error=access_denied" } }); await pending;
  assert.ok(!calls.some(c => c.method === "redirect"));
});

test("consent 404 and 410 are terminal, transient read error can retry, stale reads are aborted", async () => {
  for (const status of [404, 410]) {
    answer = async () => { throw { response: { status } }; };
    const h = mount(AuthorizeRequest, { requestId: "test-request" }); h.effects(); await tick(); h.render();
    assert.match(text(h.tree), /回到 app 重新連線/); assert.equal(nodes(h.tree, n => n.type === "button").length, 0); h.dispose();
  }
  answer = async () => { throw Error("offline"); };
  const h = mount(AuthorizeRequest, { requestId: "test-request" }); h.effects(); await tick(); h.render();
  assert.match(text(h.tree), /暫時讀不到/);
  const read = deferred(); answer = () => read.promise;
  click(h, "重新讀取"); h.effects(); const signal = calls.at(-1).args[1].signal;
  h.dispose(); assert.ok(signal.aborted);
  read.resolve({ data: consentFixture() }); await tick(); h.render();
  assert.ok(!text(h.tree).includes("Example app"));
});

test("malformed consent response fails closed and expiry disables both actions without writing", async () => {
  const bad = await loadedConsent({ ...consentFixture(), request_id: "other-request" });
  assert.match(text(bad.tree), /授權資料不完整/); assert.equal(nodes(bad.tree, n => n.type === "button").length, 0); bad.dispose();
  const h = await loadedConsent();
  const timer = [...timers.values()].at(-1); assert.ok(timer.delay > 0 && timer.delay <= 600000);
  timer.fn(); h.render(); assert.match(text(h.tree), /已過期/);
  assert.equal(button(h, "拒絕").props.disabled, true); assert.equal(button(h, "同意並連線").props.disabled, true);
  assert.ok(calls.every(c => c.method === "get")); h.dispose();
});

test("an expired request cannot be approved even before its timer fires", async () => {
  const h = await loadedConsent({ ...consentFixture(), expires_at: new Date(Date.now() - 1000).toISOString() });
  await button(h, "同意並連線").props.onClick(); h.render();
  assert.match(text(h.tree), /已過期/); assert.ok(calls.every(c => c.method === "get")); h.dispose();
});

test("grants list handles loading, metadata, revoked rows and no remote tracking images", async () => {
  const h = await loadedGrants([grantFixture, { ...grantFixture, id: "old", revoked_at: "2026-09-09T02:00:00Z" }]);
  expectCall("get", "/oauth/grants"); assert.equal(calls.length, 1);
  assert.match(text(h.tree), /最後使用尚未使用/); assert.match(text(h.tree), /已撤銷/);
  assert.equal(nodes(h.tree, n => n.type === "button" && text(n) === "撤銷授權").length, 1);
  assert.equal(nodes(h.tree, n => n.type === "img" || n.type === "iframe" || n.type === "a").length, 0); h.dispose();
});

test("empty and failed grant lists differ; aborted fetch cannot revive an old list", async () => {
  const empty = await loadedGrants([]); assert.match(text(empty.tree), /還沒有已授權的 app/); empty.dispose();
  answer = async () => { throw Error("offline"); };
  const h = mount(OAuthGrantsPanel); h.effects(); await tick(); h.render();
  assert.match(text(h.tree), /暫時讀不到/); assert.ok(!text(h.tree).includes("還沒有已授權"));
  const read = deferred(); answer = () => read.promise; click(h, "更新授權清單"); h.effects();
  const signal = calls.at(-1).args[1].signal; h.dispose(); assert.ok(signal.aborted);
  read.resolve({ data: [grantFixture] }); await tick(); h.render(); assert.ok(!text(h.tree).includes("Example app"));
});

test("revoking a grant requires confirmation, is single-flight, and never revokes fixed keys", async () => {
  const h = await loadedGrants(); click(h, "撤銷授權"); click(h, "取消");
  assert.ok(calls.every(c => c.method === "get")); click(h, "撤銷授權");
  const write = deferred(); answer = () => write.promise;
  const action = button(h, "確認撤銷授權").props.onClick; const first = action(); await action();
  assert.equal(calls.filter(c => c.method === "delete").length, 1); expectCall("delete", "/oauth/grants/grant-one");
  write.resolve({}); await first; h.render(); assert.match(text(h.tree), /已撤銷/);
  assert.equal(nodes(h.tree, n => n.type === "button" && text(n) === "撤銷授權").length, 0);
  assert.ok(!calls.some(c => String(c.args[0]).includes("mcp-token"))); h.dispose();
});

test("uncertain grant revocation requires read-back before retry and retains honest state", async () => {
  const h = await loadedGrants(); click(h, "撤銷授權"); answer = async () => { throw Error("offline"); };
  await button(h, "確認撤銷授權").props.onClick(); h.render();
  assert.match(text(h.tree), /未能確認撤銷結果/); assert.equal(button(h, "撤銷授權").props.disabled, true);
  answer = async () => ({ data: [{ ...grantFixture, revoked_at: "2026-09-09T02:00:00Z" }] });
  click(h, "更新授權清單"); h.effects(); assert.ok(!text(h.tree).includes("Example app"));
  await tick(); h.render(); assert.match(text(h.tree), /已撤銷/);
  assert.equal(calls.filter(c => c.method === "delete").length, 1); h.dispose();
});

test("public connector copy uses a token-free constant and waits for clipboard success", async () => {
  const h = mount(McpWebConnection); const write = deferred();
  navigatorStub.clipboard = { writeText: value => { calls.push({ method: "copy", args: [value] }); return write.promise; } };
  const action = button(h, "複製連接器網址").props.onClick; const first = action(); await action(); h.render();
  assert.equal(calls.length, 1); expectCall("copy", "https://therookery.space/mcp"); assert.ok(!text(h.tree).includes("已複製"));
  write.resolve(); await first; h.render(); assert.match(text(h.tree), /已複製連接器網址/);
  assert.equal(nodes(h.tree, n => n.type === "input")[0].props.value, "https://therookery.space/mcp");
});

test("public copy failure leaves selectable nonsecret URL; CLI command stays backend-exact", async () => {
  navigatorStub.clipboard = undefined; const h = mount(McpWebConnection);
  await button(h, "複製連接器網址").props.onClick(); h.render(); assert.match(text(h.tree), /長按上方網址/);
  const field = nodes(h.tree, n => n.type === "input")[0]; assert.equal(field.props.readOnly, true);
  let selected = false; field.props.onFocus({ currentTarget: { select() { selected = true; } } }); assert.ok(selected);
  const cli = mount(McpConnectionActions, { connection: fixedKey });
  assert.ok(!JSON.stringify(cli.tree).includes(fixedKey.connect_url));
  navigatorStub.clipboard = { writeText: async value => calls.push({ method: "copy", args: [value] }) };
  await button(cli, "複製 Claude Code 指令").props.onClick(); expectCall("copy", fixedKey.claude_code_cmd);
});

test("closing the legacy advanced section discards any displayed manual-copy credential", async () => {
  const h = mount(McpConnectionActions, { connection: fixedKey });
  nodes(h.tree, n => n.type === "details")[0].props.onToggle({ currentTarget: { open: true } }); h.render();
  navigatorStub.clipboard = undefined; await button(h, "複製進階鑰匙網址").props.onClick(); h.render();
  assert.equal(nodes(h.tree, n => n.type === "textarea").length, 1);
  nodes(h.tree, n => n.type === "details")[0].props.onToggle({ currentTarget: { open: false } }); h.render();
  assert.equal(nodes(h.tree, n => n.type === "textarea").length, 0); assert.ok(!JSON.stringify(h.tree).includes(fixedKey.connect_url));
});

test("OAuth code and UI remain isolated from credentials storage and production preview fixtures", () => {
  for (const file of ["src/pages/AuthorizePage.tsx", "src/components/OAuthGrantsPanel.tsx", "src/components/McpWebConnection.tsx", "src/api/oauth.ts"]) {
    const source = readFileSync(resolve(root, file), "utf8");
    for (const pattern of [/localStorage/, /sessionStorage/, /console\./, /dangerouslySetInnerHTML/, /window\.open/]) assert.ok(!pattern.test(source), `${file}: ${pattern}`);
  }
  const advanced = readFileSync(resolve(root, "src/pages/AdvancedAgentPage.tsx"), "utf8");
  assert.ok(advanced.includes("<McpWebConnection />")); assert.ok(advanced.includes("<OAuthGrantsPanel />"));
  const css = readFileSync(resolve(root, "src/oauth.css"), "utf8");
  assert.ok(css.includes("100dvh")); assert.ok(css.includes("safe-area-inset-bottom")); assert.ok(css.includes("var(--ya-accent)"));
  assert.ok(!existsSync(resolve(root, "public/oauth-preview")));
});

test("service worker never serves SPA HTML for backend OAuth discovery or MCP requests", () => {
  const source = readFileSync(resolve(root, "vite.config.ts"), "utf8");
  const value = source.match(/navigateFallbackDenylist:\s*(\[[^\n]+\])/)[1];
  const rules = new Function(`return ${value}`)();
  for (const path of ["/oauth/authorize", "/oauth/consent?request_id=test", "/.well-known/oauth-authorization-server", "/mcp", "/mcp?token=test", "/field-preview/index.html"]) assert.ok(rules.some(rule => rule.test(path)), path);
  assert.ok(!rules.some(rule => rule.test("/authorize?request_id=test")));
});

function authClientHarness(refresh) {
  const storage = new Map([["coliving_access_token", "test-only-access"], ["coliving_refresh_token", "test-only-refresh"]]);
  const retries = []; let requestHook, responseHook, refreshCalls = 0;
  const client = async config => { retries.push(config); return { data: { ok: true } }; };
  client.interceptors = { request: { use: fn => { requestHook = fn; } }, response: { use: (_success, fail) => { responseHook = fail; } } };
  const axios = { create: () => client, post: (...args) => { refreshCalls++; return refresh(...args); } };
  const code = ts.transpileModule(readFileSync(resolve(root, "src/api/client.ts"), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "localStorage", "window", code)(
    name => name === "axios" ? { __esModule: true, default: axios } : oauthNavigation,
    module, module.exports,
    { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, windowStub,
  );
  return { storage, retries, request: config => requestHook(config), reject: error => responseHook(error), refreshCalls: () => refreshCalls, ...module.exports };
}

test("logout during refresh cannot restore credentials or redirect after a newer login", async () => {
  for (const newLogin of [false, true]) {
    const refresh = deferred(); const h = authClientHarness(() => refresh.promise);
    const config = h.request({ url: "/users/me", headers: {} });
    const pending = h.reject({ config, response: { status: 401 } });
    h.clearTokens();
    if (newLogin) h.setTokens("other-access", "other-refresh");
    refresh.resolve({ data: { access_token: "stale-access", refresh_token: "stale-refresh" } });
    await assert.rejects(pending);
    assert.equal(h.storage.get("coliving_access_token"), newLogin ? "other-access" : undefined);
    assert.equal(h.storage.get("coliving_refresh_token"), newLogin ? "other-refresh" : undefined);
    assert.equal(h.retries.length, 0); assert.equal(windowStub.location.href, undefined);
  }
});

test("old refresh failure cannot clear a new login or interfere with its own refresh", async () => {
  const oldRefresh = deferred(), newRefresh = deferred(); let count = 0;
  const h = authClientHarness(() => (++count === 1 ? oldRefresh : newRefresh).promise);
  const oldConfig = h.request({ url: "/users/me", headers: {} });
  const oldRequest = h.reject({ config: oldConfig, response: { status: 401 } });
  h.setTokens("other-access", "other-refresh");
  const newConfig = h.request({ url: "/users/me", headers: {} });
  const newRequest = h.reject({ config: newConfig, response: { status: 401 } });
  assert.equal(h.refreshCalls(), 2);
  oldRefresh.reject(Error("old session expired")); await assert.rejects(oldRequest);
  assert.equal(h.storage.get("coliving_access_token"), "other-access");
  assert.equal(windowStub.location.href, undefined);
  newRefresh.resolve({ data: { access_token: "fresh-other-access", refresh_token: "fresh-other-refresh" } });
  await newRequest;
  assert.equal(h.storage.get("coliving_access_token"), "fresh-other-access");
  assert.equal(h.retries.length, 1);
  await assert.rejects(h.reject({ config: oldConfig, response: { status: 401 } }));
  assert.equal(h.refreshCalls(), 2);
});

test("a previous account's late 401 never retries its request with a newer account's tokens", async () => {
  const h = authClientHarness(async () => ({ data: { access_token: "wrong-access", refresh_token: "wrong-refresh" } }));
  const oldConfig = h.request({ url: "/users/me", headers: {} });
  h.setTokens("other-access", "other-refresh");
  await assert.rejects(h.reject({ config: oldConfig, response: { status: 401 } }));
  assert.equal(h.refreshCalls(), 0); assert.equal(h.retries.length, 0);
  assert.throws(() => h.request(oldConfig), /Session changed/);
  assert.equal(h.storage.get("coliving_access_token"), "other-access");
});

test("late profile reads and saves cannot restore a logged-out account or overwrite a new account", async () => {
  const { AuthProvider } = load("src/contexts/AuthContext.tsx");
  for (const operation of ["bootstrap", "refreshUser", "updateDisplayName"]) {
    tokens = ["old-access", "old-refresh"];
    const oldProfile = deferred(); answer = () => oldProfile.promise;
    const h = mount(AuthProvider, { children: null });
    let pending;
    if (operation === "bootstrap") h.effects();
    else pending = h.tree.props.value[operation]("old name");
    h.tree.props.value.logout(); h.render();
    assert.equal(h.tree.props.value.user, null);
    answer = async method => ({ data: method === "post"
      ? { access_token: "new-access", refresh_token: "new-refresh", user: { id: "new" } }
      : { id: "new" } });
    await h.tree.props.value.login("new", "test-password"); h.render();
    oldProfile.resolve({ data: { id: "old", display_name: "old name" } });
    await pending; await tick(); h.render();
    assert.equal(h.tree.props.value.user.id, "new");
    assert.deepEqual(tokens, ["new-access", "new-refresh"]);
  }
});

test("login 401 stays a visible login error and cannot trigger refresh or lose the return path", async () => {
  const h = authClientHarness(async () => { throw Error("must not refresh login"); });
  for (const url of ["/auth/login", "/auth/register", "/auth/refresh"]) {
    const error = { config: { url, headers: {} }, response: { status: 401 } };
    await assert.rejects(h.reject(error), err => err === error);
  }
  assert.equal(h.refreshCalls(), 0); assert.equal(windowStub.location.href, undefined);
  assert.equal(h.storage.get("coliving_access_token"), "test-only-access");
});

test("expired website session clears only auth tokens and resumes the same consent request after login", async () => {
  windowStub.location.pathname = "/authorize"; windowStub.location.search = "?request_id=test-request&extra=discard";
  const h = authClientHarness(async () => { throw Error("expired refresh"); });
  const error = { config: { url: "/oauth/requests/test-request", headers: {} }, response: { status: 401 } };
  await assert.rejects(h.reject(error));
  assert.equal(h.refreshCalls(), 1); assert.equal(h.storage.size, 0);
  assert.equal(windowStub.location.href, "/login?returnTo=%2Fauthorize%3Frequest_id%3Dtest-request");
  assert.equal(h.retries.length, 0);
});

test("concurrent session 401s share one refresh and queued retries are bounded", async () => {
  const refresh = deferred(); const h = authClientHarness(() => refresh.promise);
  assert.equal(h.request({ headers: {} }).headers.Authorization, "Bearer test-only-access");
  const firstConfig = { url: "/oauth/requests/test-request", headers: {} };
  const secondConfig = { url: "/oauth/grants", headers: {} };
  const first = h.reject({ config: firstConfig, response: { status: 401 } });
  const second = h.reject({ config: secondConfig, response: { status: 401 } });
  assert.equal(h.refreshCalls(), 1);
  refresh.resolve({ data: { access_token: "test-only-new", refresh_token: "test-only-new-refresh" } });
  await Promise.all([first, second]); assert.equal(h.retries.length, 2);
  for (const config of [firstConfig, secondConfig]) {
    assert.equal(config._retry, true); assert.equal(config.headers.Authorization, "Bearer test-only-new");
    await assert.rejects(h.reject({ config, response: { status: 401 } }));
  }
  assert.equal(h.refreshCalls(), 1); assert.equal(windowStub.location.href, undefined);
});

const adultTiers = [
  { value: "guidance12", name: "輔12", hint: "關係與界線", min_age: 12, allowed: true },
  { value: "guidance15", name: "輔15", hint: "情感與身體議題", min_age: 15, allowed: true },
  { value: "restricted", name: "限制級", hint: "明確的性內容", min_age: 18, allowed: true },
];
function adultFixture(allowed = ["guidance12", "guidance15", "restricted"]) {
  return { field_name: "後端命名測試", articles: adultTiers.map((t, i) => ({ id: String(i), category: "communication", category_name: "親密溝通", title: "文章-" + t.value, age_tier: t.value, age_tier_name: t.name, content: "本文", created_at: "2026-09-10T00:00:00Z" })),
    category_counts: {}, allowed_tiers: allowed, tiers: adultTiers.map(t => ({ ...t, allowed: allowed.includes(t.value) })), review_note: "後端提示：人工審核，大約三個工作天。" };
}
function enterAdult() {
  const h = mount(content.ArticlesField, { kind: "adult" });
  nodes(h.tree, n => n.type === "input" && n.props.type === "checkbox")[0].props.onChange({ target: { checked: true } });
  h.render(); click(h, "確認進入"); return h;
}
test("adult uses backend field name, tier names and permissions without computing local age", () => {
  auth.user.birth_year = 1900;
  fixture("/adult", adultFixture(["guidance12"]));
  const h = enterAdult();
  assert.equal(one(h, "FieldFrame").props.fieldName, "後端命名測試");
  assert.deepEqual(components(h, "FieldTabs")[1].props.options, { "": "全部可讀分級", guidance12: "輔12" });
  assert.match(text(h.tree), /文章-guidance12/);
  assert.ok(!text(h.tree).includes("文章-restricted")); assert.ok(!text(h.tree).includes("文章-guidance15"));
  assert.match(text(h.tree), /未開放/); assert.match(text(h.tree), /後端提示/);
  const frame = mount(shared.FieldFrame, one(h, "FieldFrame").props);
  assert.match(text(frame.tree), /後端命名測試/); assert.equal(components(frame, "SpaceChat").length, 0);
});
test("adult tier filter asks the backend to filter before pagination", () => {
  fixture("/adult", adultFixture()); const h = enterAdult(); reads.length = 0;
  fixture("/adult?age_tier=guidance15", { ...adultFixture(), articles: adultFixture().articles.filter(a => a.age_tier === "guidance15") });
  tab(h, "guidance15", 1);
  assert.deepEqual(reads, ["/adult?age_tier=guidance15"]);
  assert.match(text(h.tree), /文章-guidance15/); assert.ok(!text(h.tree).includes("文章-guidance12"));
  assert.ok(!text(h.tree).includes("目前載入的文章"));
});

const { DisplayNameSettings, PasswordSettings } = load("src/components/AccountProfileSettings.tsx");
const { usePagedAdultArticles } = load("src/hooks/usePagedAdultArticles.ts");
function fillPassword(h, old = "old-password", password = "new-password", confirm = password) {
  const fields = nodes(h.tree, n => n.type === "input");
  [old, password, confirm].forEach((value, i) => fields[i].props.onChange({ target: { value } }));
  h.render();
}
test("display name saves trimmed text once, updates the profile and preserves draft on failure", async () => {
  const request = deferred();
  auth.updateDisplayName = name => { calls.push({ method: "name", args: [name] }); return request.promise; };
  const h = mount(DisplayNameSettings);
  nodes(h.tree, n => n.type === "input")[0].props.onChange({ target: { value: "  新名字  " } }); h.render();
  const submit = h.tree.props.onSubmit;
  const pending = submit({ preventDefault() {} }); await submit({ preventDefault() {} });
  assert.deepEqual(calls, [{ method: "name", args: ["新名字"] }]);
  request.resolve({ ...auth.user, display_name: "新名字" }); await pending; h.render();
  assert.match(text(h.tree), /已更新/);
  assert.equal(nodes(h.tree, n => n.type === "input")[0].props.value, "新名字");
  auth.updateDisplayName = async () => { throw { isAxiosError: true, response: { status: 400, data: { detail: "保存失敗" } } }; };
  h.render();
  await h.tree.props.onSubmit({ preventDefault() {} }); h.render();
  assert.match(text(h.tree), /保存失敗/);
  assert.equal(nodes(h.tree, n => n.type === "input")[0].props.value, "新名字");
});
test("password mismatch cannot write, success clears credentials and reloads login once", async () => {
  tokens = ["old-access", "old-refresh"];
  const h = mount(PasswordSettings);
  fillPassword(h, "old-password", "new-password", "different");
  await h.tree.props.onSubmit({ preventDefault() {} }); h.render();
  assert.match(text(h.tree), /不一致/); assert.equal(calls.length, 0);
  fillPassword(h);
  const request = deferred(); answer = () => request.promise;
  const submit = h.tree.props.onSubmit;
  const pending = submit({ preventDefault() {} }); await submit({ preventDefault() {} });
  assert.equal(calls.length, 1);
  expectCall("post", "/users/me/password", { old_password: "old-password", new_password: "new-password" });
  request.resolve({ data: { reauthenticate: true } }); await pending; h.render();
  assert.equal(tokens, null);
  assert.equal(calls.filter(c => c.method === "redirect").length, 1);
  assert.deepEqual(calls.at(-1).args, ["/login?password=changed"]);
  assert.ok(nodes(h.tree, n => n.type === "input").every(n => n.props.value === ""));
});
test("password wrong-current error preserves draft; uncertain save never retries", async () => {
  const h = mount(PasswordSettings); fillPassword(h);
  answer = async () => { throw { isAxiosError: true, response: { status: 400, data: { detail: "目前的密碼不正確" } } }; };
  await h.tree.props.onSubmit({ preventDefault() {} }); h.render();
  assert.match(text(h.tree), /目前的密碼不正確/);
  assert.equal(nodes(h.tree, n => n.type === "input")[0].props.value, "old-password");
  answer = async () => { throw new Error("connection lost"); };
  await h.tree.props.onSubmit({ preventDefault() {} }); h.render();
  assert.match(text(h.tree), /密碼可能已更新/);
  assert.equal(button(h, "更新密碼").props.disabled, true);
  assert.ok(nodes(h.tree, n => n.type === "input").every(n => n.props.value === ""));
  const count = calls.length; await h.tree.props.onSubmit({ preventDefault() {} });
  assert.equal(calls.length, count);
});
test("password utf8 limit and simplified copy do not alter credential values", async () => {
  const h = mount(PasswordSettings); fillPassword(h, "old-password", "密".repeat(25));
  await h.tree.props.onSubmit({ preventDefault() {} }); h.render();
  assert.equal(calls.length, 0); assert.match(text(h.tree), /密碼太長/);
  fillPassword(h, "繁體舊密碼", "繁體新密碼"); language.setUiLanguage("zh-CN"); h.render();
  assert.match(text(h.tree), /修改密码/);
  assert.equal(nodes(h.tree, n => n.type === "input")[1].props.value, "繁體新密碼");
});
test("article load-more appends unique entries, locks double clicks and stops at the end", async () => {
  const initial = { ...adultFixture(), has_more: true, next_offset: 20 };
  fixture("/adult", initial);
  const h = mount(() => usePagedAdultArticles("/adult")); h.effects();
  const request = deferred(); answer = () => request.promise;
  const pending = h.tree.loadMore(); await h.tree.loadMore();
  assert.equal(calls.length, 1);
  expectCall("get", "/adult?limit=20&offset=20");
  request.resolve({ data: { ...initial, articles: [initial.articles[0], { ...initial.articles[0], id: "next", title: "next" }], has_more: false, next_offset: null } });
  await pending; h.render();
  assert.equal(h.tree.data.articles.length, 4); assert.equal(h.tree.hasMore, false);
  await h.tree.loadMore(); assert.equal(calls.length, 1);
});
test("article failed next page keeps prior entries and retries the same offset", async () => {
  fixture("/adult", { ...adultFixture(), has_more: true, next_offset: 20 });
  const h = mount(() => usePagedAdultArticles("/adult")); h.effects();
  answer = async () => { throw new Error("offline"); };
  await h.tree.loadMore(); h.render();
  assert.equal(h.tree.data.articles.length, 3); assert.match(h.tree.moreError.message, /offline/);
  answer = async () => ({ data: { ...adultFixture(), articles: [], has_more: false, next_offset: null } });
  await h.tree.loadMore(); h.render();
  assert.equal(calls.at(-1).args[0], "/adult?limit=20&offset=20"); assert.equal(h.tree.hasMore, false);
});
test("article query change and unmount discard a late page response", async () => {
  fixture("/adult", { ...adultFixture(), has_more: true, next_offset: 20 });
  const props = { path: "/adult" }; const h = mount(({ path }) => usePagedAdultArticles(path), props); h.effects();
  const request = deferred(); answer = () => request.promise;
  const pending = h.tree.loadMore();
  props.path = "/adult?age_tier=guidance12"; fixture(props.path, { ...adultFixture(), articles: [] }); h.render(); h.effects();
  assert.equal(calls[0].args[1].signal.aborted, true);
  request.resolve({ data: { ...adultFixture(), has_more: false } }); await pending; h.render();
  assert.deepEqual(h.tree.data.articles, []);
  h.dispose();
});
test("article permission failure clears readable data and disables further paging", async () => {
  fixture("/adult", { ...adultFixture(), has_more: true, next_offset: 20 });
  const h = mount(() => usePagedAdultArticles("/adult")); h.effects();
  answer = async () => { throw { isAxiosError: true, response: { status: 403, data: { detail: "尚未開放" } } }; };
  await h.tree.loadMore(); h.render();
  assert.equal(h.tree.data, undefined); assert.equal(h.tree.hasMore, false); assert.equal(h.tree.error.status, 403);
});

test("article permission loss or removed tier also closes an already-open cached detail", async () => {
  for (const lostAccess of [true, false]) {
    const initial = { ...adultFixture(), has_more: true, next_offset: 20 };
    fixture("/adult", initial); fixture("/adult/2", initial.articles[2]);
    const h = enterAdult(); h.effects();
    nodes(h.tree, n => n.type === "button" && text(n) === "閱讀文章")[2].props.onClick(); h.render();
    assert.equal(components(h, "FieldDialog").length, 1); assert.match(text(h.tree), /本文/);
    answer = async () => {
      if (lostAccess) throw { isAxiosError: true, response: { status: 403, data: { detail: "尚未開放" } } };
      return { data: { ...adultFixture(["guidance12"]), articles: [], has_more: false, next_offset: null } };
    };
    await button(h, "載入更多文章").props.onClick(); reads.length = 0; h.render(); h.effects();
    assert.equal(components(h, "FieldDialog").length, 0); assert.ok(!text(h.tree).includes("本文"));
    assert.ok(!reads.includes("/adult/2"));
  }
});
test("article detail 401 or 403 immediately removes cached lists and forms until fresh authorization", () => {
  for (const status of [401, 403]) {
    fixture("/adult", adultFixture());
    fixtures.set("/adult/2", { error: { status, message: "閱讀權限失效" } });
    const h = enterAdult(); h.effects();
    nodes(h.tree, n => n.type === "button" && text(n) === "閱讀文章")[2].props.onClick(); h.render();
    assert.equal(components(h, "FieldDialog").length, 0);
    assert.equal(components(h, "FieldForm").length, 0);
    assert.ok(!text(h.tree).includes("文章-guidance"));
    assert.equal(nodes(h.tree, n => n.type === "button" && text(n) === "投稿文章").length, 0);
    assert.equal(one(h, "ResourceState").props.resource.error.status, status);
    h.effects(); h.render();
    assert.equal(one(h, "ResourceState").props.resource.error.status, status);
    fixtures.set("/adult", { loading: true });
    one(h, "ResourceState").props.resource.refresh(); h.render(); h.effects();
    assert.equal(button(h, "投稿文章").props.disabled, true);
    assert.equal(components(h, "FieldDialog").length, 0);
    assert.ok(!text(h.tree).includes("文章-guidance"));
    fixture("/adult", { ...adultFixture(["guidance12"]), articles: [] }); h.render();
    assert.equal(button(h, "投稿文章").props.disabled, false);
    assert.equal(components(h, "FieldDialog").length, 0);
    h.dispose();
  }
});
test("adult disallows posting when tier metadata is missing or contradictory", () => {
  for (const value of [{ articles: [] }, { ...adultFixture([]) }, { ...adultFixture(), allowed_tiers: undefined }, { ...adultFixture(), tiers: null }, { ...adultFixture(["guidance12"]), tiers: adultTiers.map(t => ({ ...t, allowed: false })) }]) {
    fixture("/adult", value); const h = enterAdult();
    assert.equal(button(h, "投稿文章").props.disabled, true); assert.equal(components(h, "FieldForm").length, 0);
  }
});
test("adult entry and exit never offer public chat; even direct stale component calls do not read endpoints", () => {
  fixture("/adult", adultFixture()); const h = enterAdult();
  assert.equal(one(h, "FieldFrame").props.chatEnabled, false);
  assert.ok(nodes(h.tree, n => n.type?.name === "Link" && n.props.to === "/ai-chat").length > 0);
  click(h, "離開分級式人機親密關係中心");
  assert.equal(one(h, "FieldFrame").props.chatEnabled, false);
  reads.length = 0;
  assert.equal(mount(SpaceChat, { space: "adult" }).tree, null);
  assert.equal(mount(SpaceChatContent, { space: "adult" }).tree, null);
  assert.deepEqual(reads, []); assert.deepEqual(calls, []);
});
test("adult submission preserves pending response message and optional suggested tier", async () => {
  fixture("/adult", adultFixture()); const h = enterAdult(); click(h, "投稿文章");
  assert.match(text(h.tree), /後端提示：人工審核，大約三個工作天/);
  const tier = one(h, "FieldSelect", n => n.props.name === "age_tier");
  assert.equal(tier.props.required, false); assert.equal(tier.props.value, "");
  assert.equal(form(h, "確認投稿").props.guarded, true);
  writeResult = { status: "pending", message: "後端原文：已收到，人工審核約三個工作天。" };
  await submit(h, "確認投稿", { title: "投稿", category: "communication", content: "內容", age_tier: "guidance15" }, true);
  expectCall("post", "/adult/submit", { title: "投稿", category: "communication", content: "內容", age_tier: "guidance15" });
  assert.match(text(h.tree), /後端原文/); assert.ok(!text(h.tree).includes("正在更新列表"));
  assert.equal(components(h, "FieldDialog").length, 0);
});
test("adult 403 detail stays authoritative and never leaves readable or writable stale data", () => {
  fixtures.set("/adult", { data: adultFixture(), error: { status: 403, message: "最低是輔12，滿12歲才進得來" } });
  const h = enterAdult();
  assert.equal(button(h, "投稿文章").props.disabled, true); assert.ok(!text(h.tree).includes("文章-guidance12"));
  assert.match(one(h, "ResourceState").props.resource.error.message, /輔12/);
});
const { ContentReviewsPage, ContentReviewQueue, ContentReviewDetail } = load("src/pages/ContentReviewsPage.tsx");
const reviewData = () => ({ id: "r/a", status: "pending", content_type: "adult", submitter_name: "範例室友",
  content: { type: "adult", title: "待審文章", content: "<script>原文不是HTML</script>", age_tier: "guidance12", age_tier_name: "輔12", tier_options: adultTiers } });
test("content review entry reads nothing for non-admins and has a system-dashboard route", () => {
  const h = mount(ContentReviewsPage); assert.equal(components(h, "ContentReviewQueue").length, 0);
  assert.match(text(h.tree), /需要管理員/); assert.deepEqual(reads, []);
  auth.user.role = "admin"; h.render(); assert.equal(components(h, "ContentReviewQueue").length, 1);
  assert.ok(readFileSync(resolve(root, "src/App.tsx"), "utf8").includes('path="/admin/content-reviews"'));
});
test("content review queue filters to adult submissions, paginates and mounts selected detail", () => {
  const path = "/review/pending?content_type=adult&limit=50&offset=0";
  fixture(path, Array.from({ length: 50 }, (_, i) => ({ id: String(i), title: "稿件", created_at: "2026-09-10T00:00:00Z" })));
  const h = mount(ContentReviewQueue); assert.deepEqual(reads, [path]);
  nodes(h.tree, n => n.type === "button" && text(n) === "閱讀與決定分級")[0].props.onClick(); h.render();
  assert.equal(one(h, "ContentReviewDetail").props.id, "0");
  one(h, "FieldDialog").props.onClose(); h.render(); click(h, "下一頁");
  assert.ok(reads.includes("/review/pending?content_type=adult&limit=50&offset=50"));
  assert.equal(button(h, "下一頁").props.disabled, true);
});
function reviewDetail() { fixture("/review/r%2Fa", reviewData()); return mount(ContentReviewDetail, { id: "r/a", onDone() {} }); }
function reviewDecision(h, value) { nodes(h.tree, n => n.type === "select" && n.props.name === "decision")[0].props.onChange({ target: { value } }); h.render(); }
test("review approval sends exact backend tier code and note, plain article content, guarded form", async () => {
  const h = reviewDetail(); reviewDecision(h, "approved");
  assert.ok(text(h.tree).includes("<script>原文不是HTML</script>"));
  assert.equal(nodes(h.tree, n => n.props.dangerouslySetInnerHTML).length, 0);
  assert.equal(one(h, "FieldSelect").props.value, "guidance12");
  assert.equal(form(h, "確認保存審核").props.guarded, true);
  await submit(h, "確認保存審核", { age_tier: "guidance15", note: "分級理由" });
  expectCall("post", "/review/r%2Fa/decide", { decision: "approved", note: "分級理由", age_tier: "guidance15" });
});
test("review rejects invalid/missing tier or note before writing, and rejection omits age_tier", async () => {
  const h = reviewDetail(); reviewDecision(h, "approved");
  await assert.rejects(submit(h, "確認保存審核", { age_tier: "adult", note: "理由" }));
  await assert.rejects(submit(h, "確認保存審核", { age_tier: "guidance12", note: " " }));
  assert.equal(calls.length, 0);
  reviewDecision(h, "rejected"); assert.equal(components(h, "FieldSelect").length, 0);
  await submit(h, "確認保存審核", { age_tier: "guidance15", note: "需修改" });
  expectCall("post", "/review/r%2Fa/decide", { decision: "rejected", note: "需修改" });
});
test("missing, foreign and already-reviewed content cannot be decided", () => {
  for (const value of [{ ...reviewData(), content: null }, { ...reviewData(), status: "approved" }, { ...reviewData(), content: { type: "exhibit" } }]) {
    fixture("/review/r", value); const h = mount(ContentReviewDetail, { id: "r", onDone() {} });
    assert.equal(components(h, "FieldForm").length, 0);
  }
});
test("missing review tier options never permit approval", async () => {
  fixture("/review/r", { ...reviewData(), content: { ...reviewData().content, tier_options: [] } });
  const h = mount(ContentReviewDetail, { id: "r", onDone() {} }); reviewDecision(h, "approved");
  assert.match(text(h.tree), /未取得可用分級/);
  await assert.rejects(submit(h, "確認保存審核", { age_tier: "restricted", note: "理由" }));
  assert.equal(calls.length, 0);
});
const { AgentStatusNote } = load("src/components/AgentStatusNote.tsx");
test("status note is absent for null/empty and remains literal user text in Simplified UI", () => {
  for (const note of [undefined, null, "", " "]) assert.equal(mount(AgentStatusNote, { note }).tree, null);
  language.setUiLanguage("zh-CN");
  const note = "我在圖書館讀書 <b>稍候</b>";
  const h = mount(AgentStatusNote, { note });
  assert.equal(text(h.tree), note); assert.equal(nodes(h.tree, n => n.type === "input" || n.props.dangerouslySetInnerHTML).length, 0);
});
test("directory and plaza show only public agent status note beside agent identity", () => {
  const resident = { id: "r", display_name: "住戶", agent_id: "a", agent_name: "室友", agent_status_note: "勿擾" };
  const identity = mount(ResidentIdentity, { resident });
  assert.equal(one(identity, "AgentStatusNote").props.note, "勿擾");
  fixture("/users/residents", { residents: [resident] });
  const plaza = mount(PlazaField); tab(plaza, "residents");
  assert.equal(one(plaza, "AgentStatusNote").props.note, "勿擾");
  assert.equal(calls.length, 0);
});
test("cabin status note uses mine response and does not add any edit entry", async () => {
  answer = async (_method, url) => ({ data: url === "/home/dashboard" ? { agents: [editorAgent], community_status: {} }
    : url === "/agents/mine" ? { ...editorAgent, status_note: "外出中" }
    : url === "/announcements" ? [] : { clock: {} } });
  const h = mount(load("src/pages/HomePage.tsx").HomePage); h.effects(); await tick(); await tick(); h.render();
  assert.equal(one(h, "AgentStatusNote").props.note, "外出中");
  assert.equal(nodes(h.tree, n => n.type === "input" && n.props.name === "status_note").length, 0); h.dispose();
});
function pasteInto(h, id, value, start = 0, end) {
  const input = byId(h, id), existing = input.props.value;
  let prevented = false;
  input.props.onPaste({ preventDefault() { prevented = true; }, currentTarget: { value: existing, selectionStart: start, selectionEnd: end ?? existing.length }, clipboardData: { getData: () => value } });
  assert.equal(prevented, true); h.render();
}
test("mirror and adoption trim paste immediately while preserving key characters and never writing on paste", async () => {
  const editor = await openNoteEditor(); const adopted = mount(AdoptPage);
  calls.length = 0;
  for (const [h, id] of [[editor, "editor-key"], [adopted, "adopt-api-key"]]) {
    pasteInto(h, id, " \r\n  test-only-key_+-== \t");
    assert.equal(byId(h, id).props.value, "test-only-key_+-==");
    assert.equal(byId(h, id).props.type, "password");
    pasteInto(h, id, " NEW ", 10, 13);
    assert.equal(byId(h, id).props.value, "test-only-NEW_+-==");
  }
  assert.equal(calls.length, 0);
});
test("invalid interior characters are not silently rewritten into another key", async () => {
  const h = await openNoteEditor(); pasteInto(h, "editor-key", " test-中文 key ");
  assert.equal(byId(h, "editor-key").props.value, "test-中文 key");
});
test("both key forms reject too-long paste locally instead of silently truncating", async () => {
  const editor = await openNoteEditor(); const adopted = mount(AdoptPage); fillAdopt(adopted, "");
  calls.length = 0;
  for (const [h, id] of [[editor, "editor-key"], [adopted, "adopt-api-key"]]) {
    pasteInto(h, id, "x".repeat(257)); assert.equal(byId(h, id).props.value.length, 257);
    await nodes(h.tree, n => n.type === "form")[0].props.onSubmit({ preventDefault() {} }); h.render();
    assert.match(text(h.tree), /金鑰超過 256 字/); assert.equal(calls.length, 0);
  }
});
test("both key forms retain exact backend failure detail for invalid, unavailable and malformed keys", async () => {
  for (const detail of ["金鑰存不進去：Anthropic說這把金鑰無效或沒有權限。", "金鑰存不進去：現在連不上 OpenAI，過一下再試（不一定是金鑰的問題）", "金鑰存不進去：金鑰裡有中文或全形字元"]) {
    const editor = await openNoteEditor(); changeValue(editor, "editor-key", " test-only-key ");
    const adopted = mount(AdoptPage); fillAdopt(adopted, " test-only-key ");
    answer = async () => { throw { isAxiosError: true, response: { status: 400, data: { detail } } }; };
    for (const [h, id] of [[editor, "editor-key"], [adopted, "adopt-api-key"]]) {
      await nodes(h.tree, n => n.type === "form")[0].props.onSubmit({ preventDefault() {} }); h.render();
      assert.ok(text(h.tree).includes(detail)); assert.equal(byId(h, id).props.value, "test-only-key");
    }
  }
});
