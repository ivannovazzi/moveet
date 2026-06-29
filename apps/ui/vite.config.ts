import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
