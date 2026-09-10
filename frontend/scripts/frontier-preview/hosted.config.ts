import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(root, "../..");
export default defineConfig({
  root, base: "/", publicDir: false,
  plugins: [
    { name: "frontier-isolated-static-preview", enforce: "pre",
      resolveId(source, importer) {
        if (!importer || !source.startsWith(".")) return;
        const target = resolve(dirname(importer.split("?")[0]), source).replace(/\.tsx?$/, "");
        if (target === resolve(frontend, "src/api/client")) return resolve(root, "hosted-client.ts");
        if (target === resolve(frontend, "src/contexts/AuthContext")) return resolve(root, "hosted-context.ts");
      },
      generateBundle() {
        const fieldAssets = ["home-cabin-realistic.png", "orbital-lounge.png", "exterior-star-system.png", "mail-station-realistic.png", "workbench-realistic.png", "archive-realistic.png", "orbital-gallery.png", "orbital-garden.png", "sleep-capsule-realistic.png"];
        const files = ["ya-chao-assets/procyon-system-v1.jpg", "ya-chao-assets/frontier-garden-dome.webp", "ya-chao-assets/exterior-star-system.png", "ya-chao-assets/home-cabin-realistic.png", ...fieldAssets.map(file => "field-preview/assets/" + file)];
        for (const fileName of files) this.emitFile({ type: "asset", fileName, source: readFileSync(resolve(frontend, "public", fileName)) });
      },
    }, react(), tailwindcss(),
  ],
  build: {
    outDir: resolve(frontend, "node_modules/.tmp/frontier-hosted-dist"), emptyOutDir: true,
    target: ["es2020", "safari16"], sourcemap: false, modulePreload: false,
    rolldownOptions: { input: resolve(root, "hosted.html") },
  },
});
