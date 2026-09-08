// Isolated contract tests: no real account, geolocation, weather provider or VPS writes.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const base = process.env.CITY_TEST_URL || "http://127.0.0.1:4177";
await mkdir("/tmp/coliving-city-weather", { recursive: true });
const errors = [];
try {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1280, height: 900 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true, serviceWorkers: "block" });
    await context.addInitScript(() => localStorage.setItem("coliving_access_token", "MOCK-ONLY-NOT-REAL"));
    const user = { id: "user", display_name: "測試住戶", role: "user", timezone: "Asia/Taipei", location_name: "台北" };
    let failWeather = false, community = false, unknown = false, nullWindow = false, blockSave;
    const patches = [];
    await context.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const response = (json, status = 200) => route.fulfill({ json, status });
      if (path === "/api/users/me") {
        if (route.request().method() === "PATCH") {
          const body = route.request().postDataJSON(); patches.push(body);
          assert.deepEqual(Object.keys(body), ["location_name"], "Do not alter timezone or other user fields");
          if (blockSave) await blockSave;
          if (body.location_name === "不存在") return response({ detail: "找不到這個地方，換個寫法試試" }, 400);
          user.location_name = body.location_name === "Tokyo" ? "東京" : body.location_name || null;
        }
        return response(user);
      }
      if (path === "/api/home/dashboard") return response({ agents: [], community_status: { message: "測試公告" } });
      if (path === "/api/announcements") return response([]);
      if (path === "/api/home/furniture") {
        if (failWeather) return response({ detail: "測試天氣暫時斷線" }, 503);
        return response({ clock: {}, window: nullWindow ? null : { weather: unknown ? "unknown" : community ? "rainy" : "sunny", description: community ? "社區雨天" : "晴朗的夜", temperature: community ? 99 : 0, source: unknown ? undefined : community ? "community" : "local", location: user.location_name ?? "台北", is_day: false, wind_kmh: 0 }, community_weather: { description: "不該顯示的社區天氣", temperature: 99 } });
      }
      errors.push("Unexpected API " + path);
      return response({}, 404);
    });
    const page = await context.newPage();
    page.on("pageerror", err => errors.push(err.message));
    async function settings() {
      await page.getByRole("button", { name: "展開快捷選單" }).click();
      await page.getByRole("button", { name: "設定", exact: true }).click();
      await page.getByRole("textbox", { name: "所在城市" }).waitFor();
    }
    await page.goto(base);
    await page.getByText("晴朗的夜", { exact: true }).waitFor();
    assert.ok((await page.locator(".cabin-weather").innerText()).includes("☾"));
    assert.ok((await page.locator(".cabin-weather").innerText()).includes("0°C"));
    await settings();
    const input = page.getByRole("textbox", { name: "所在城市" });
    assert.equal(await input.inputValue(), "台北");
    assert.equal(await input.getAttribute("maxlength"), "64");
    assert.equal(patches.length, 0, "Opening settings must not save");
    await input.fill("不存在");
    await page.getByRole("button", { name: "保存城市" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await input.inputValue(), "不存在");
    assert.equal(user.location_name, "台北");
    let resolveSave;
    blockSave = new Promise(resolve => { resolveSave = resolve; });
    await input.fill(" Tokyo ");
    await page.getByRole("button", { name: "保存城市" }).click();
    await page.getByRole("button", { name: "處理中…" }).waitFor();
    assert.ok(await page.getByRole("button", { name: "關閉彈窗" }).isDisabled());
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 1, "Busy modal stays open");
    resolveSave(); blockSave = undefined;
    await page.getByText("城市設定已保存。", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "東京");
    await page.screenshot({ path: `/tmp/coliving-city-weather/settings-${viewport.width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const dialogBounds = await page.getByRole("dialog").boundingBox();
    assert.ok(dialogBounds.x >= 0 && dialogBounds.y >= 0 && dialogBounds.y + dialogBounds.height <= viewport.height);
    await page.getByRole("button", { name: "關閉彈窗" }).click();
    await page.getByRole("button", { name: "查看天氣", exact: true }).click();
    await page.getByText("東京", { exact: true }).waitFor();
    await page.getByText("0 km/h", { exact: true }).waitFor();
    await page.getByText("夜間", { exact: true }).waitFor();
    await page.getByRole("button", { name: "關閉彈窗" }).click();
    await settings();
    assert.equal(await input.inputValue(), "東京", "Auth state saved across reopening");
    failWeather = true;
    await input.fill("");
    await page.getByRole("button", { name: "保存城市" }).click();
    await page.getByText(/城市設定已保存，天氣暫時無法更新/).waitFor();
    assert.equal(user.location_name, null);
    assert.ok((await page.locator(".cabin-weather").innerText()).includes("天氣待同步"), "Never retain stale city weather after failed refresh");
    const saves = patches.length;
    failWeather = false; community = true;
    await page.getByRole("button", { name: "重新讀取天氣" }).click();
    await page.getByText("社區雨天", { exact: true }).waitFor();
    assert.equal(patches.length, saves, "Weather retry must not PATCH again");
    await page.getByRole("button", { name: "關閉彈窗" }).click();
    await page.getByRole("button", { name: "查看天氣", exact: true }).click();
    await page.getByText(/當地天氣暫不可用，目前顯示社區天氣/).waitFor();
    await page.screenshot({ path: `/tmp/coliving-city-weather/fallback-${viewport.width}.png` });
    unknown = true;
    await page.reload();
    await page.getByText("社區雨天", { exact: true }).waitFor();
    assert.ok((await page.locator(".cabin-weather").innerText()).includes("◌"));
    nullWindow = true;
    await page.reload();
    await page.getByRole("button", { name: "查看天氣", exact: true }).click();
    await page.getByText(/天氣尚未同步/).waitFor();
    assert.equal(await page.getByText("不該顯示的社區天氣", { exact: true }).count(), 0);
    await context.close();
    console.log(`PASS ${viewport.width}: city save/error/clear, busy guard, normalized city, weather-only retry, local/community/night/zero/unknown/null`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
