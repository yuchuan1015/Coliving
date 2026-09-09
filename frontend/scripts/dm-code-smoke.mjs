// Local browser checks only: every API request and clipboard write is mocked.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const base = process.env.DM_TEST_URL || "http://127.0.0.1:5182";
const output = process.env.DM_TEST_OUTPUT || "/tmp/coliving-dm-code";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const errors = [];
async function setup(width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
  await context.addInitScript(() => {
    localStorage.setItem("coliving_access_token", "LOCAL-FIXTURE-NOT-A-TOKEN");
    window.__dmCopies = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async code => {
      if (window.__dmCopyDenied) throw Error("Clipboard denied");
      window.__dmCopies.push(code);
    } } });
  });
  const agent = { id: "fixture-agent", name: "範例室友", persona: "本地測試", llm_provider: "claude", llm_model: "claude-sonnet-4", avatar_emoji: "✦", avatar_url: null, display_brain: "", dm_code: "RK-DEMO-1234", dm_code_public: true, status: "active", external_mcps: [] };
  const user = { id: "fixture-user", display_name: "範例居民", role: "resident", timezone: "Asia/Taipei", is_active: true, birth_year: 1996 };
  const state = { agent, writes: [], failSave: false };
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname, method = route.request().method();
    if (method !== "GET") {
      assert.equal(path, "/api/agents/fixture-agent"); assert.equal(method, "PATCH");
      const payload = route.request().postDataJSON();
      state.writes.push(payload);
      if (state.failSave) return route.fulfill({ status: 400, json: { detail: "測試：公開設定保存失敗" } });
      Object.assign(agent, payload);
      return route.fulfill({ json: agent });
    }
    const fixtures = {
      "/api/users/me": user,
      "/api/agents/mine": agent,
      "/api/agents/providers": { providers: [{ key: "claude", name: "Claude" }], disclaimer: "本地預覽，不使用真實資料。" },
      "/api/users/residents": { total: 3, residents: [
        { ...user, agent_id: agent.id, agent_name: agent.name, agent_dm_code: agent.dm_code_public ? agent.dm_code : null, agent_emoji: "✦" },
        { id: "private", display_name: "安靜居民", agent_id: "private-agent", agent_name: "未公開的室友", agent_dm_code: null, agent_emoji: "☾" },
        { id: "drifter", display_name: "漂流居民", agent_id: null, agent_name: null, agent_dm_code: null },
      ] },
      "/api/home/dashboard": { user, agents: [agent], community_status: {}, spaces: [], resident_count: 3 },
      "/api/home/furniture": { window: { description: "深空晴朗", temperature: 18 }, clock: { timezone: "Asia/Taipei" } },
      "/api/announcements": [], "/api/skins/mine": [],
    };
    return route.fulfill({ json: fixtures[path] ?? [] });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  return { context, page, state };
}
const openEditor = async page => { await page.goto(base + "/agent/edit"); await page.getByRole("switch").waitFor(); };
const save = async page => page.getByRole("button", { name: "保存資料", exact: true }).click();
try {
  for (const width of [320, 390, 430, 1280]) {
    const { context, page, state } = await setup(width);
    await openEditor(page);
    assert.equal(await page.getByRole("switch").isChecked(), true);
    await page.getByRole("switch").scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: output + "/mirror-" + width + ".png", fullPage: true });
    await page.goto(base + "/residents");
    await page.getByText("RK-DEMO-1234", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: /複製.*私訊碼/ }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: output + "/directory-" + width + ".png", fullPage: true });
    assert.equal(state.writes.length, 0);
    await context.close();
    console.log("PASS mirror/directory layout " + width);
  }
  {
    const { context, page, state } = await setup();
    await page.goto(base + "/residents");
    await page.getByRole("button", { name: "複製範例室友的私訊碼" }).click();
    await page.getByText("私訊碼已複製。", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__dmCopies), ["RK-DEMO-1234"]);
    await page.evaluate(() => { window.__dmCopyDenied = true; });
    await page.getByRole("button", { name: "複製範例室友的私訊碼" }).click();
    await page.getByLabel("手動複製私訊碼").waitFor();
    assert.equal(await page.getByLabel("手動複製私訊碼").inputValue(), "RK-DEMO-1234");
    await page.getByRole("link", { name: "查看名片" }).first().click();
    await page.getByRole("heading", { name: "居民名片" }).waitFor();
    assert.equal(await page.getByRole("button", { name: /複製.*私訊碼/ }).count(), 1);
    await page.getByRole("link", { name: "← 返回名錄" }).click();
    state.agent.dm_code_public = false;
    await page.getByRole("button", { name: "更新名錄" }).click();
    await page.getByText("RK-DEMO-1234", { exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("link", { name: "查看名片" }).first().click();
    assert.equal(await page.getByRole("button", { name: /複製.*私訊碼/ }).count(), 0);
    assert.equal(state.writes.length, 0);
    await context.close();
    console.log("PASS public/null codes, card, copy/fallback and refresh hides old code");
  }
  {
    const { context, page, state } = await setup();
    await openEditor(page);
    await page.getByRole("switch").uncheck();
    assert.equal(state.writes.length, 0);
    await page.getByText("尚未保存：將隱藏私訊碼。", { exact: true }).waitFor();
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: "返回艙室" }).click();
    assert.ok(page.url().endsWith("/agent/edit"));
    state.failSave = true;
    await save(page);
    await page.getByRole("alert").filter({ hasText: "公開設定保存失敗" }).waitFor();
    assert.equal(await page.getByRole("switch").isChecked(), false);
    state.failSave = false;
    await save(page); await page.waitForURL(base + "/");
    assert.deepEqual(state.writes, [{ dm_code_public: false }, { dm_code_public: false }]);
    await openEditor(page); assert.equal(await page.getByRole("switch").isChecked(), false);
    await page.getByRole("switch").check();
    await save(page); await page.waitForURL(base + "/");
    assert.deepEqual(state.writes.at(-1), { dm_code_public: true });
    await context.close();
    console.log("PASS staged toggle, dirty back, error retention, both boolean saves and reload");
  }
  {
    const { context, page, state } = await setup();
    delete state.agent.dm_code_public;
    await openEditor(page);
    assert.equal(await page.getByRole("switch").isDisabled(), true);
    await page.getByLabel("名字", { exact: true }).fill("新名字");
    await save(page); await page.waitForURL(base + "/");
    assert.deepEqual(state.writes, [{ name: "新名字" }]);
    await context.close();
    console.log("PASS missing field stays disabled and never enters unrelated save");
  }
  assert.deepEqual(errors, []);
  console.log("All DM visibility browser checks passed. APIs/clipboard mocked; no live writes.");
} finally { await browser.close(); }
