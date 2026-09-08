// Static artifact checks; no browser session, credentials or network calls.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(new URL("../../", import.meta.url));
const directory = resolve(frontend, "node_modules/.tmp/cabin-theme-preview-dist");
const base = "/field-preview/cabin-tone-20260909/";
const manifest = [];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function walk(path) {
  for (const name of readdirSync(path)) {
    const file = resolve(path, name), stat = lstatSync(file);
    assert.ok(!stat.isSymbolicLink(), "No symlinks in preview output");
    if (stat.isDirectory()) walk(file);
    else manifest.push({ file: relative(directory, file), sha256: hash(readFileSync(file)) });
  }
}
walk(directory);
assert.equal(manifest.length, 8, "Only two HTML entries, two JS, one CSS and three room images");
assert.ok(manifest.every(({ file }) => /^(index\.html|view\.html|assets\/[\w-]+\.(js|css)|ya-chao-assets\/cabin-(life|memory|shared)-v1\.webp)$/.test(file)));
const text = file => readFileSync(resolve(directory, file), "utf8");
for (const file of ["index.html", "view.html"]) {
  const html = text(file).replaceAll("&#39;", "'");
  assert.match(html, /Content-Security-Policy/);
  assert.ok(html.includes("connect-src 'none'") && html.includes("form-action 'none'") && html.includes("worker-src 'none'"));
  assert.match(html, /name="robots" content="noindex/);
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const resolved = new URL(url, "https://example.test" + base);
    assert.equal(resolved.origin, "https://example.test");
    assert.ok(resolved.pathname.startsWith(base), url);
    assert.ok(existsSync(resolve(directory, resolved.pathname.slice(base.length))), url);
  }
}
const bundle = manifest.filter(({ file }) => file.endsWith(".js")).map(({ file }) => text(file)).join("\n");
assert.doesNotMatch(bundle, /coliving_access_token|coliving_refresh_token|\/api\/auth|navigator\.serviceWorker\.register/);
assert.ok(bundle.includes("cabin-preview-zone-20260909"));
assert.ok(!bundle.includes('"cabin-zone"'));
for (const zone of ["life", "memory", "shared"]) {
  const file = `ya-chao-assets/cabin-${zone}-v1.webp`;
  assert.ok(bundle.includes(base + file));
  assert.equal(hash(readFileSync(resolve(directory, file))), hash(readFileSync(resolve(frontend, "public", file))), "Original room image unchanged");
}
const css = manifest.filter(({ file }) => file.endsWith(".css")).map(({ file }) => text(file)).join("\n");
assert.match(css, /brightness\(1\.32\)/);
assert.ok(css.includes(".cabin-home") && css.includes(".ya-auth-card"));
const productionEntry = readFileSync(resolve(frontend, "src/main.tsx"), "utf8") + readFileSync(resolve(frontend, "src/App.tsx"), "utf8");
assert.ok(!productionEntry.includes("cabin-theme-preview"));
console.log(JSON.stringify({ ok: true, base, directory, files: manifest.length, manifest }));
