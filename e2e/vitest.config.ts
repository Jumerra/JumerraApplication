import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 5000,
    pool: "forks",
  },
});
