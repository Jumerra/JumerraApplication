import { defineConfig } from "@playwright/test";

const API_PORT = Number(process.env.E2E_API_PORT ?? 8090);
const API_URL = process.env.E2E_API_URL ?? `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["./reporters/post-merge-reporter.ts"]],
  use: {
    baseURL: API_URL,
    extraHTTPHeaders: { "x-e2e": "1" },
    trace: "off",
  },
  globalSetup: "./helpers/global-setup.ts",
  globalTeardown: "./helpers/global-teardown.ts",
  webServer: {
    // dev script = `pnpm run build && pnpm run start`
    command: "pnpm --filter @workspace/api-server run dev",
    url: `${API_URL}/api/healthz`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PORT: String(API_PORT),
      NODE_ENV: "development",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-test-session-secret",
      SESSION_COOKIE_SECURE: "false",
      STRIPE_WEBHOOK_SECRET:
        process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_e2e_test_secret",
      PAYSTACK_SECRET_KEY:
        process.env.PAYSTACK_SECRET_KEY ?? "sk_test_paystack_e2e",
      // DATABASE_URL must already be in the parent env.
      DATABASE_URL: process.env.DATABASE_URL ?? "",
    },
  },
});
