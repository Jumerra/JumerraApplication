import {
  test,
  expect,
  request,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * End-to-end regression test for the mobile For-You swipe-to-skip
 * (left-swipe) flow.  Sibling of swipe-to-apply.spec.ts.  Mirrors the
 * user journey:
 *
 *   1. Self-register a fresh candidate via /api/auth/register.
 *   2. Sign in via the mobile web UI sign-in screen.
 *   3. Navigate into the For-You tab.
 *   4. Capture the currently-visible jobId by reading /api/me/feed
 *      from the API side (the feed order is deterministic for a given
 *      candidate snapshot, and the UI shows the top item first).
 *   5. Tap the "Skip" action button (accessibilityLabel="Skip"),
 *      which triggers `onSwipeLeft` -> POST /api/me/feed/dismiss +
 *      `advance()` to move past the card.
 *   6. Assert via the API that:
 *        (a) the dismissed jobId no longer appears in /api/me/feed,
 *            i.e. dismissal was persisted server-side, and
 *        (b) the visible card on screen advanced to a different job.
 *
 * If the For-You feed has fewer than 2 jobs we still validate (a) but
 * skip the "advanced to different jobId" half — there's no second card
 * to advance to.  If the feed is empty we skip entirely.
 *
 * The Skip button (rather than a synthesized left-swipe gesture) is
 * tapped here because the swipe-to-apply spec already covers the
 * PanResponder pointer-event wiring for the symmetric path; what is
 * specific to skip and worth guarding is the dismiss endpoint + deck
 * advance behaviour.
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
  await page.getByPlaceholder(placeholder).first().fill(value);
}

test.describe.configure({ mode: "serial" });

test.describe("Mobile For-You swipe-to-skip", () => {
  let candidate: {
    email: string;
    password: string;
    candidateId: number;
  };
  let initialFeed: number[] = [];

  test.beforeAll(async () => {
    const tag = unique();
    candidate = {
      email: `e2e-skip-${tag}@example.com`,
      password: "SkipPass123!",
      candidateId: 0,
    };

    const api = await request.newContext({ baseURL: apiBaseURL() });
    await registerCandidate(
      api,
      candidate.email,
      candidate.password,
      `E2E Skip ${tag}`,
    );

    const loginRes = await api.post("/api/auth/login", {
      data: { email: candidate.email, password: candidate.password },
    });
    expect(loginRes.status(), "candidate API login").toBe(200);
    const loginBody = (await loginRes.json()) as {
      user: { candidateId: number | null };
    };
    expect(loginBody.user.candidateId, "linked candidateId").toBeTruthy();
    candidate.candidateId = loginBody.user.candidateId!;

    initialFeed = await feedJobIds(api);
    test.skip(
      initialFeed.length === 0,
      "No jobs available in the For-You feed — seed the DB before running this test",
    );

    await api.dispose();
  });

  test("left-swipe / Skip persists dismissal and advances the deck", async ({
    page,
  }) => {
    // ---- Sign in on the mobile web preview ----------------------------
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await fillByPlaceholder(page, /^email$/i, candidate.email);
    await fillByPlaceholder(page, /^password$/i, candidate.password);
    await page.getByText(/^sign in$/i).first().click();

    await expect(page.getByText("For You").first()).toBeVisible({
      timeout: 30_000,
    });

    // The top card in the deck corresponds to the first item in
    // /api/me/feed.  Snapshot the jobId AND the rendered title so we
    // can verify the deck advances past it and the server persisted
    // the dismissal.
    const topJobId = initialFeed[0];
    expect(topJobId, "top jobId").toBeTruthy();

    // Pull the title from the candidate's POV so we can locate the
    // current top card in the DOM by text.
    const apiPre = await request.newContext({ baseURL: apiBaseURL() });
    await apiPre.post("/api/auth/login", {
      data: { email: candidate.email, password: candidate.password },
    });
    const preFeedRes = await apiPre.get("/api/me/feed");
    expect(preFeedRes.status()).toBe(200);
    const preFeed = (await preFeedRes.json()) as {
      items: Array<{ jobId: number; title: string }>;
    };
    await apiPre.dispose();
    const topTitle = preFeed.items[0]?.title;
    expect(topTitle, "top card title").toBeTruthy();

    // The header renders a deterministic "N match(es) left" counter
    // that decrements on each advance().  This is the strongest UI
    // signal that the deck moved forward, independent of which card
    // happens to be rendered in the DOM (current + cardBehind are
    // both present in the DOM at any given time).
    const remainingBefore = Math.max(preFeed.items.length, 0);
    const beforeCounter = new RegExp(
      `${remainingBefore} match${remainingBefore === 1 ? "" : "es"} left`,
      "i",
    );
    await expect(page.getByText(beforeCounter).first()).toBeVisible({
      timeout: 15_000,
    });

    // ---- Tap the Skip action button -----------------------------------
    // The button is rendered as a Pressable with accessibilityLabel
    // "Skip", which RN-Web maps to aria-label on the underlying div.
    const skipBtn = page.getByLabel("Skip").first();
    await expect(skipBtn).toBeVisible({ timeout: 15_000 });
    await skipBtn.click();

    // ---- Verify server-side dismissal persisted ------------------------
    const api = await request.newContext({ baseURL: apiBaseURL() });
    const loginRes = await api.post("/api/auth/login", {
      data: { email: candidate.email, password: candidate.password },
    });
    expect(loginRes.status()).toBe(200);

    // Poll briefly — Skip dispatches dismiss() async (fire-and-forget
    // from the UI's perspective) plus the 220ms exit animation.
    await expect
      .poll(
        async () => {
          const ids = await feedJobIds(api);
          return ids.includes(topJobId);
        },
        { timeout: 15_000 },
      )
      .toBe(false);

    await api.dispose();

    // ---- Verify the visible card advanced (when a 2nd card exists) ----
    // The deck has at most one card visible at a time; after `advance()`
    // we expect either:
    //   - the next jobId from the initial feed to be visible, or
    //   - the "You're all caught up" empty state (only if the candidate
    //     had a single match).
    if (initialFeed.length >= 2) {
      // The deck advanced if and only if the "N matches left" header
      // counter decremented by exactly one.  This is the strongest
      // available UI proof because:
      //   - the counter is computed from `items.length - index`, so
      //     a regression that no-ops `advance()` leaves it unchanged,
      //   - it is not part of the card body (no occlusion / cardBehind
      //     ambiguity), and
      //   - it cannot be satisfied by the next card being pre-rendered
      //     in the background.
      const remainingAfter = remainingBefore - 1;
      const afterCounter = new RegExp(
        `${remainingAfter} match${remainingAfter === 1 ? "" : "es"} left`,
        "i",
      );
      await expect(page.getByText(afterCounter).first()).toBeVisible({
        timeout: 15_000,
      });
      // And the previously-current card title must no longer be on
      // screen — both `current` and the (now-stale) `cardBehind`
      // slots have rotated past it.
      await expect(page.getByText(topTitle!)).toHaveCount(0, {
        timeout: 15_000,
      });
    } else {
      // Only one card existed — assert the empty state appeared.
      await expect(
        page.getByText(/you're all caught up/i).first(),
      ).toBeVisible({ timeout: 15_000 });
    }
  });
});
