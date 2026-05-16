import {
  test,
  expect,
  request,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * End-to-end regression test for the mobile For-You swipe-to-apply
 * flow.  Mirrors the user journey:
 *
 *   1. Self-register a fresh candidate via /api/auth/register.
 *   2. Sign in via the mobile web UI sign-in screen.
 *   3. Navigate into the For-You tab.
 *   4. Trigger the swipe-right path on the top job card with a real
 *      synthesized pointer-event gesture (pointerdown -> many small
 *      pointermoves -> pointerup), exercising the PanResponder's
 *      `onMoveShouldSetPanResponder` (|dx| > 10) and
 *      `onPanResponderRelease` (dx > SWIPE_THRESHOLD) thresholds.
 *      The Apply action button is deliberately NOT clicked — clicking
 *      it would bypass the gesture entirely and hide regressions in
 *      the pan handler / pointer-event wiring.
 *   5. Confirm submission in the apply sheet.
 *   6. Assert via the API that the application now exists and was
 *      tagged with source="for_you".
 *
 * If the For-You feed is empty (a fresh DB with no jobs), the test
 * is skipped rather than failed — the swipe-to-apply path is the unit
 * under test, not the seed data.
 *
 * Requires `REPLIT_DEV_DOMAIN` and `REPLIT_EXPO_DEV_DOMAIN` (or
 * `E2E_API_BASE_URL` / `E2E_BASE_URL`) to be set so the test can reach
 * both the API and the Expo web preview over HTTPS — the session
 * cookie is `Secure`, so plain-HTTP localhost calls won't preserve it.
 */

function unique(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function apiBaseURL(): string {
  if (process.env.E2E_API_BASE_URL) return process.env.E2E_API_BASE_URL;
  if (process.env.REPLIT_DEV_DOMAIN)
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "http://localhost:80";
}

async function registerCandidate(
  ctx: APIRequestContext,
  email: string,
  password: string,
  fullName: string,
) {
  const res = await ctx.post("/api/auth/register", {
    data: { email, password, role: "candidate", fullName },
  });
  expect(res.status(), `register ${email}`).toBe(201);
}

async function listApplications(
  ctx: APIRequestContext,
): Promise<
  Array<{ id: number; jobId: number; candidateId: number; source: string }>
> {
  const res = await ctx.get("/api/applications");
  expect(res.status(), "list applications").toBe(200);
  return (await res.json()) as Array<{
    id: number;
    jobId: number;
    candidateId: number;
    source: string;
  }>;
}

async function feedJobIds(ctx: APIRequestContext): Promise<number[]> {
  const res = await ctx.get("/api/me/feed");
  expect(res.status(), "feed").toBe(200);
  const body = (await res.json()) as { items: Array<{ jobId: number }> };
  return body.items.map((i) => i.jobId);
}

async function fillByPlaceholder(
  page: Page,
  placeholder: RegExp,
  value: string,
) {
  // RN-Web renders TextInput as <input placeholder="...">.  Use a
  // case-insensitive RegExp to avoid brittleness if marketing copy
  // tweaks the placeholders.
  await page.getByPlaceholder(placeholder).first().fill(value);
}

test.describe.configure({ mode: "serial" });

test.describe("Mobile For-You swipe-to-apply", () => {
  let candidate: {
    email: string;
    password: string;
    candidateId: number;
  };

  test.beforeAll(async () => {
    const tag = unique();
    candidate = {
      email: `e2e-foryou-${tag}@example.com`,
      password: "ForYouPass123!",
      candidateId: 0,
    };

    const api = await request.newContext({ baseURL: apiBaseURL() });
    await registerCandidate(
      api,
      candidate.email,
      candidate.password,
      `E2E ForYou ${tag}`,
    );

    // Confirm we can actually log in via the API path before driving
    // the UI — surfaces seed/env problems with a clearer message than
    // a Playwright selector timeout would.
    const loginRes = await api.post("/api/auth/login", {
      data: { email: candidate.email, password: candidate.password },
    });
    expect(loginRes.status(), "candidate API login").toBe(200);
    const loginBody = (await loginRes.json()) as {
      user: { candidateId: number | null };
    };
    expect(loginBody.user.candidateId, "linked candidateId").toBeTruthy();
    candidate.candidateId = loginBody.user.candidateId!;

    const ids = await feedJobIds(api);
    test.skip(
      ids.length === 0,
      "No jobs available in the For-You feed — seed the DB before running this test",
    );

    await api.dispose();
  });

  test("right-swipe submits an application tagged 'for_you'", async ({
    page,
  }) => {
    // ---- Sign in on the mobile web preview ----------------------------
    await page.goto("/");
    // AuthGate redirects unauthenticated users to /sign-in inside the
    // (auth) route group.  Wait for either the sign-in screen or the
    // tabs to settle.
    await page.waitForLoadState("networkidle");

    // The sign-in screen renders an email Field and a password Field
    // (placeholders "Email" / "Password") plus a "Sign in" button.
    await fillByPlaceholder(page, /^email$/i, candidate.email);
    await fillByPlaceholder(page, /^password$/i, candidate.password);
    await page.getByText(/^sign in$/i).first().click();

    // After login AuthGate routes into (tabs); the For-You tab header
    // shows the literal "For You" title.  Wait for it instead of
    // racing the navigation.
    await expect(page.getByText("For You").first()).toBeVisible({
      timeout: 30_000,
    });

    // ---- Trigger a real right-swipe on the top card -------------------
    // We dispatch a PointerEvent sequence directly on the element under
    // the card's start point.  This is the unit under test: a regression
    // in the PanResponder (threshold tweak, drag-handler bug, pointer
    // event wiring change in RN-Web) will fail this step even though a
    // synthetic "click the Apply button" would still pass.  Empirically,
    // Playwright's `page.mouse.*` doesn't reliably reach RN-Web's
    // responder system on the Expo web preview — direct PointerEvent
    // dispatch does.
    //
    // The numbers below are derived from the production thresholds in
    // foryou.tsx: onMoveShouldSetPanResponder fires when |dx| > 10 AND
    // |dx| > |dy|; onPanResponderRelease treats dx > SWIPE_THRESHOLD
    // (0.28 * window width) as a right swipe.  We start at 20% width
    // and end at 95% width, which is well beyond the threshold for
    // any reasonable mobile viewport.
    const viewport = page.viewportSize();
    expect(viewport, "viewport must be set").not.toBeNull();
    const startX = Math.round(viewport!.width * 0.2);
    const endX = Math.round(viewport!.width * 0.95);
    const midY = Math.round(viewport!.height * 0.45);

    await page.evaluate(
      async ({ x0, x1, y }) => {
        const target = document.elementFromPoint(x0, y);
        if (!target) {
          throw new Error(`no element under swipe start point (${x0}, ${y})`);
        }
        const fire = (type: string, x: number) => {
          const ev = new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerType: "mouse",
            pointerId: 1,
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: x,
            clientY: y,
          });
          target.dispatchEvent(ev);
        };
        fire("pointerdown", x0);
        const steps = 25;
        for (let i = 1; i <= steps; i++) {
          const x = x0 + ((x1 - x0) * i) / steps;
          fire("pointermove", x);
          await new Promise((r) => setTimeout(r, 8));
        }
        fire("pointerup", x1);
      },
      { x0: startX, x1: endX, y: midY },
    );

    // ---- Confirm in the apply sheet -----------------------------------
    const sendButton = page.getByText(/send application/i).first();
    await expect(sendButton).toBeVisible({ timeout: 15_000 });
    await sendButton.click();

    // The sheet closes (onSubmitted -> setConfirmJobId(null)) and we
    // remain on the For-You screen.  Give the POST a moment to land.
    await expect(sendButton).toBeHidden({ timeout: 15_000 });

    // ---- Verify the application exists with source="for_you" ----------
    // Re-auth via API to read /api/applications from the candidate's
    // perspective.  The endpoint scopes to the caller's candidateId
    // for non-admins.
    const api = await request.newContext({ baseURL: apiBaseURL() });
    const loginRes = await api.post("/api/auth/login", {
      data: { email: candidate.email, password: candidate.password },
    });
    expect(loginRes.status()).toBe(200);

    // Poll briefly — the UI close + the DB write are independent.
    await expect
      .poll(
        async () => {
          const apps = await listApplications(api);
          return apps.some(
            (a) =>
              a.candidateId === candidate.candidateId && a.source === "for_you",
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    await api.dispose();
  });
});
