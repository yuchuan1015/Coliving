// Intercept every API/upload request. No real accounts, keys or backend mutations.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const base = process.env.EDITOR_TEST_URL || "http://127.0.0.1:4176";
const output = process.env.EDITOR_TEST_OUTPUT || "/tmp/coliving-agent-editor";
await mkdir(output, { recursive: true });
const stamp = "2026-09-08T00:00:00Z";
const user = { id: "fixture-user", display_name: "預覽住戶", role: "admin", timezone: "Asia/Taipei", is_active: true };
const initial = { id: "fixture-agent", name: "宋祈言", persona: "精準、不裝、偶爾犯骨頭", avatar_emoji: "🐻", avatar_url: null, llm_provider: "claude", llm_model: "claude-sonnet-4", status: "active", external_mcps: [], created_at: stamp };
const providers = { providers: ["claude", "openai", "xai", "gemini", "deepseek"].map((key, i) => ({ key, name: ["Claude", "OpenAI", "xAI", "Gemini", "DeepSeek"][i] })), disclaimer: "你的對話經由社區伺服器轉送到你選的 AI 供應商，並存在社區資料庫裡，讓你的室友記得你。各供應商的隱私政策不同，請自行評估。" };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXWQAAAAASUVORK5CYII=", "base64");
const errors = [];
async function setup(viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, hasTouch: true, reducedMotion: "reduce" });
  await context.addInitScript(() => localStorage.setItem("coliving_access_token", "LOCAL-TEST-NOT-A-REAL-TOKEN"));
  const state = { agent: { ...initial }, writes: [], failSave: false, failAvatar: false, failLoad: false, failProviders: false };
  await context.route("**/uploads/**", route => route.fulfill({ contentType: "image/png", body: png }));
  await context.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    const method = route.request().method();
    if (method !== "GET") {
      assert.ok(["/api/agents/fixture-agent", "/api/agents/mine/avatar"].includes(path), "Unexpected write");
      state.writes.push({ path, method, body: path.endsWith("/avatar") ? null : route.request().postDataJSON() });
      if (path.endsWith("/avatar")) {
        if (state.failAvatar) return route.fulfill({ status: 500, json: { detail: "測試：頭像保存失敗" } });
        if (method === "POST") assert.match(route.request().headers()["content-type"], /multipart\/form-data; boundary=/);
        state.agent.avatar_url = method === "POST" ? "/uploads/avatars/fixture.png" : null;
        return route.fulfill({ json: { avatar_url: state.agent.avatar_url } });
      }
      if (state.failSave) return route.fulfill({ status: 400, json: { detail: "測試：金鑰驗證失敗" } });
      Object.assign(state.agent, route.request().postDataJSON());
      return route.fulfill({ json: state.agent });
    }
    if (path === "/api/agents/mine" && state.failLoad) return route.fulfill({ status: 503, json: { detail: "測試：暫時離線" } });
    if (path === "/api/agents/providers" && state.failProviders) return route.fulfill({ status: 503, json: {} });
    const fixtures = {
      "/api/users/me": user, "/api/agents/mine": state.agent, "/api/agents/providers": providers,
      "/api/home/dashboard": { user, agents: [state.agent], community_status: { message: "歡迎來到共居社區" }, spaces: [], resident_count: 1 },
      "/api/home/furniture": { window: { description: "深空晴朗", temperature: 18 }, clock: { timezone: "Asia/Taipei" } },
      "/api/announcements": [], "/api/skins/mine": [],
    };
    return route.fulfill({ json: fixtures[path] ?? [] });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  return { context, page, state };
}
async function open(page) { await page.goto(base + "/agent/edit"); await page.getByLabel("名字", { exact: true }).waitFor(); }
async function save(page) { await page.getByRole("button", { name: "保存資料", exact: true }).click(); }
try {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 664 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1280, height: 900 }]) {
    const { context, page } = await setup(viewport);
    await open(page);
    assert.equal(await page.locator(".agent-editor-card").count(), 2);
    assert.equal(await page.locator("#editor-provider option").count(), 5);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const title = await page.getByRole("heading", { name: "資料更新處" }).boundingBox();
    const back = await page.getByRole("button", { name: "返回艙室" }).boundingBox();
    assert.ok(back.x >= title.x + title.width && Math.abs(back.y + back.height / 2 - title.y - title.height / 2) < 2);
    await page.screenshot({ path: output + "/editor-" + viewport.width + "x" + viewport.height + ".png", fullPage: true });
    await page.getByLabel("頭像", { exact: true }).selectOption("preset");
    assert.equal(await page.getByRole("group", { name: "選擇預設頭像" }).getByRole("button").count(), 20);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await context.close();
    console.log("PASS layout " + viewport.width + "x" + viewport.height);
  }
  {
    const { context, page, state } = await setup();
    await page.goto(base);
    await page.getByRole("button", { name: "查看鏡子", exact: true }).click();
    await page.getByRole("button", { name: "進入 ›" }).click();
    await page.waitForURL("**/agent/edit");
    await page.getByLabel("名字", { exact: true }).fill("新的室友名");
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: "返回艙室" }).click();
    assert.ok(page.url().endsWith("/agent/edit"));
    state.failSave = true;
    await save(page);
    await page.getByRole("alert").filter({ hasText: "金鑰驗證失敗" }).waitFor();
    assert.equal(await page.getByLabel("名字", { exact: true }).inputValue(), "新的室友名");
    state.failSave = false;
    await save(page);
    await page.waitForURL(base + "/");
    await page.getByText("新的室友名", { exact: true }).waitFor();
    assert.ok(!("api_key" in state.writes.at(-1).body), "Blank key must be omitted");
    console.log("PASS mirror, dirty return, failed-save retention, save and home refresh");
    await context.close();
  }
  {
    const { context, page, state } = await setup();
    state.agent.llm_model = "existing-custom-model";
    await open(page);
    assert.equal(await page.getByRole("textbox", { name: "自填模型名稱" }).inputValue(), "existing-custom-model");
    await page.getByLabel("大腦", { exact: true }).selectOption("gemini");
    await save(page);
    assert.equal(state.writes.length, 0, "Provider change without key must not submit");
    await page.getByLabel("API 金鑰", { exact: true }).fill("FAKE-LOCAL-KEY");
    await page.getByLabel("模型", { exact: true }).selectOption("__custom");
    await page.getByRole("textbox", { name: "自填模型名稱" }).fill("fixture-custom-model");
    await save(page);
    await page.waitForURL(base + "/");
    assert.equal(state.writes[0].body.llm_provider, "gemini");
    assert.equal(state.writes[0].body.llm_model, "fixture-custom-model");
    console.log("PASS existing custom model, provider guard and custom model save");
    await context.close();
  }
  {
    const { context, page, state } = await setup();
    await open(page);
    await page.getByLabel("頭像", { exact: true }).selectOption("photo");
    await page.locator("#editor-photo").setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
    await page.getByRole("alert").filter({ hasText: "2MB" }).waitFor();
    await page.locator("#editor-photo").setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: png });
    await page.locator(".agent-editor-avatar img").waitFor();
    assert.equal(state.writes.length, 0, "Selecting a photo must not upload");
    await page.getByLabel("名字", { exact: true }).fill("照片室友");
    state.failAvatar = true;
    await save(page);
    await page.getByRole("alert").filter({ hasText: "文字資料已保存" }).waitFor();
    assert.equal(state.writes.filter(write => write.method === "PATCH").length, 1);
    state.failAvatar = false;
    await save(page);
    await page.waitForURL(base + "/");
    await page.locator(".cabin-avatar img").waitFor();
    assert.equal(state.writes.filter(write => write.method === "PATCH").length, 1, "Retry should only upload");
    await open(page);
    await page.getByLabel("頭像", { exact: true }).selectOption("default");
    const before = state.writes.length;
    assert.ok(state.agent.avatar_url, "Revert must be staged until save");
    await save(page);
    await page.waitForURL(base + "/");
    assert.equal(state.agent.avatar_url, null);
    assert.equal(state.writes[before].method, "DELETE");
    console.log("PASS avatar validation, staged upload/delete, partial-save recovery and home photo");
    await context.close();
  }
  {
    const { context, page, state } = await setup();
    state.failLoad = true;
    state.failProviders = true;
    await page.goto(base + "/agent/edit");
    await page.getByRole("alert").filter({ hasText: "暫時離線" }).waitFor();
    state.failLoad = false;
    await page.getByRole("button", { name: "重新載入", exact: true }).click();
    await page.getByLabel("名字", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("大腦", { exact: true }).isDisabled(), true);
    state.failProviders = false;
    await page.getByRole("button", { name: "重新載入聲明與供應商" }).click();
    await page.getByText(providers.disclaimer, { exact: true }).waitFor();
    assert.equal(await page.getByLabel("大腦", { exact: true }).isDisabled(), false);
    console.log("PASS load/retry and provider/disclaimer retry");
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log("All editor tests passed; all APIs mocked.");
} finally { await browser.close(); }
