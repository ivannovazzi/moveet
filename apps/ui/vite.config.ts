import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/**
 * Identity of this build. Baked into the bundle (`import.meta.env.VITE_BUILD_ID`)
 * AND written to `dist/version.json`, so a long-open tab can compare the code it
 * is running against the code the server is currently handing out. CI can pin it
 * (BUILD_ID=<git sha>); otherwise a build timestamp is enough — every rebuild
 * produces a different value, which is the only property the check needs.
 */
const buildId = process.env.BUILD_ID || `${Date.now().toString(36)}`;

/**
 * Emits `version.json` next to the hashed assets. It is a plain static file, so
 * the bare Caddy `file_server` in the `ui` Docker target serves it with no
 * server-side support; the client fetches it with `cache: "no-store"` to bypass
 * the HTTP cache. Note Caddy's `try_files {path} /index.html` means a missing
 * version.json answers with index.html at 200 — the client treats unparseable
 * responses as "unknown" and stays quiet.
 */
function buildStampPlugin(): Plugin {
  return {
    name: "moveet:build-stamp",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify({ buildId })}\n`,
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), buildStampPlugin()],
  define: {
    "import.meta.env.VITE_BUILD_ID": JSON.stringify(buildId),
  },
  server: {
    port: 5012,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing rendering/vendor deps into their own
        // chunks so the app shell can load (and the map chunk can be lazily
        // fetched) without dragging the whole WebGL stack into the entry bundle.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@deck.gl") || id.includes("@luma.gl") || id.includes("@math.gl")) {
            return "deckgl";
          }
          if (id.includes("radix-ui") || id.includes("@radix-ui")) {
            return "radix";
          }
          if (id.includes("lucide-react")) {
            return "icons";
          }
        },
      },
    },
  },
});
