// Non-browser palette/geometry guards. These do not claim visual or Safari QA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const css = read("src/cabin-home.css").replace(/\/\*[\s\S]*?\*\//g, "");
const all = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
const rules = selector => all.filter(([, s]) => s.trim() === selector).map(([, , body]) => Object.fromEntries(body.split(";").filter(v => v.trim()).map(value => {
  const colon = value.indexOf(":");
  return [value.slice(0, colon).trim(), value.slice(colon + 1).trim()];
})));
const rule = selector => { const matches = rules(selector); assert.ok(matches.length, selector); return matches[0]; };

test("cabin references the unchanged login ink, accent and secondary-text tokens", () => {
  const home = rule(".cabin-home"), login = read("src/ya-home.css");
  for (const [local, shared, fallback] of [
    ["--c-frost", "--ya-ink", "#f4f0ff"],
    ["--c-moon", "--ya-accent", "#c9a7ff"],
    ["--c-muted", "--ya-muted", "#a9a1c7"],
  ]) {
    assert.equal(home[local], `var(${shared}, ${fallback})`);
    assert.ok(login.includes(`${shared}:${fallback}`));
  }
  assert.equal(home["--c-void"], "#020207");
  assert.equal(home["--c-glass"].replace(/\s/g, ""), "rgba(8,6,24,.82)");
  assert.ok(read("src/module-auth.css").includes("background:rgba(8,6,24,.82)"));
  assert.doesNotMatch(css, /#d2a663|#e4dfd2|#090711|rgb\(38 27 52/);
});

test("three-card geometry, responsive rows and FAB/portrait sizing stay fixed", () => {
  assert.equal(rule(".cabin-home")["grid-template-rows"], "136px minmax(0, 1fr) 104px");
  assert.equal(rules(".cabin-home")[1]["grid-template-rows"], "152px minmax(0, 1fr) 120px");
  assert.equal(rule(".cabin-home").height, "100dvh");
  assert.equal(rule(".cabin-home").gap, "12px");
  assert.equal(rule(".cabin-card")["border-radius"], "24px");
  assert.equal(rule(".cabin-avatar").width, "var(--c-avatar)");
  assert.equal(rule(".cabin-fab > span").width, "calc(var(--c-avatar) / 2)");
  assert.equal(rule(".cabin-agent")["align-items"], "center");
  assert.equal(rule(".cabin-zone-slider").left, "24%");
  assert.equal(rule(".cabin-zone-slider").right, "24%");
  assert.equal(rule(".cabin-zone-slider").bottom, "8px");
});

test("exposure applies only to photos, retaining their crop, crossfade and all three assets", () => {
  const photo = rule(".cabin-photo");
  assert.equal(photo.filter, "brightness(1.32) contrast(.96) saturate(.96)");
  assert.equal(photo["object-fit"], "cover");
  assert.equal(photo["pointer-events"], "none");
  assert.equal(photo.transition, "opacity 200ms ease");
  assert.equal(rule(".cabin-photo.is-current").opacity, "1");
  assert.equal(rule(".cabin-scene").filter, undefined);
  const data = read("src/data/cabin.ts");
  for (const name of ["life", "memory", "shared"]) assert.ok(data.includes(`/ya-chao-assets/cabin-${name}-v1.webp`));
  assert.equal((data.match(/image:\s*"/g) ?? []).length, 3);
});

test("glass does not create a card stacking context that traps the FAB below dismiss", () => {
  for (const selector of [".cabin-info, .cabin-agent", ".cabin-agent"]) {
    const card = rule(selector);
    for (const property of ["filter", "backdrop-filter", "-webkit-backdrop-filter", "transform", "isolation", "opacity"]) assert.equal(card[property], undefined, property);
  }
  assert.ok(Number(rule(".cabin-fab-wrap")["z-index"]) > Number(rule(".cabin-menu-dismiss")["z-index"]));
  assert.equal(rule(".cabin-menu-dismiss").position, "fixed");
});

test("mock preview is separate from the production entry and cannot save data", () => {
  const preview = read("scripts/cabin-theme-preview/view.tsx");
  assert.match(preview, /if \(!import\.meta\.env\.DEV && import\.meta\.env\.MODE !== "cabin-preview"\) throw/);
  assert.match(preview, /api\.defaults\.adapter = async config/);
  assert.match(preview, /!== "get"\) return readOnly\(\)/);
  assert.match(preview, /login: readOnly, register: readOnly/);
  assert.doesNotMatch(preview, /setTokens|localStorage\.setItem|fetch\(|XMLHttpRequest/);
  assert.doesNotMatch(read("src/main.tsx") + read("src/App.tsx"), /cabin-theme-preview/);
});
