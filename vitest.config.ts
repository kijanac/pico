import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "node", include: ["packages/*/test/**/*.test.ts", "pico/src/**/*.test.ts"], environment: "node" } },
      "./pico/vitest.config.ts",
    ],
  },
});
