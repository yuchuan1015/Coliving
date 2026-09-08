// Non-browser contract tests. No DOM, no server, no real account or API writes.
// Transpile the actual TSX, inspect its element tree, and exercise its callbacks
// with controlled hooks and API fixtures. This is not a browser/E2E substitute.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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
const windowStub = { location: { origin: "https://example.test" }, setInterval: () => 1, clearTimeout() {}, setTimeout: fn => { fn(); return 1; }, matchMedia: () => ({ matches: true }) };
const documentStub = { hidden: false, activeElement: null };
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
    if (name === "react-router-dom") return { Link: function Link() {}, useNavigate: () => (...args) => calls.push({ method: "navigate", args }) };
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
  new Function("require", "module", "exports", "window", "document", "FormData", code)(localRequire, module, module.exports, windowStub, documentStub, TestFormData);
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

test("real React server rendering serializes all eleven field screens safely", () => {
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
  assert.equal(calls.length, 0);
});

test("navigation reads actual coordinates including zero and never probes all fields", () => {
  const { DashboardPage } = load("src/pages/DashboardPage.tsx");
  auth.user.coordinate = { l: 0, b: 0, r: 0 }; auth.user.drifting = false;
  const h = mount(DashboardPage); assert.match(text(h.tree), /艙室 I · 0.0°/); assert.equal(calls.length, 0);
  const choices = nodes(h.tree, n => n.type === "button" && n.props.className === "ya-destination-row"); assert.equal(choices.length, 12);
  choices.find(n => text(n).includes("Proxima")).props.onClick(); choices.find(n => text(n).includes("Sirius")).props.onClick();
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
