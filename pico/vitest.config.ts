import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [svelte({ configFile: false })],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    conditions: ["browser"],
  },
  test: {
    name: "svelte",
    include: ["src/**/*.test.svelte.ts"],
    environment: "./test/svelte-environment.ts",
  },
});
