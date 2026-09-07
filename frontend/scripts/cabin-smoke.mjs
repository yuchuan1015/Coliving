// Local-only UI test: every API request is intercepted; never touches a real account.
// Start Vite first. Set PLAYWRIGHT_MODULE to an installed playwright-core ESM entry.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const output = process.env.CABIN_TEST_OUTPUT || "/tmp/coliving-cabin-smoke";
await mkdir(output, { recursive: true });
const stamp = "2026-09-08T14:42:00+00:00";
const user = { id: "fixture-user", username: "preview", display_name: "預覽住戶", role: "admin", timezone: "Asia/Taipei", is_active: true, created_at: stamp };
const agent = { id: "fixture-agent", name: "宋祈言", avatar_emoji: "🐻", persona: "預覽", llm_provider: "claude", llm_model: "preview-model", status: "active", external_mcps: [], created_at: stamp };
let failures = [];
let count = 0;
try {
  for (const viewport of [{ width: 390, height: 664 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 430, height: 932 }, { width: 1280, height: 900 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce", hasTouch: true });
    await context.addInitScript(() => localStorage.setItem("coliving_access_token", "LOCAL-TEST-NOT-A-REAL-TOKEN"));
    await context.route("**/api/**", async route => {
      if (!new URL(route.request().url()).pathname.startsWith("/api/")) return route.continue();
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
      const fixtures = {
        "/users/me": user,
        "/home/dashboard": { user, agents: [agent], community_status: { message: "歡迎來到共居社區" }, spaces: [], resident_count: 1 },
        "/home/furniture": { window: { description: "深空晴朗", temperature: 18 }, clock: { utc: stamp, timezone: "Asia/Taipei", community_timezone: "Asia/Taipei" } },
        "/announcements": [{ id: "old", title: "舊的置頂公告", created_at: "2026-09-01T00:00:00Z", is_pinned: true }, { id: "new", title: "歡迎來到共居社區", created_at: stamp }],
        "/diary": { entries: [], total: 0, source_counts: {} },
        "/home/furniture/drawer": { items: [] },
        "/home/furniture/photo-frame": { frames: [], categories: {} },
        "/mail/inbox": [], "/mail/sent": [],
        "/outfits/": [{ id: "outfit", name: "日常服", description: "測試造型" }],
        "/outfits/current": { outfit: null },
        "/home/dining/current": { active: false },
        "/pets": { pets: [], max_pets: 1 },
        "/agents/mine": agent, "/schedules": [],
      };
      assert.equal(route.request().method(), "GET", "Smoke test must not mutate data");
      await route.fulfill({ json: fixtures[path] ?? [] });
    });
    const page = await context.newPage();
    page.on("pageerror", error => { failures.push(error.message); console.error(error.message); });
    page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
    await page.goto(process.env.CABIN_TEST_URL || "http://127.0.0.1:4173");
    try { await page.getByText("宋祈言", { exact: true }).waitFor({ timeout: 10000 }); }
    catch (error) { console.error(await page.locator("body").innerText()); await page.screenshot({ path: `${output}/failure.png` }); throw error; }
    await page.waitForFunction(() => [...document.querySelectorAll(".cabin-photo")].every(image => image.complete && image.naturalWidth > 0));
    assert.equal(await page.locator(".cabin-announcement p").innerText(), "歡迎來到共居社區");
    assert.ok((await page.locator(".cabin-weather").innerText()).includes("18°C"));
    const layout = await page.evaluate(() => {
      const rect = selector => { const b = document.querySelector(selector).getBoundingClientRect(); return { y: b.y, bottom: b.bottom, x: b.x, right: b.right, width: b.width, height: b.height }; };
      return { top: rect(".cabin-info"), room: rect(".cabin-room"), bottom: rect(".cabin-agent"), avatar: rect(".cabin-avatar"), fab: rect(".cabin-fab > span"), scrollHeight: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth };
    });
    assert.ok(layout.bottom.bottom <= viewport.height, JSON.stringify(layout));
    assert.ok(layout.scrollHeight <= viewport.height && layout.scrollWidth <= viewport.width, "No viewport overflow");
    assert.equal(layout.avatar.width / 2, layout.fab.width, "FAB is half the avatar diameter");
    assert.ok(Math.abs((layout.avatar.y + layout.avatar.height / 2) - (layout.fab.y + layout.fab.height / 2)) < 1, "Avatar and FAB centers aligned");
    for (const [index, zone, names] of [[0, "生活區", ["睡眠艙", "衣櫃", "鏡子", "時鐘", "窗戶"]], [1, "記憶區", ["日記本", "抽屜", "相框", "記憶書架", "星際信箱"]], [2, "共居區", ["出艙", "餐桌", "寵物"]]]) {
      const slider = page.getByRole("slider", { name: "切換艙室區域" });
      await slider.fill(String(index));
      assert.equal(await slider.getAttribute("aria-valuetext"), zone);
      assert.equal(await page.locator(".cabin-callout").count(), 0);
      assert.equal(await page.locator(".cabin-hotspot").count(), names.length);
      for (const name of names) {
        const hotspot = page.getByRole("button", { name: `查看${name}`, exact: true });
        const marker = await hotspot.boundingBox();
        const room = await page.locator(".cabin-scene").boundingBox();
        assert.ok(marker.x + 22 >= room.x && marker.x + 22 <= room.x + room.width, `${zone}/${name}: hotspot x in room`);
        assert.ok(marker.y + 22 >= room.y && marker.y + 22 <= room.y + room.height - 52, `${zone}/${name}: hotspot y in room and clear of slider`);
        await hotspot.click();
        assert.equal(await page.locator(".cabin-callout").count(), 1);
        assert.equal(await page.locator(".cabin-callout strong").innerText(), name);
        const callout = await page.locator(".cabin-callout").boundingBox();
        assert.ok(callout.x >= room.x && callout.x + callout.width <= room.x + room.width + 1, "Callout horizontal bounds");
        assert.ok(callout.y >= room.y && callout.y + callout.height < room.y + room.height - 44, "Callout avoids slider");
        if (viewport.width === 390 && viewport.height === 844 && name === "睡眠艙") await page.screenshot({ path: `${output}/bed-selected.png` });
        if (["衣櫃", "時鐘", "窗戶", "餐桌", "寵物"].includes(name)) {
          await page.getByRole("button", { name: "進入 ›", exact: true }).click();
          await page.getByRole("dialog").waitFor();
          if (["衣櫃", "餐桌", "寵物"].includes(name)) await page.getByText(/操作介面尚待製作/).waitFor();
          await page.keyboard.press("Escape");
          assert.equal(await page.getByRole("dialog").count(), 0);
        }
        await page.getByRole("button", { name: "收起家具卡片" }).click();
        count++;
      }
      if (viewport.width === 390 && viewport.height === 844) await page.screenshot({ path: `${output}/${index}-${zone}.png` });
    }
    await page.getByRole("button", { name: "展開快捷選單" }).click();
    await page.getByRole("navigation", { name: "艙室快捷選單" }).waitFor();
    if (viewport.width === 390 && viewport.height === 844) await page.screenshot({ path: `${output}/fab-open.png` });
    await page.getByRole("button", { name: "設定", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.getByRole("button", { name: "系統儀表板", exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "登出", exact: true }).count(), 1);
    await page.getByRole("button", { name: "關閉彈窗" }).click();
    // Existing routes restored from furniture cards; wrapped API lists must not crash.
    for (const [name, path] of [["日記本", "/home/diary"], ["抽屜", "/home/drawer"], ["相框", "/home/photos"], ["星際信箱", "/mailbox"]]) {
      await page.getByRole("slider").fill("1");
      await page.getByRole("button", { name: `查看${name}`, exact: true }).click();
      await page.getByRole("button", { name: "進入 ›", exact: true }).click();
      await page.waitForURL(`**${path}`);
      await page.getByRole("heading").first().waitFor();
      await page.goBack();
      await page.getByRole("slider").waitFor();
      assert.equal(await page.getByRole("slider").getAttribute("aria-valuetext"), "記憶區");
    }
    console.log(`PASS ${viewport.width}x${viewport.height}: layout, 13 hotspots, dialogs, FAB, 4 routes`);
    await context.close();
  }
  for (const scenario of ["no-agent", "offline"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 664 } });
    await context.addInitScript(() => localStorage.setItem("coliving_access_token", "LOCAL-TEST-NOT-A-REAL-TOKEN"));
    await context.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path === "/api/users/me") return route.fulfill({ json: { ...user, role: "resident" } });
      if (scenario === "offline") return route.fulfill({ status: 503, json: { detail: "測試離線" } });
      return route.fulfill({ json: path === "/api/home/dashboard" ? { user, agents: [], community_status: { message: "歡迎入住" } } : path === "/api/home/furniture" ? { clock: { timezone: "Asia/Taipei" } } : [] });
    });
    const page = await context.newPage();
    page.on("pageerror", error => failures.push(error.message));
    await page.goto(process.env.CABIN_TEST_URL || "http://127.0.0.1:4173");
    await page.getByText(scenario === "offline" ? "室友資料未同步" : "尚未連結 Agent", { exact: true }).waitFor();
    await page.getByRole("button", { name: "展開快捷選單" }).click();
    await page.getByRole("button", { name: "設定", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "系統儀表板", exact: true }).count(), 0, "Non-admin has no admin shortcut");
    await page.getByRole("button", { name: "關閉彈窗" }).click();
    if (scenario === "no-agent") {
      await page.getByRole("button", { name: "領養室友", exact: true }).click();
      await page.waitForURL("**/adopt");
    }
    console.log(`PASS ${scenario}: usable fallback and role-scoped settings`);
    await context.close();
  }
  assert.deepEqual(failures, []);
  console.log(`PASS ${count} hotspot checks, no page errors. Screenshots: ${output}`);
} finally { await browser.close(); }
