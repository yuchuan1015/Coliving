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

test("timezone native select pairs dark background with readable text in every control state", () => {
  const select = rule(".cabin-panel .cabin-city-form select");
  assert.equal(select["background-color"], "var(--c-sky)");
  assert.equal(select.color, "var(--c-frost)");
  assert.equal(select["-webkit-text-fill-color"], "var(--c-frost)");
  assert.equal(select["color-scheme"], "dark");
  assert.equal(select["font-size"], "16px");
  assert.equal(select["min-height"], "48px");
  assert.equal(select.appearance, undefined, "Keep native keyboard/touch picker behavior");
  const options = rule(".cabin-panel .cabin-city-form select option");
  assert.equal(options["background-color"], "var(--c-sky)");
  assert.equal(options.color, "var(--c-frost)");
  const disabled = rule(".cabin-panel .cabin-city-form select:disabled");
  assert.equal(disabled.opacity, "1");
  assert.equal(disabled["-webkit-text-fill-color"], "var(--c-muted)");
  assert.ok(rule(".cabin-panel .cabin-city-form select:focus-visible").outline.includes("var(--c-moon)"));
  const home = rule(".cabin-home");
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const bg = luminance(home["--c-sky"]);
  for (const variable of ["--c-frost", "--c-muted"]) {
    const foreground = luminance(home[variable].match(/#[a-f0-9]{6}/)[0]);
    assert.ok((foreground + .05) / (bg + .05) >= 4.5, variable);
  }
});

test("furniture forms pair cabin ink with cabin surface instead of the global light palette", () => {
  const scope = rule(".cabin-panel .cabin-action-fields");
  for (const [local, cabin] of [["--surface", "--c-sky"], ["--ink", "--c-frost"], ["--muted", "--c-muted"], ["--border", "--c-snow"], ["--line", "--c-snow"], ["--accent", "--c-moon"]]) {
    assert.equal(scope[local], `var(${cabin})`);
  }
  assert.equal(scope["color-scheme"], "dark");
  const input = rule(".cabin-panel .cabin-action-fields .field-input :is(input, textarea, select)");
  assert.equal(input["background-color"], "var(--c-sky)");
  assert.equal(input.color, "var(--c-frost)");
  assert.equal(input["-webkit-text-fill-color"], "var(--c-frost)");
  assert.equal(input["color-scheme"], "dark");
  assert.equal(input["font-size"], "16px");
  assert.equal(input.appearance, undefined, "Keep the native file picker and select behavior");
});

test("dining file-picker button and confirmation checkbox use explicit dark control colors", () => {
  const file = rule(".cabin-panel .cabin-action-fields input[type=file]::file-selector-button");
  assert.equal(file.background, "var(--c-glass)");
  assert.equal(file.color, "var(--c-frost)");
  assert.equal(file["-webkit-text-fill-color"], "var(--c-frost)");
  assert.equal(file["min-height"], "44px");
  const checkbox = rule(".cabin-panel .cabin-action-fields input[type=checkbox]");
  assert.equal(checkbox["accent-color"], "var(--c-moon)");
  assert.equal(checkbox["color-scheme"], "dark");
  assert.equal(checkbox.appearance, undefined, "Retain native accessible checkbox behavior");
  assert.match(rule(".cabin-panel .cabin-action-fields input[type=checkbox]:focus-visible").outline, /var\(--c-moon\)/);
});

test("furniture input focus, placeholders and disabled text retain readable cabin colors", () => {
  const base = ".cabin-panel .cabin-action-fields .field-input";
  const placeholder = rule(`${base} ::placeholder`);
  assert.equal(placeholder.color, "var(--c-muted)");
  assert.equal(placeholder["-webkit-text-fill-color"], "var(--c-muted)");
  assert.equal(placeholder.opacity, "1");
  const disabled = rule(`${base} :is(input, textarea, select):disabled`);
  assert.equal(disabled.color, "var(--c-muted)");
  assert.equal(disabled["-webkit-text-fill-color"], "var(--c-muted)");
  assert.equal(disabled.opacity, "1");
  assert.match(rule(`${base} :is(input, textarea, select):focus-visible`).outline, /var\(--c-moon\)/);
  assert.equal(rule(`${base} select option`)["background-color"], "var(--c-sky)");
  assert.match(read("scripts/cabin-theme-preview/view.tsx"), /panel="dining"/);
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

test("isolated auth providers reject display-name writes after account contract changes", () => {
  for (const file of ["scripts/cabin-theme-preview/view.tsx", "scripts/album-preview/preview.tsx", "scripts/social-preview/preview.tsx"]) {
    assert.match(read(file), /updateDisplayName:\s*(?:readOnly|denied)\b/, file);
  }
});
