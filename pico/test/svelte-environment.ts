import { builtinEnvironments, type Environment } from "vitest/runtime";

export default {
  ...builtinEnvironments.node,
  name: "svelte",
  viteEnvironment: "client",
} satisfies Environment;
