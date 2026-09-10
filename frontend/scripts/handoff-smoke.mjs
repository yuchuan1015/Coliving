// Local browser checks with intercepted API fixtures. No real credentials or resident data.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const base = process.env.HANDOFF_TEST_URL || "http://127.0.0.1:5178";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = process.env.HANDOFF_TEST_OUTPUT || "/tmp/rookery-handoff-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const tiers = [{ value: "guidance12", name: "輔12", min_age: 12 }, { value: "guidance15", name: "輔15", min_age: 15 }, { value: "restricted", name: "限制級", min_age: 18 }].map(t => ({ ...t, hint: "測試分級說明", allowed: true }));
const articles = Array.from({ length: 45 }, (_, i) => ({ id: `article-${i}`, title: `測試文章 ${i + 1}`, category: "communication", category_name: "親密溝通",
  age_tier: tiers[i % 3].value, age_tier_name: tiers[i % 3].name, author_name: "測試室友", content: "測試內容", status: "published", created_at: "2026-09-10T00:00:00Z" }));
const failures = [];
try {
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() => {
      if (!sessionStorage.getItem("fixture-initialized")) {
        localStorage.setItem("coliving_access_token", "isolated-browser-fixture");
        localStorage.setItem("rookery-ui-language", "zh-TW");
        sessionStorage.setItem("fixture-initialized", "yes");
      }
    });
    let user = { id: "test-user", username: "browser-test", display_name: "測試住戶", birth_year: 1990, role: "resident", is_active: true, timezone: "Asia/Taipei", created_at: "2026-09-10T00:00:00Z" };
    const writes = [], reads = [];
    let denyNext = false;
    await context.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await context.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (request.method() === "PATCH" && path === "/api/users/me") {
        const body = request.postDataJSON(); assert.deepEqual(Object.keys(body), ["display_name"]);
        writes.push({ path, body }); user = { ...user, ...body }; return route.fulfill({ json: user });
      }
      if (request.method() === "POST" && path === "/api/users/me/password") {
        const body = request.postDataJSON(); writes.push({ path, body });
        return body.old_password === "correct-test-password" ? route.fulfill({ json: { reauthenticate: true } })
          : route.fulfill({ status: 400, json: { detail: "目前的密碼不正確" } });
      }
      assert.equal(request.method(), "GET", `unexpected mutation ${path}`);
      reads.push(url.pathname + url.search);
      if (path === "/api/users/me") return route.fulfill({ json: user });
      if (path === "/api/adult") {
        const offset = Number(url.searchParams.get("offset") || 0), limit = Number(url.searchParams.get("limit") || 20);
        if (denyNext && offset) return route.fulfill({ status: 403, json: { detail: "測試權限失效" } });
        const filtered = articles.filter(a => (!url.searchParams.get("age_tier") || a.age_tier === url.searchParams.get("age_tier")) && (!url.searchParams.get("category") || a.category === url.searchParams.get("category")));
        return route.fulfill({ json: { field_name: "分級式人機親密關係中心", tiers, allowed_tiers: tiers.map(t => t.value), articles: filtered.slice(offset, offset + limit),
          has_more: offset + limit < filtered.length, next_offset: offset + limit < filtered.length ? offset + limit : null, category_counts: {}, review_note: "測試投稿需審核" } });
      }
      const fixtures = {
        "/api/agents/mine": { id: "test-agent", name: "測試室友", avatar_emoji: "✦", user_id: user.id },
        "/api/home/dashboard": { user, agents: [], spaces: [], community_status: {}, resident_count: 1 },
        "/api/mail/unread-count": { count: 0 },
      };
      return route.fulfill({ json: fixtures[path] ?? [] });
    });
    const page = await context.newPage(); page.on("pageerror", error => { failures.push(error.message); console.error(error.message); });
    page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
    await page.goto(base + "/settings");
    try { await page.getByLabel("你的顯示名稱", { exact: true }).waitFor({ timeout: 10000 }); }
    catch (error) { console.error(await page.locator("body").innerText()); await page.screenshot({ path: `${output}/failure.png` }); throw error; }
    await page.getByLabel("你的顯示名稱", { exact: true }).fill("  新的測試名字  ");
    await page.getByRole("button", { name: "保存顯示名稱", exact: true }).click();
    await page.getByText("顯示名稱已更新。", { exact: true }).waitFor();
    assert.equal(user.display_name, "新的測試名字");
    await page.getByLabel("目前的密碼", { exact: true }).fill("wrong-test-password");
    await page.getByLabel("新密碼", { exact: true }).fill("new-test-password");
    await page.getByLabel("再輸入一次新密碼", { exact: true }).fill("new-test-password");
    await page.getByRole("button", { name: "更新密碼", exact: true }).click();
    await page.getByText("目前的密碼不正確", { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "settings overflow");
    await page.screenshot({ path: `${output}/settings-${viewport.width}.png`, fullPage: true });
    await page.getByLabel("目前的密碼", { exact: true }).fill("correct-test-password");
    await page.getByRole("button", { name: "更新密碼", exact: true }).click();
    await page.waitForURL("**/login?password=changed");
    try { await page.getByText("密碼已更新，請用新密碼重新登入。", { exact: true }).waitFor({ timeout: 10000 }); }
    catch (error) { console.error(page.url(), await page.locator("body").innerText()); await page.screenshot({ path: `${output}/login-failure.png` }); throw error; }
    assert.equal(await page.evaluate(() => localStorage.getItem("coliving_access_token")), null);
    assert.equal(writes.length, 3);
    await page.evaluate(() => localStorage.setItem("coliving_access_token", "isolated-browser-fixture"));
    await page.goto(base + "/adult");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "確認進入", exact: true }).click();
    const cards = page.locator(".field-list > article");
    await page.waitForFunction(() => document.querySelectorAll(".field-list > article").length === 20);
    await page.getByRole("button", { name: "載入更多文章", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".field-list > article").length === 40);
    await page.getByRole("button", { name: "載入更多文章", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".field-list > article").length === 45);
    assert.equal(await page.getByRole("button", { name: "載入更多文章", exact: true }).count(), 0);
    await page.getByRole("button", { name: "輔15", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".field-list > article").length === 15);
    assert.ok(reads.includes("/api/adult?age_tier=guidance15"));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "articles overflow");
    await page.screenshot({ path: `${output}/articles-${viewport.width}.png`, fullPage: true });
    await page.getByRole("button", { name: "全部可讀分級", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".field-list > article").length === 20);
    denyNext = true;
    await page.getByRole("button", { name: "載入更多文章", exact: true }).click();
    await page.getByText("測試權限失效", { exact: true }).waitFor();
    assert.equal(await cards.count(), 0);
    console.log(`${viewport.width}px: account settings, password errors/success, pagination, tier filter and permission failure passed`);
    await context.close();
  }
  assert.deepEqual(failures, []);
} finally { await browser.close(); }
