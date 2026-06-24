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
    host: true, // expose to LAN so Capacitor live-reload works on a real device
    port: 5173,
  },
  build: {
    // Capacitor means the only runtime is the device's WebKit, so target it
    // directly instead of generic es2022.
    target: "safari17",
    // "hidden": emit .map files for local symbolication but don't reference
    // them from the bundles; CI strips them from dist before cap sync.
    sourcemap: "hidden",
  },
});
