import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [svelte(), tailwind(), viteStaticCopy({
    targets: ["cmaps", "standard_fonts", "wasm"].map((folder) => ({
      src: path.resolve(__dirname, `node_modules/pdfjs-dist/${folder}`),
      dest: "pdf-assets",
    })),
  })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/rpc": "http://127.0.0.1:7777",
      "/fs": "http://127.0.0.1:7777",
      "/healthz": "http://127.0.0.1:7777",
      "/sessions": "http://127.0.0.1:7777",
      "/ws": { target: "ws://127.0.0.1:7777", ws: true },
    },
  },
  build: {
    target: "safari17",
    rolldownOptions: {
      treeshake: {
        moduleSideEffects: (id) => (id.includes("/msgpackr/") ? false : undefined),
      },
    },
  },
});
