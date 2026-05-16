import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Jumerra mobile app's web preview.
 *
 * The Expo dev server serves the React Native Web bundle at the
 * `$REPLIT_EXPO_DEV_DOMAIN` host (Expo bypasses the shared `/mobile/`
 * proxy in development).  In a production deploy, the static build is
 * reachable through the shared proxy at `/mobile/` on the deployment
 * domain.  Both work — set `E2E_BASE_URL` to override the default.
 *
 * Default precedence:
 *   1. `E2E_BASE_URL` if set
 *   2. `https://$REPLIT_EXPO_DEV_DOMAIN` if the env var is present
 *   3. `http://localhost:80/mobile/` (production-style proxy)
 */
function resolveBaseURL(): string {
  if (process.env.E2E_BASE_URL) return process.env.E2E_BASE_URL;
  if (process.env.REPLIT_EXPO_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`;
  }
  return "http://localhost:80/mobile/";
}

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: resolveBaseURL(),
    trace: "retain-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium-mobile",
      use: {
        // We deliberately do NOT use `devices["Pixel 7"]` (hasTouch +
        // isMobile) here.  Playwright auto-translates `page.mouse.*`
        // calls to synthetic touch events on touch-enabled contexts,
        // and RN-Web's PanResponder doesn't pick those up in the same
        // way it picks up real mouse/pointer events, so the
        // synthesized swipe in the test never crosses the responder
        // threshold.  Using a mobile viewport size but plain Desktop
        // Chrome inputs gives us the right layout AND a swipeable card.
        ...devices["Desktop Chrome"],
        viewport: { width: 412, height: 915 },
      },
    },
  ],
});
