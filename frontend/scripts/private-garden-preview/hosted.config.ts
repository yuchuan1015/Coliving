import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const root = dirname(fileURLToPath(import.meta.url)), frontend = resolve(root, "../..");
export default defineConfig({ root, publicDir: false,
  plugins: [{ name: "private-garden-hosted-isolation", enforce: "pre", resolveId(source, importer) {
    if (!importer || !source.startsWith(".")) return;
    const target = resolve(dirname(importer.split("?")[0]), source).replace(/\.tsx?$/, "");
    if (target === resolve(frontend, "src/api/client")) return resolve(root, "client.ts");
    if (target === resolve(frontend, "src/contexts/AuthContext")) return resolve(root, "context.ts");
  }, generateBundle() {
    for (const file of ["frontier-garden-dome.webp", "home-cabin-realistic.png", "exterior-star-system.png"]) {
      const fileName = `ya-chao-assets/${file}`;
      this.emitFile({ type: "asset", fileName, source: readFileSync(resolve(frontend, "public", fileName)) });
    }
  } }, react(), tailwindcss()],
  build: { outDir: resolve(frontend, "node_modules/.tmp/private-garden-hosted"), emptyOutDir: true, sourcemap: false, modulePreload: false, target: ["es2020", "safari16"], rolldownOptions: { input: resolve(root, "hosted.html") } },
});
