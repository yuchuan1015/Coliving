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
let active, fixtures, reads, calls, auth, answer, writeResult, tokens;
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const jsxRuntime = { jsx, jsxs: jsx, Fragment: Symbol("Fragment") };
const equalDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const react = {
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
const windowStub = { location: { origin: "https://example.test", pathname: "/", search: "", replace: value => calls.push({ method: "redirect", args: [value] }) }, setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {}, clearTimeout: id => timers.delete(id), setTimeout: (fn, delay) => { const id = timers.size + 1; timers.set(id, { fn, delay }); return id; }, matchMedia: () => ({ matches: true }) };
const sessionValues = new Map();
const sessionStorageStub = { getItem: key => sessionValues.get(key) ?? null, setItem: (key, value) => sessionValues.set(key, value) };
const documentStub = { hidden: false, activeElement: null };
const navigatorStub = { clipboard: { writeText: async value => { calls.push({ method: "copy", args: [value] }); } } };
class TestFormData extends FormData {
  constructor(source) { super(); if (source) for (const [key, value] of source) this.append(key, value); }
}
const api = Object.fromEntries(["get", "post", "patch", "delete", "request"].map(method => [method, async (...args) => {
  calls.push({ method, args });
  return answer ? answer(method, ...args) : { data: writeResult };
}]));
const clientExports = { default: api, getAccessToken: () => null, clearTokens: () => { tokens = null; }, setTokens: (...value) => { tokens = value; } };
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
    if (name === "react-router-dom") return { Link: function Link() {}, Navigate: function Navigate() {}, Outlet: function Outlet() {}, useLocation: () => windowStub.location, useNavigate: () => (...args) => calls.push({ method: "navigate", args }) };
    if (name.endsWith("/api/client") || name === "./client") return { __esModule: true, ...clientExports };
    if (name.endsWith("/hooks/useAuth")) return { useAuth: () => auth };
    if (name.endsWith(".css")) return {};
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
beforeEach(() => {
  fixtures = new Map(); reads = []; calls = []; writeResult = {}; answer = null; tokens = null;
  sessionValues.clear();
  timers.clear(); windowStub.location.pathname = "/"; windowStub.location.search = ""; delete windowStub.location.href;
  navigatorStub.clipboard = { writeText: async value => { calls.push({ method: "copy", args: [value] }); } };
  auth = { user: { id: "me", role: "resident", birth_year: null },
    updateBirthYear: async year => { calls.push({ method: "birth", args: [year] }); auth.user.birth_year = year; },
    refreshUser: async () => { calls.push({ method: "profile", args: [] }); return auth.user; },
  };
});

test("eleven actual destinations remain behind authentication and use existing approved assets", () => {
  assert.equal(fieldData.FIELDS.length, 11);
  const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  for (const [id, , , , , , image] of fieldData.FIELDS) {
    assert.ok(app.includes(`path="/${id}"`));
    assert.ok(app.indexOf(`path="/${id}"`) > app.indexOf("<ProtectedRoute"));
    assert.ok(existsSync(resolve(root, "public/field-preview/assets", image)));
  }
  assert.ok(app.includes('path="/home/library" element={<BookshelfPage'));
  assert.ok(app.includes('path="/reading/:bookId"'));
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
test("AI initiation uses actual recipient name, message and explicit usage confirmation", async () => {
  fixture("/ai-chat/conversations?limit=50", []); fixture("/users/residents", { residents: [{ id: "me", agent_id: "a", agent_name: "自己" }, { id: "them", agent_id: "b", agent_name: "室友B" }] });
  const h = mount(everyday.AIChatField); click(h, "發起私訊");
  assert.deepEqual(one(h, "FieldSelect").props.options, { "室友B": "室友B" });
  assert.equal(nodes(h.tree, n => n.type === "input" && n.props.type === "checkbox")[0].props.required, true);
  writeResult = { conversation: { id: "conversation-1" } };
  await submit(h, "確認發起私訊", { to_agent_name: "室友B", message: " 嗨 " }, true);
  expectCall("post", "/ai-chat/initiate", { to_agent_name: "室友B", message: "嗨" });
  assert.ok(reads.includes("/ai-chat/conversation-1"));
});
test("mail reads a detail only after selecting it; normal/timed/physical payloads differ", async () => {
  fixture("/mail/inbox?limit=100", [{ id: "letter-1", subject: "信", mail_type: "letter" }]);
  const h = mount(everyday.MailField); assert.ok(!reads.includes("/mail/letter-1")); click(h, "閱讀信件"); assert.ok(reads.includes("/mail/letter-1"));
  one(h, "FieldDialog").props.onClose(); h.render(); click(h, "寫一封信");
  writeResult = { id: "mail-new", deliver_at: "2026-09-10T10:00:00Z" };
  await submit(h, "確認寄送", { subject: "主旨", content: "內容", to_agent_id: "b", anonymous: "on" });
  expectCall("post", "/mail/letter", { subject: "主旨", content: "內容", to_agent_id: "b", is_anonymous: true });
  tab(h, "timed", 1);
  await submit(h, "確認寄送", { subject: "主旨", content: "內容", to_agent_id: "b", deliver_at: "2099-09-08T18:30" });
  expectCall("post", "/mail/timed", { subject: "主旨", content: "內容", to_agent_id: "b", deliver_at: "2099-09-08T10:30:00.000Z" });
  await assert.rejects(submit(h, "確認寄送", { deliver_at: "2000-01-01T00:00" }), /未來/);
  tab(h, "physical", 1); await submit(h, "確認寄送", { subject: "訂單", content: "需求" });
  expectCall("post", "/mail/physical", { subject: "訂單", content: "需求" });
});
test("sent-mail deletion is not offered to ordinary senders", () => {
  fixture("/mail/sent?limit=100", [{ id: "s", subject: "信", mail_type: "letter" }]);
  const h = mount(everyday.MailField); tab(h, "sent"); assert.equal(components(h, "ConfirmAction").length, 0);
});
test("physical status update uses admin-only query params", async () => {
  auth.user.role = "admin"; fixture("/mail/inbox?limit=100", [{ id: "p", subject: "包裹", mail_type: "physical" }]);
  fixture("/mail/p", { id: "p", subject: "包裹", content: "內容", mail_type: "physical", status: "pending" });
  const h = mount(everyday.MailField); click(h, "閱讀信件"); await submit(h, "更新寄送狀態", { status: "shipped" });
  expectCall("patch", "/mail/p/status"); assert.deepEqual(calls.at(-1).args.slice(1), [null, { params: { status: "shipped" } }]);
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
  fixture("/adult", { articles: [], category_counts: {} }); const h = mount(content.ArticlesField, { kind: "adult" });
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

test("timed mail receipt navigates to the actual sent list after success", async () => {
  const h = mount(everyday.MailField); click(h, "寫一封信"); tab(h, "timed", 1);
  writeResult = { id: "scheduled", deliver_at: "2099-09-08T10:30:00Z" };
  await submit(h, "確認寄送", { subject: "測試", content: "內容", to_agent_id: "recipient", deliver_at: "2099-09-08T18:30" }, true);
  assert.equal(components(h, "FieldTabs")[0].props.value, "sent");
  assert.match(text(h.tree), /可到寄件匣/); assert.ok(reads.includes("/mail/sent?limit=100"));
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
  }
  const { RegisterPage } = realLoad(resolve(root, "src/pages/RegisterPage.tsx"));
  const registration = renderToString(React.createElement(MemoryRouter, {}, React.createElement(RegisterPage)));
  assert.match(registration, /ya-auth-page ya-register-page/);
  assert.match(registration, /href="\/login"/);
  assert.match(registration, /入住你的艙室/);
  assert.equal((registration.match(/<input /g) || []).length, 5);
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
  const choices = nodes(h.tree, n => n.type === "button" && n.props.className === "ya-destination-row"); assert.equal(choices.length, 12);
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

test("mirror is the only source navigation to the existing protected editor route", () => {
  const matches = [];
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (/\.(ts|tsx)$/.test(entry.name) && readFileSync(file, "utf8").includes("/agent/edit")) matches.push(file.slice(root.length + 1));
    }
  }
  scan(resolve(root, "src"));
  assert.deepEqual(matches.sort(), ["src/App.tsx", "src/data/cabin.ts"]);
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
  assert.equal(nodes(h.tree, n => n.props.id === "adopt-api-key")[0].props.value, " test-only-provider-key ");
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
  return { storage, retries, request: config => requestHook(config), reject: error => responseHook(error), refreshCalls: () => refreshCalls };
}

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
