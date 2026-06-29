import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "pico/src/**/*.test.ts"],
    environment: "node",
  },
});
