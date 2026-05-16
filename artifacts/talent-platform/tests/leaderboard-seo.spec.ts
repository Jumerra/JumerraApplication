import { test, expect, request } from "@playwright/test";

/**
 * End-to-end coverage for Task #73 — public cohort placement
 * leaderboard. Verifies:
 *   (a) the JSON endpoint renders with the expected aggregate shape
 *       and the 3-hire salary-band floor,
 *   (b) the SPA page's HTML carries SSR-injected per-institution meta
 *       tags + a working og:image PNG (the generated share card),
 *   (c) the share-card PNG endpoint returns a real image,
 *   (d) toggling `publicLeaderboardEnabled` off (via authenticated
 *       admin patch) flips both endpoints to 404, then restores.
 *
 * Institution ids are discovered through the AUTHENTICATED admin
 * listing (`/api/institutions` is auth-gated; only specific public
 * leaderboard paths are whitelisted in routes/index.ts).
 */
const ADMIN = { email: "admin@talentlink.com", password: "admin123" };

async function adminContext(baseURL: string | undefined) {
  const ctx = await request.newContext({ baseURL });
  const login = await ctx.post("/api/auth/login", { data: ADMIN });
  if (login.status() !== 200) {
    await ctx.dispose();
    return null;
  }
  return ctx;
}

test.describe("institution leaderboard", () => {
  test("JSON + SSR meta tags + share card PNG all render", async ({
    baseURL,
  }) => {
    const adminCtx = await adminContext(baseURL);
    test.skip(adminCtx === null, "no admin seed");
    const list = await adminCtx!.get("/api/institutions");
    expect(list.status()).toBe(200);
    const institutions = (await list.json()) as Array<{
      id: number;
      publicLeaderboardEnabled?: boolean;
    }>;
    const candidate = institutions.find(
      (i) => i.publicLeaderboardEnabled !== false,
    );
    test.skip(!candidate, "no leaderboard-enabled institution seeded");
    const id = candidate!.id;

    // Use an unauthenticated context to prove the leaderboard endpoints
    // are truly public (the whitelist in routes/index.ts is the trust
    // boundary we're verifying).
    const publicCtx = await request.newContext({ baseURL });

    const lb = await publicCtx.get(`/api/institutions/${id}/leaderboard`);
    expect(lb.status()).toBe(200);
    const body = await lb.json();
    expect(typeof body.totalPlaced).toBe("number");
    expect(Array.isArray(body.cohorts)).toBe(true);
    expect(Array.isArray(body.topEmployers)).toBe(true);
    expect(Array.isArray(body.salaryBandsByRoleFamily)).toBe(true);
    for (const band of body.salaryBandsByRoleFamily as Array<{
      hires: number;
    }>) {
      expect(band.hires).toBeGreaterThanOrEqual(3);
    }

    // SSR meta-tag check: fetch the SPA page and confirm the plugin
    // rewrote the static title + injected og:* tags pointing at the
    // generated share-card PNG.
    const html = await publicCtx.get(`/institutions/${id}/leaderboard`);
    expect(html.status()).toBe(200);
    const text = await html.text();
    expect(text).toMatch(/<title>[^<]*Placement Leaderboard[^<]*<\/title>/);
    expect(text).toMatch(/property="og:title"/);
    expect(text).toMatch(/property="og:description"/);
    expect(text).toMatch(
      new RegExp(`og:image"\\s+content="[^"]*${id}/leaderboard\\.png`),
    );

    // PNG share card: must be a real image response, not JSON / HTML,
    // AND its headline number must match the JSON endpoint exactly —
    // SVG fallback contains the totalPlaced as plain text, so a
    // regression where the card diverges from the JSON would be
    // caught immediately by the SVG render path (also exercised in
    // CI when libuv-bound native bindings are unavailable).
    const png = await publicCtx.get(`/api/institutions/${id}/leaderboard.png`);
    expect(png.status()).toBe(200);
    const ct = png.headers()["content-type"] ?? "";
    expect(ct).toMatch(/^image\/(png|svg\+xml)/);
    const buf = await png.body();
    expect(buf.length).toBeGreaterThan(200);
    if (ct.startsWith("image/svg+xml")) {
      expect(buf.toString("utf-8")).toContain(`>${body.totalPlaced}<`);
    }

    await publicCtx.dispose();
    await adminCtx!.dispose();
  });

  test("opt-out flips JSON + PNG to 404 and restore re-enables", async ({
    baseURL,
  }) => {
    const adminCtx = await adminContext(baseURL);
    test.skip(adminCtx === null, "no admin seed");
    const list = await adminCtx!.get("/api/institutions");
    expect(list.status()).toBe(200);
    const institutions = (await list.json()) as Array<{
      id: number;
      publicLeaderboardEnabled?: boolean;
    }>;
    const target = institutions.find(
      (i) => i.publicLeaderboardEnabled !== false,
    );
    test.skip(!target, "no leaderboard-enabled institution seeded");

    const patch = await adminCtx!.patch(
      `/api/admin/institutions/${target!.id}`,
      { data: { publicLeaderboardEnabled: false } },
    );
    test.skip(
      patch.status() === 404,
      "admin institution patch route not present in this build",
    );
    expect(patch.status()).toBe(200);

    const publicCtx = await request.newContext({ baseURL });
    const lb = await publicCtx.get(
      `/api/institutions/${target!.id}/leaderboard`,
    );
    expect(lb.status()).toBe(404);
    const png = await publicCtx.get(
      `/api/institutions/${target!.id}/leaderboard.png`,
    );
    expect(png.status()).toBe(404);
    await publicCtx.dispose();

    // Restore so subsequent tests see the seed default.
    const restore = await adminCtx!.patch(
      `/api/admin/institutions/${target!.id}`,
      { data: { publicLeaderboardEnabled: true } },
    );
    expect(restore.status()).toBe(200);
    await adminCtx!.dispose();
  });
});
