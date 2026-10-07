import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwind from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [svelte(), tailwind()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    // In production the host serves this app; in dev, forward its routes so the
    // app's own origin still reaches the host (pnpm dev:host).
    proxy: {
      "/rpc": "http://127.0.0.1:7777",
      "/healthz": "http://127.0.0.1:7777",
      "/sessions": "http://127.0.0.1:7777",
      "/ws": { target: "ws://127.0.0.1:7777", ws: true },
    },
  },
  build: {
    // The phone's WebKit is the only runtime, so target it directly.
    target: "safari17",
    rolldownOptions: {
      treeshake: {
        // @effect/rpc imports msgpackr for its MessagePack serializer, which the
        // app never uses (JSON only); msgpackr declares no sideEffects, so say so.
        moduleSideEffects: (id) => (id.includes("/msgpackr/") ? false : undefined),
      },
    },
  },
});
