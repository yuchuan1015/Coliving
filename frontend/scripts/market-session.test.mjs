// Run from frontend: node --test scripts/market-session.test.mjs
// Executes the real TS modules in memory. No browser, network, real tokens, or
// generated files. The axios stub runs interceptors again on every replay.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_KEY = "coliving_access_token";
const REFRESH_KEY = "coliving_refresh_token";
const USER_A = "fixture-resident-a";
const USER_B = "fixture-resident-b";
const SESSION_CHANGED = "ROOKERY_SESSION_CHANGED";
const contract = (name, run) => test(name, { timeout: 3000 }, run);

const encode = value => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
// Deliberately not signed: checking sub locally must not replace server auth.
const jwt = (sub, claims = {}) => `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub, ...claims })}.Zml4dHVyZQ`;
const TOKEN_A = jwt(USER_A, { jti: "original-a" });
const TOKEN_A2 = jwt(USER_A, { jti: "rotated-a" });
const TOKEN_B = jwt(USER_B, { jti: "other-tab-b" });
const sale = requestId => Object.freeze({
  crop_id: "petite_oyster_mushroom", quantity_g: "0.500", quote_id: "a".repeat(64), request_id: requestId,
});
const SALE = sale("10000000-0000-4000-8000-000000000001");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function sessionChanged(error) {
  assert.ok(error instanceof Error, "The guard must throw an Error");
  assert.equal(error.code, SESSION_CHANGED);
  assert.equal(error.response, undefined, "Do not expose the old HTTP status as a sale business error");
  return true;
}

function httpError(status, code) {
  return Object.assign(new Error(`Fixture HTTP ${status}`), {
    response: { status, data: code ? { ok: false, error: { code, detail: "fixture only", status_code: status } } : {} },
  });
}

const compiled = new Map();
function compiledSource(relative) {
  if (!compiled.has(relative)) {
    const path = resolve(root, relative);
    compiled.set(relative, ts.transpileModule(readFileSync(path, "utf8"), {
      fileName: path,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText);
  }
  return compiled.get(relative);
}

function harness({ token = TOKEN_A, transport = async () => ({ data: { fixture: "accepted" } }), refresh } = {}) {
  const storage = new Map([[REFRESH_KEY, "fixture-refresh-a"]]);
  if (token !== null) storage.set(TOKEN_KEY, token);
  const storageLog = [], sent = [], refreshCalls = [], replays = [], errorObservers = [];
  const requestHooks = [], responseHooks = [];
  let handledErrors = 0;
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storageLog.push(["set", key, value]); storage.set(key, String(value)); },
    removeItem: key => { storageLog.push(["remove", key]); storage.delete(key); },
  };
  const window = { location: { pathname: "/home/garden", search: "" }, localStorage };
  const register = hooks => ({ use(fulfilled, rejected) { hooks.push({ fulfilled, rejected }); return hooks.length - 1; } });
  const configSnapshot = config => ({
    url: config.url, method: config.method, headers: { ...config.headers },
    data: structuredClone(config.data), _expectedUserId: config._expectedUserId, _retry: config._retry,
  });

  function client(input) {
    const config = { ...input, headers: { ...input.headers } };
    if (config._retry) replays.push(configSnapshot(config));
    let result = Promise.resolve(config);
    // Axios applies request interceptors in reverse registration order.
    for (const hook of [...requestHooks].reverse()) result = result.then(hook.fulfilled, hook.rejected);
    result = result.then(async request => {
      sent.push(configSnapshot(request));
      try {
        const response = await transport(request);
        return { status: 200, headers: {}, ...response, config: request };
      } catch (error) {
        error.config ??= request;
        if (error.response) error.response.config ??= request;
        throw error;
      }
    });
    for (const hook of responseHooks) {
      result = result.then(hook.fulfilled, hook.rejected && (error => {
        try { return hook.rejected(error); }
        finally {
          handledErrors++;
          for (const observer of errorObservers) if (handledErrors >= observer.count) observer.resolve();
        }
      }));
    }
    return result;
  }
  client.interceptors = { request: register(requestHooks), response: register(responseHooks) };
  client.request = client;
  client.get = (url, config = {}) => client({ ...config, url, method: "get" });
  client.post = (url, data, config = {}) => client({ ...config, url, data, method: "post" });
  const axios = {
    create(config) { assert.equal(config.baseURL, "/api"); return client; },
    async post(url, data, config) {
      assert.equal(url, "/api/auth/refresh", "Unexpected axios call: network is unavailable in this harness");
      refreshCalls.push({ url, data: structuredClone(data), config });
      assert.ok(refresh, "This scenario must not attempt a refresh");
      return refresh(url, data, config);
    },
  };
  const context = vm.createContext({
    localStorage, window, Error, atob, btoa, TextDecoder, TextEncoder, Uint8Array, URLSearchParams,
    // No fetch, socket APIs, process, or general-purpose require in this context.
  });
  const modules = new Map();
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative).exports;
    const module = { exports: {} };
    modules.set(relative, module);
    const localRequire = name => {
      if (name === "axios") return { __esModule: true, default: axios };
      if (name === "./session-identity") return load("src/api/session-identity.ts");
      if (name === "../oauth-navigation") return { loginPathFor: () => "/login" };
      throw Error(`Unexpected dependency in session contract: ${name}`);
    };
    const evaluate = new vm.Script(`(function(require,module,exports){\n${compiledSource(relative)}\n})`, {
      filename: resolve(root, relative),
    }).runInContext(context);
    evaluate(localRequire, module, module.exports);
    return module.exports;
  }
  const exports = load("src/api/client.ts");
  return {
    ...exports, api: exports.default, storage, storageLog, window, sent, refreshCalls, replays,
    identity: () => load("src/api/session-identity.ts"),
    // Direct Map writes model another tab: no call to this module's setTokens,
    // so its in-memory sessionVersion does not advance.
    switchTabUser(access = TOKEN_B, refreshToken = "fixture-refresh-b") {
      if (access === null) storage.delete(TOKEN_KEY); else storage.set(TOKEN_KEY, access);
      if (refreshToken === null) storage.delete(REFRESH_KEY); else storage.set(REFRESH_KEY, refreshToken);
    },
    waitForHandledErrors(count) {
      if (handledErrors >= count) return Promise.resolve();
      const observer = deferred(); errorObservers.push({ count, resolve: observer.resolve }); return observer.promise;
    },
  };
}

const guardedSale = h => h.api.post("/garden/market/sell", SALE, { _expectedUserId: USER_A });

contract("identity guard accepts matching sub, same-user rotation and an expired token pending server refresh", () => {
  const { assertSessionUser } = harness().identity();
  for (const token of [TOKEN_A, TOKEN_A2, jwt(USER_A, { exp: 1 })]) {
    assert.equal(assertSessionUser(token, USER_A), undefined);
  }
});

const invalidTokens = [
  ["missing", null], ["empty", ""], ["opaque", "not-a-jwt"],
  ["two segments", TOKEN_A.split(".").slice(0, 2).join(".")],
  ["invalid payload base64", `${encode({ alg: "HS256" })}.%%%.Zml4dHVyZQ`],
  ["non-JSON payload", `${encode({ alg: "HS256" })}.${Buffer.from("not JSON").toString("base64url")}.Zml4dHVyZQ`],
  ["null payload", `${encode({})}.${encode(null)}.Zml4dHVyZQ`],
  ["missing sub", `${encode({})}.${encode({ jti: "fixture" })}.Zml4dHVyZQ`],
  ["numeric sub", jwt(123)], ["null sub", jwt(null)], ["empty sub", jwt("")],
  ["another user's sub", TOKEN_B],
];
for (const [label, token] of invalidTokens) {
  contract(`identity guard fails closed for ${label}`, () => {
    assert.throws(() => harness().identity().assertSessionUser(token, USER_A), sessionChanged);
  });
}

contract("another tab's B token blocks an old A sale before the adapter even when its header still says A", async () => {
  const h = harness(); h.switchTabUser();
  await assert.rejects(h.api.post("/garden/market/sell", SALE, {
    _expectedUserId: USER_A, headers: { Authorization: `Bearer ${TOKEN_A}` },
  }), sessionChanged);
  assert.equal(h.sent.length, 0);
  assert.equal(h.refreshCalls.length, 0);
  assert.equal(h.storage.get(TOKEN_KEY), TOKEN_B);
  assert.deepEqual(h.storageLog, []);
});

contract("a fresh B guard and an unguarded legacy endpoint both use the actual B token", async () => {
  const h = harness(); h.switchTabUser();
  await h.api.get("/garden/market", { _expectedUserId: USER_B });
  await h.api.get("/users/me");
  assert.equal(h.sent.length, 2);
  assert.ok(h.sent.every(request => request.headers.Authorization === `Bearer ${TOKEN_B}`));
  assert.equal(h.sent[0]._expectedUserId, USER_B);
  assert.equal(h.sent[1]._expectedUserId, undefined);
});

contract("unguarded legacy requests do not acquire JWT validation as a new requirement", async () => {
  const h = harness({ token: "fixture-opaque-legacy-token" });
  const result = await h.api.get("/users/me");
  assert.deepEqual(result.data, { fixture: "accepted" });
  assert.equal(h.sent.length, 1);
});

for (const token of [null, "fixture-invalid-jwt"]) {
  contract(`guarded request with ${token === null ? "no token" : "invalid JWT"} never reaches adapter or refresh`, async () => {
    const h = harness({ token });
    await assert.rejects(guardedSale(h), sessionChanged);
    assert.equal(h.sent.length, 0);
    assert.equal(h.refreshCalls.length, 0);
  });
}

contract("an explicitly empty expected user fails closed instead of opting out of the guard", async () => {
  const h = harness();
  await assert.rejects(h.api.get("/garden/market", { _expectedUserId: "" }), sessionChanged);
  assert.equal(h.sent.length, 0);
});

for (const [label, token] of [["B", TOKEN_B], ["logout", null], ["invalid JWT", "broken-token"]]) {
  contract(`an old A HTTP 200 is withheld after ${label} replaces the current token`, async () => {
    const arrived = deferred(), reply = deferred();
    const h = harness({ transport: request => { arrived.resolve(request); return reply.promise; } });
    const rejected = assert.rejects(guardedSale(h), sessionChanged);
    await arrived.promise; h.switchTabUser(token);
    reply.resolve({ data: { request_id: SALE.request_id, fixture: "old successful receipt" } });
    await rejected;
    assert.equal(h.sent.length, 1);
    assert.equal(h.refreshCalls.length, 0);
    assert.equal(h.window.location.href, undefined);
  });
}

for (const [status, code] of [[409, "stale_quote"], [409, "insufficient_stock"], [401, undefined], [503, undefined]]) {
  contract(`an old A HTTP ${status}${code ? ` ${code}` : ""} becomes a session error after a cross-tab switch`, async () => {
    const arrived = deferred(), reply = deferred();
    const h = harness({ transport: request => { arrived.resolve(request); return reply.promise; } });
    const rejected = assert.rejects(guardedSale(h), sessionChanged);
    await arrived.promise; h.switchTabUser();
    reply.reject(httpError(status, code));
    await rejected;
    assert.equal(h.refreshCalls.length, 0, "An old A 401 must not refresh B's session");
    assert.equal(h.storage.get(TOKEN_KEY), TOKEN_B);
    assert.equal(h.storage.get(REFRESH_KEY), "fixture-refresh-b");
    assert.equal(h.window.location.href, undefined);
  });
}

contract("same-user token rotation while a sale is in flight still permits its success response", async () => {
  const arrived = deferred(), reply = deferred();
  const h = harness({ transport: request => { arrived.resolve(request); return reply.promise; } });
  const pending = guardedSale(h);
  await arrived.promise; h.switchTabUser(TOKEN_A2, "fixture-refresh-a2");
  const data = { request_id: SALE.request_id, fixture: "same user receipt" };
  reply.resolve({ data });
  assert.equal((await pending).data, data);
  assert.equal(h.sent.length, 1);
});

contract("a current A business 409 remains the original error for sale-specific handling", async () => {
  const original = httpError(409, "stale_quote");
  const h = harness({ transport: async () => { throw original; } });
  await assert.rejects(guardedSale(h), error => error === original);
  assert.equal(h.refreshCalls.length, 0);
});

contract("same-A refresh replays the exact sale body, request id and expected user through request interceptors", async () => {
  let attempt = 0;
  const h = harness({
    transport: async () => {
      if (++attempt === 1) throw httpError(401);
      return { data: { request_id: SALE.request_id, fixture: "replayed receipt" } };
    },
    refresh: async () => ({ data: { access_token: TOKEN_A2, refresh_token: "fixture-refresh-a2" } }),
  });
  const result = await guardedSale(h);
  assert.equal(result.data.request_id, SALE.request_id);
  assert.equal(h.refreshCalls.length, 1);
  assert.deepEqual(h.refreshCalls[0].data, { refresh_token: "fixture-refresh-a" });
  assert.equal(h.sent.length, 2);
  for (const request of h.sent) {
    assert.equal(request._expectedUserId, USER_A);
    assert.deepEqual(request.data, SALE);
  }
  assert.equal(h.sent[0].headers.Authorization, `Bearer ${TOKEN_A}`);
  assert.equal(h.sent[1].headers.Authorization, `Bearer ${TOKEN_A2}`);
  assert.equal(h.sent[1]._retry, true);
  assert.equal(h.replays.length, 1);
  assert.equal(h.storage.get(TOKEN_KEY), TOKEN_A2);
});

contract("two same-A 401s share one refresh and both queued replays retain their own immutable sale request", async () => {
  const refreshed = deferred(), refreshStarted = deferred(), attempts = new Map();
  const h = harness({
    transport: async request => {
      const id = request.data.request_id, count = (attempts.get(id) ?? 0) + 1; attempts.set(id, count);
      if (count === 1) throw httpError(401);
      return { data: { request_id: id } };
    },
    refresh: () => { refreshStarted.resolve(); return refreshed.promise; },
  });
  const second = sale("10000000-0000-4000-8000-000000000002");
  const firstResult = guardedSale(h);
  await refreshStarted.promise;
  const secondResult = h.api.post("/garden/market/sell", second, { _expectedUserId: USER_A });
  const results = Promise.all([firstResult, secondResult]);
  await h.waitForHandledErrors(2);
  assert.equal(h.refreshCalls.length, 1);
  refreshed.resolve({ data: { access_token: TOKEN_A2, refresh_token: "fixture-refresh-a2" } });
  assert.deepEqual((await results).map(response => response.data.request_id), [SALE.request_id, second.request_id]);
  assert.equal(h.sent.length, 4);
  assert.equal(h.replays.length, 2);
  for (const request of h.sent) {
    assert.equal(request._expectedUserId, USER_A);
    assert.deepEqual(request.data, request.data.request_id === SALE.request_id ? SALE : second);
    if (request._retry) assert.equal(request.headers.Authorization, `Bearer ${TOKEN_A2}`);
  }
});

for (const changeRefreshToken of [true, false]) {
  contract(`a cross-tab switch during refresh cannot replay A or overwrite B (${changeRefreshToken ? "both tokens" : "access token first"})`, async () => {
    const refreshed = deferred(), refreshStarted = deferred();
    const h = harness({
      transport: async () => { throw httpError(401); },
      refresh: () => { refreshStarted.resolve(); return refreshed.promise; },
    });
    const outcome = guardedSale(h).then(response => ({ response }), error => ({ error }));
    await refreshStarted.promise;
    const nextRefresh = changeRefreshToken ? "fixture-refresh-b" : "fixture-refresh-a";
    h.switchTabUser(TOKEN_B, nextRefresh);
    refreshed.resolve({ data: { access_token: TOKEN_A2, refresh_token: "fixture-refresh-a2" } });
    const settled = await outcome;
    assert.equal(h.storage.get(TOKEN_KEY), TOKEN_B, "The old refresh must not overwrite the other tab's access token");
    assert.equal(h.storage.get(REFRESH_KEY), nextRefresh);
    assert.deepEqual(h.storageLog, []);
    assert.equal(h.sent.length, 1);
    assert.equal(h.replays.length, 0);
    assert.equal(h.window.location.href, undefined);
    sessionChanged(settled.error);
  });
}

contract("both waiting A requests reject as session-changed if another tab signs in as B during their shared refresh", async () => {
  const refreshed = deferred(), refreshStarted = deferred();
  const h = harness({
    transport: async () => { throw httpError(401); },
    refresh: () => { refreshStarted.resolve(); return refreshed.promise; },
  });
  const firstRejected = assert.rejects(guardedSale(h), sessionChanged);
  await refreshStarted.promise;
  const secondRejected = assert.rejects(h.api.get("/garden/market", { _expectedUserId: USER_A }), sessionChanged);
  await h.waitForHandledErrors(2);
  h.switchTabUser();
  refreshed.resolve({ data: { access_token: TOKEN_A2, refresh_token: "fixture-refresh-a2" } });
  await Promise.all([firstRejected, secondRejected]);
  assert.equal(h.sent.length, 2);
  assert.equal(h.replays.length, 0);
  assert.equal(h.refreshCalls.length, 1);
  assert.equal(h.storage.get(TOKEN_KEY), TOKEN_B);
  assert.equal(h.window.location.href, undefined);
});

contract("an old refresh HTTP 400 is not exposed as the sale's business failure after a cross-tab switch", async () => {
  const refreshed = deferred(), refreshStarted = deferred();
  const h = harness({
    transport: async () => { throw httpError(401); },
    refresh: () => { refreshStarted.resolve(); return refreshed.promise; },
  });
  const rejected = assert.rejects(guardedSale(h), sessionChanged);
  await refreshStarted.promise; h.switchTabUser();
  refreshed.reject(httpError(400));
  await rejected;
  assert.equal(h.sent.length, 1);
  assert.equal(h.replays.length, 0);
  assert.equal(h.storage.get(TOKEN_KEY), TOKEN_B);
  assert.equal(h.window.location.href, undefined);
});

contract("a guarded A request queued behind an unguarded refresh leader still gets its own session guard on rejection", async () => {
  const refreshed = deferred(), refreshStarted = deferred();
  const h = harness({
    transport: async () => { throw httpError(401); },
    refresh: () => { refreshStarted.resolve(); return refreshed.promise; },
  });
  // The legacy request may retain legacy error semantics. Its queued guarded
  // sibling must independently verify its expected user before exposing errors.
  const legacyRejected = assert.rejects(h.api.get("/users/me"));
  await refreshStarted.promise;
  const saleRejected = assert.rejects(guardedSale(h), sessionChanged);
  await h.waitForHandledErrors(2); h.switchTabUser();
  refreshed.resolve({ data: { access_token: TOKEN_A2, refresh_token: "fixture-refresh-a2" } });
  await Promise.all([legacyRejected, saleRejected]);
  assert.equal(h.refreshCalls.length, 1);
  assert.equal(h.sent.length, 2);
  assert.equal(h.replays.length, 0);
  assert.equal(h.storage.get(TOKEN_KEY), TOKEN_B);
  assert.equal(h.storage.get(REFRESH_KEY), "fixture-refresh-b");
  assert.equal(h.window.location.href, undefined);
});
