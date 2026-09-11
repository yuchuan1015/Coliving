import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const root = dirname(fileURLToPath(import.meta.url)), frontend = resolve(root, "../..");
export default defineConfig({ root, publicDir: resolve(frontend, "public"),
  plugins: [{ name: "private-garden-isolation", enforce: "pre", resolveId(source, importer) {
    if (!importer || !source.startsWith(".")) return;
    const target = resolve(dirname(importer.split("?")[0]), source).replace(/\.tsx?$/, "");
    if (target === resolve(frontend, "src/api/client")) return resolve(root, "client.ts");
    if (target === resolve(frontend, "src/contexts/AuthContext")) return resolve(root, "context.ts");
  } }, react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5194, strictPort: true, fs: { allow: [frontend] } },
  build: { outDir: resolve(frontend, "node_modules/.tmp/private-garden-preview"), emptyOutDir: true },
});
