import { defineConfig } from "vitest/config";

// Vitest is intentionally scoped to the pure helpers under `lib/` —
// they have no React Native or Expo runtime dependencies, so we can
// run them in plain Node without standing up jest-expo.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
