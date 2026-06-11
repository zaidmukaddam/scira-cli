import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    resolve: {
      conditions: ["node"],
    },
    coverage: {
      provider: "v8",
      include: ["src/storage/**", "src/agent/tools.ts", "src/types/**"],
    },
  },
});
