// Build just the approved palette comparison. Never reads the main Vite/PWA config
// and never writes frontend/dist or changes a production page.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(root, "../..");
const base = "/field-preview/cabin-tone-20260909/";
const noNetworkPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'";

export default defineConfig({
  root,
  base,
  publicDir: false,
  plugins: [
    {
      name: "isolate-cabin-preview",
      enforce: "pre",
      resolveId(source, importer) {
        if (importer && source.startsWith(".")) {
          const target = resolve(dirname(importer.split("?")[0]), source).replace(/\.tsx?$/, "");
          if (target === resolve(frontend, "src/api/client")) return resolve(root, "preview-client.ts");
        }
      },
      transform(code, id) {
        if (id.split("?")[0] === resolve(frontend, "src/data/cabin.ts")) {
          return { code: code.replaceAll('"/ya-chao-assets/', `"${base}ya-chao-assets/`), map: null };
        }
        if (id.split("?")[0] === resolve(frontend, "src/pages/HomePage.tsx")) {
          return { code: code.replaceAll('"cabin-zone"', '"cabin-preview-zone-20260909"'), map: null };
        }
      },
      transformIndexHtml: {
        order: "post",
        handler() {
          return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: noNetworkPolicy }, injectTo: "head-prepend" }];
        },
      },
      generateBundle() {
        for (const zone of ["life", "memory", "shared"]) {
          const fileName = `ya-chao-assets/cabin-${zone}-v1.webp`;
          this.emitFile({ type: "asset", fileName, source: readFileSync(resolve(frontend, "public", fileName)) });
        }
      },
    },
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: resolve(frontend, "node_modules/.tmp/cabin-theme-preview-dist"),
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: false,
    target: ["es2020", "safari16"],
    rolldownOptions: { input: { index: resolve(root, "index.html"), view: resolve(root, "view.html") } },
  },
});
