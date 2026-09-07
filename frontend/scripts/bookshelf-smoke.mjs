// Contract tests against intercepted APIs only. Never write real memories or books.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const base = process.env.SHELF_TEST_URL || "http://127.0.0.1:4177";
const output = process.env.SHELF_TEST_OUTPUT || "/tmp/coliving-bookshelf-connected";
await mkdir(output, { recursive: true });
const stamp = "2026-09-08T02:00:00+00:00";
const user = { id: "test-user", display_name: "測試住戶", role: "admin", timezone: "Asia/Taipei", is_active: true };
const agent = { id: "test-agent", name: "測試室友", avatar_emoji: "🐻", status: "active", external_mcps: [], llm_provider: "claude", llm_model: "test" };
const book = { id: "book-1", title: "共讀測試", author: "測試作者", total_pages: 2, total_paragraphs: 13, last_page: 2, progress: 1, highlights: 1, notes: 1 };
const firstText = "這是第一段原文，一起讀書不用得到同一個答案。";
let failures = [];
async function setup(viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block", acceptDownloads: true });
  await context.addInitScript(() => localStorage.setItem("coliving_access_token", "LOCAL-ONLY-NOT-A-REAL-TOKEN"));
  const state = {
    memory: [{ id: "memory-1", text: "真正從 API 讀取的測試記憶", created_at: stamp }], books: [{ ...book }], requests: [],
    memoryStatus: 200, bookStatus: 200, failWrite: false, readDelay: 0,
    highlights: [{ id: "h-agent", paragraph_idx: 13, text: "第二頁", author_kind: "agent", created_at: stamp }],
    notes: [{ id: "n-agent", paragraph_idx: 13, highlight_id: "h-agent", content: "室友留下的批注", author_kind: "agent", created_at: stamp }],
  };
  await context.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    if (!path.startsWith("/api/")) return route.continue();
    const body = method === "POST" && !path.endsWith("/upload") ? route.request().postDataJSON() : null;
    state.requests.push({ path, method, body, query: url.search });
    const response = (json, status = 200) => route.fulfill({ json, status });
    if (path === "/api/users/me") return response(user);
    if (path === "/api/agents/mine") return response(agent);
    if (path === "/api/home/dashboard") return response({ user, agents: [agent], community_status: { message: "測試公告" }, spaces: [] });
    if (path === "/api/home/furniture") return response({ clock: {}, window: { description: "測試天氣", temperature: 18 } });
    if (path === "/api/announcements") return response([]);
    if (path.startsWith("/api/memory")) {
      if (state.memoryStatus !== 200) return response({ detail: ({ 400: "這個室友使用自帶的記憶系統，不用社區的 mem0", 403: "需要先有室友", 503: "社區記憶系統未開啟" })[state.memoryStatus] }, state.memoryStatus);
      if (path === "/api/memory" && method === "GET") return response({ items: state.memory, count: state.memory.length });
      if (path === "/api/memory/search") {
        assert.equal(body.limit, 50);
        if (body.query === "slow") await new Promise(resolve => setTimeout(resolve, 500));
        return response({ items: [{ text: body.query + "搜尋結果無編號", score: .9 }], count: 1, query: body.query });
      }
      if (path === "/api/memory/export") return response(url.searchParams.get("format") === "markdown" ? { format: "markdown", content: "# 後端匯出的完整記憶", count: state.memory.length } : { format: "json", items: state.memory, count: state.memory.length });
      if (state.failWrite) return response({ detail: "測試：保存失敗" }, 500);
      if (path === "/api/memory/remember") { state.memory.push({ id: "new-memory", text: body.text, created_at: stamp }); return response({ ok: true, message: "已記住" }); }
      if (method === "DELETE") { state.memory = state.memory.filter(item => !path.endsWith("/" + item.id)); return response({ ok: true }); }
    }
    if (path === "/api/reading/books" && method === "GET") return state.bookStatus === 200 ? response({ books: state.books }) : response({ detail: "測試：書架離線" }, state.bookStatus);
    if (path === "/api/reading/books/upload") {
      assert.match(route.request().headers()["content-type"], /multipart\/form-data; boundary=/);
      assert.equal(url.searchParams.get("title"), "上傳書名");
      assert.equal(url.searchParams.get("author"), "上傳作者");
      const added = { ...book, id: "upload-1", title: "上傳書名" }; state.books.push(added); return response(added, 201);
    }
    if (path === "/api/reading/books" && method === "POST") {
      if (state.failWrite) return response({ detail: "測試：保存失敗" }, 400);
      assert.equal(body.source_format, "txt");
      const added = { ...book, id: "new-book", title: body.title }; state.books.push(added); return response(added, 201);
    }
    if (path === "/api/reading/books/book-1" && method === "GET") {
      const page = Number(url.searchParams.get("page") || state.books[0].last_page);
      if (state.readDelay) await new Promise(resolve => setTimeout(resolve, state.readDelay));
      state.books[0].last_page = page;
      return response({ book_id: "book-1", title: book.title, page, total_pages: 2, paragraphs: page === 1 ? [{ idx: 1, text: firstText }] : [{ idx: 13, text: "第二頁的第十三段。<script>alert(1)</script>" }], highlights: state.highlights.filter(h => h.paragraph_idx === (page === 1 ? 1 : 13)), notes: state.notes.filter(n => n.paragraph_idx === (page === 1 ? 1 : 13)) });
    }
    if (path.startsWith("/api/reading/books/book-1/")) {
      if (state.failWrite) return response({ detail: "測試：保存失敗" }, 400);
      if (path.endsWith("/highlights") && method === "POST") { assert.equal(body.paragraph_idx, 13); const h = { id: "h-human", ...body, author_kind: "human", created_at: stamp }; state.highlights.push(h); return response(h, 201); }
      if (path.endsWith("/notes") && method === "POST") { assert.equal(body.paragraph_idx, 13); const n = { id: "n-human", highlight_id: null, ...body, author_kind: "human", created_at: stamp }; state.notes.push(n); return response(n, 201); }
      if (method === "DELETE") {
        if (path.includes("/notes/")) state.notes = state.notes.filter(n => !path.endsWith("/" + n.id));
        else state.highlights = state.highlights.filter(h => !path.endsWith("/" + h.id));
        return route.fulfill({ status: 204 });
      }
    }
    failures.push("Unhandled API " + method + " " + path);
    return response({ detail: "Unexpected test API" }, 500);
  });
  const page = await context.newPage();
  page.on("pageerror", error => failures.push(error.message));
  return { page, context, state };
}
try {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1280, height: 900 }]) {
    const { page, context } = await setup(viewport);
    for (const path of ["/home/library", "/memory", "/reading", "/reading/book-1"]) {
      await page.goto(base + path);
      await page.locator(".bookshelf-ui h1").waitFor();
      if (path === "/memory") await page.locator(".memory-item").waitFor();
      if (path === "/reading") await page.locator(".book-item").waitFor();
      if (path === "/reading/book-1") await page.locator(".paragraph-text").waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path + " no overflow");
      assert.equal(await page.locator("main.bookshelf-ui").evaluate(node => getComputedStyle(node).backgroundColor), "rgb(11, 8, 19)", "purple-space background must not expose old cream theme");
      if (viewport.width === 390) await page.screenshot({ path: output + "/" + path.slice(1).replaceAll("/", "-") + ".png", fullPage: true });
    }
    await context.close();
    console.log("PASS four routes/layout " + viewport.width + "x" + viewport.height);
  }
  {
    const { page, context, state } = await setup();
    await page.goto(base);
    await page.getByRole("slider").fill("1");
    await page.getByRole("button", { name: "查看記憶書架", exact: true }).click();
    await page.getByRole("button", { name: "進入 ›" }).click();
    await page.getByRole("link", { name: /我的記憶/ }).click();
    await page.locator(".memory-item").waitFor();
    assert.equal(await page.getByText("宋祈言", { exact: true }).count(), 0, "No hardcoded roommate");
    await page.getByRole("searchbox").fill("slow");
    await page.getByRole("button", { name: "搜尋", exact: true }).click();
    await page.getByRole("searchbox").fill("fast");
    await page.getByRole("button", { name: "搜尋", exact: true }).click();
    await page.getByText("fast搜尋結果無編號", { exact: true }).waitFor();
    assert.equal(await page.locator(".memory-item button").count(), 0, "No id means no delete");
    await page.getByRole("button", { name: "返回全部記憶" }).click();
    await page.locator(".memory-item button").waitFor();
    await page.getByRole("textbox", { name: "想讓室友記得的事" }).fill("新記憶");
    state.failWrite = true;
    await page.getByRole("button", { name: "＋ 加入記憶" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("textbox", { name: "想讓室友記得的事" }).inputValue(), "新記憶");
    state.failWrite = false;
    await page.getByRole("button", { name: "＋ 加入記憶" }).click();
    await page.getByText("新記憶", { exact: true }).waitFor();
    await page.getByRole("button", { name: "刪除記憶：新記憶" }).click();
    await page.getByRole("button", { name: "保留", exact: true }).click();
    assert.equal(state.memory.length, 2);
    await page.getByRole("button", { name: "刪除記憶：新記憶" }).click();
    await page.getByRole("button", { name: "確認刪除" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".memory-item").length === 1);
    for (const format of ["JSON", "Markdown"]) {
      const dl = page.waitForEvent("download");
      await page.getByRole("button", { name: format, exact: true }).click();
      assert.ok((await dl).suggestedFilename().startsWith("我的記憶"));
    }
    assert.ok(state.requests.some(r => r.path === "/api/memory/export" && r.query === "?format=markdown"));
    console.log("PASS furniture entry, search races/no-id, memory save/error/delete/export");
    await context.close();
  }
  for (const status of [400, 403, 503]) {
    const { page, context, state } = await setup();
    state.memoryStatus = status;
    await page.goto(base + "/memory");
    await page.getByRole("alert").waitFor();
    assert.ok(await page.getByRole("button", { name: "＋ 加入記憶" }).isDisabled());
    assert.ok(await page.getByRole("button", { name: "JSON", exact: true }).isDisabled());
    state.memoryStatus = 200;
    await page.getByRole("button", { name: "重新載入", exact: true }).click();
    await page.locator(".memory-item").waitFor();
    await context.close();
    console.log("PASS memory " + status + " and retry");
  }
  {
    const { page, context, state } = await setup();
    state.memory = []; state.books = [];
    await page.goto(base + "/memory");
    await page.getByText(/這裡還沒有記憶/).waitFor();
    await page.goto(base + "/reading");
    await page.getByText(/書架還空著/).waitFor();
    await page.getByRole("textbox", { name: "書名", exact: true }).fill("貼上書名");
    await page.getByRole("textbox", { name: "書的內容", exact: true }).fill("貼上的書籍原文");
    state.failWrite = true;
    await page.getByRole("button", { name: "＋ 放上書架" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("textbox", { name: "書的內容", exact: true }).inputValue(), "貼上的書籍原文");
    state.failWrite = false;
    await page.getByRole("button", { name: "＋ 放上書架" }).click();
    await page.locator(".book-item").waitFor();
    await page.getByRole("textbox", { name: "書名", exact: true }).fill("上傳書名");
    await page.getByRole("textbox", { name: "作者（選填）", exact: true }).fill("上傳作者");
    await page.locator('input[type="file"]').setInputFiles({ name: "too-big.md", mimeType: "text/markdown", buffer: Buffer.alloc(4 * 1024 * 1024 + 1) });
    await page.getByRole("alert").filter({ hasText: "4MB" }).waitFor();
    await page.locator('input[type="file"]').setInputFiles({ name: "book.md", mimeType: "text/markdown", buffer: Buffer.from("UTF-8 test text") });
    assert.equal(state.requests.filter(r => r.path.endsWith("/upload")).length, 0, "No automatic upload");
    await page.getByRole("button", { name: "＋ 放上書架" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".book-item").length === 2);
    console.log("PASS empty states, pasted book, failure preservation, file limit and multipart metadata");
    await context.close();
  }
  {
    const { page, context, state } = await setup();
    await page.goto(base + "/reading/book-1");
    await page.locator(".paragraph-text").waitFor();
    assert.ok(state.requests.find(r => r.path === "/api/reading/books/book-1").query === "", "Resume without page parameter");
    assert.equal(await page.locator(".pagination span").innerText(), "2 / 2");
    assert.equal(await page.locator(".annotation.agent").count(), 1);
    assert.equal(await page.locator(".annotation.agent button").count(), 0);
    state.readDelay = 200;
    await page.getByRole("button", { name: "← 上一頁" }).click();
    await page.getByText(firstText, { exact: true }).waitFor();
    await page.getByRole("button", { name: "下一頁 →" }).click();
    await page.locator('.paragraph-text[data-idx="13"]').waitFor();
    await page.locator(".paragraph-text").evaluate(node => {
      const last = node.lastChild, selection = getSelection(), range = document.createRange();
      range.setStart(last, 1); range.setEnd(last, 5); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event("selectionchange"));
    });
    await page.getByRole("button", { name: "劃線", exact: true }).click();
    await page.getByText("劃線已保存。", { exact: true }).waitFor();
    await page.locator("summary").click();
    await page.getByRole("button", { name: "批注這段劃線" }).last().click();
    await page.getByRole("textbox", { name: "你的批注", exact: true }).fill("人寫的批注");
    state.failWrite = true;
    await page.getByRole("button", { name: "保存批注", exact: true }).click();
    await page.getByRole("dialog").getByRole("alert").waitFor();
    assert.equal(await page.getByRole("textbox", { name: "你的批注", exact: true }).inputValue(), "人寫的批注");
    state.failWrite = false;
    await page.getByRole("button", { name: "保存批注", exact: true }).click();
    await page.locator(".annotation.human").waitFor();
    assert.equal(state.requests.find(r => r.path.endsWith("/notes") && r.method === "POST").body.highlight_id, "h-human");
    await page.getByRole("button", { name: "取消我的劃線" }).click();
    await page.getByRole("button", { name: "確認刪除" }).click();
    await page.getByText("原劃線已移除", { exact: false }).count();
    await page.getByRole("button", { name: "刪除你的批注" }).click();
    await page.getByRole("button", { name: "確認刪除" }).click();
    await page.waitForFunction(() => !document.querySelector(".annotation.human"));
    assert.ok(state.requests.some(r => r.query === "?page=1"));
    console.log("PASS backend pagination/indices, author distinction, highlights and linked notes CRUD");
    await context.close();
  }
  assert.deepEqual(failures, []);
  console.log("All connected bookshelf tests passed with mocked API contracts.");
} finally { await browser.close(); }
