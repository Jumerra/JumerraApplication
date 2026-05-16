import {
  test,
  expect,
  request,
  type APIRequestContext,
} from "@playwright/test";

const ADMIN = { email: "admin@talentlink.com", password: "admin123" };

const DEFAULTS = {
  promotedActive: true,
  promotedPriceCents: 2900,
  promotedCurrency: "usd",
  promotedDurationDays: 30,
  sponsoredActive: true,
  sponsoredPriceCents: 9900,
  sponsoredCurrency: "usd",
  sponsoredDurationDays: 30,
  sponsoredPushCap: 200,
};

function unique() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function loginApi(
  ctx: APIRequestContext,
  email: string,
  password: string,
) {
  const res = await ctx.post("/api/auth/login", {
    data: { email, password },
  });
  expect(res.status(), `login ${email}`).toBe(200);
  return (await res.json()) as { user: { id: number; employerId: number | null } };
}

async function adminContext(baseURL: string) {
  const ctx = await request.newContext({ baseURL });
  await loginApi(ctx, ADMIN.email, ADMIN.password);
  return ctx;
}

/**
 * Onboard a new user via the admin onboard route, then complete the
 * setup-password flow with a known password. Email delivery is stubbed
 * in dev so the response carries the setupUrl, from which we extract
 * the token.
 */
async function onboardAndActivate(opts: {
  admin: APIRequestContext;
  baseURL: string;
  role: "employer" | "institution";
  email: string;
  fullName: string;
  password: string;
  entity: Record<string, unknown>;
}): Promise<{ userId: number; employerId?: number }> {
  const onboardRes = await opts.admin.post("/api/admin/onboard", {
    data: {
      role: opts.role,
      email: opts.email,
      fullName: opts.fullName,
      entity: opts.entity,
    },
  });
  expect(onboardRes.status(), `onboard ${opts.email}`).toBe(201);
  const onboardJson = (await onboardRes.json()) as {
    user: { id: number };
    setupUrl: string | null;
  };
  expect(
    onboardJson.setupUrl,
    "setupUrl should be returned when email is not configured",
  ).toBeTruthy();
  const token = new URL(onboardJson.setupUrl!, opts.baseURL).searchParams.get(
    "token",
  );
  expect(token).toBeTruthy();
  const setupCtx = await request.newContext({ baseURL: opts.baseURL });
  const setupRes = await setupCtx.post("/api/auth/setup-password", {
    data: { token, password: opts.password },
  });
  expect(setupRes.status(), "setup-password").toBe(200);
  const me = await setupCtx.get("/api/auth/me");
  const meJson = (await me.json()) as {
    user: { id: number; employerId: number | null } | null;
  };
  await setupCtx.dispose();
  return {
    userId: onboardJson.user.id,
    employerId: meJson.user?.employerId ?? undefined,
  };
}

let owner: {
  email: string;
  password: string;
  userId: number;
  employerId: number;
};
// "viewer" is a real same-employer non-owner: invited by the owner via
// POST /api/staff/invite with orgRole="viewer", so they share
// employerId with `owner` but their orgRole is NOT "owner". The
// promote/checkout authz check (`isAdmin || isOwnerEmployer`) must
// then deny them.
let viewer: { email: string; password: string; userId: number };

test.describe.configure({ mode: "serial" });

test.describe("Per-job tier flows", () => {
  test.beforeAll(async ({ baseURL }) => {
    expect(baseURL).toBeTruthy();
    const admin = await adminContext(baseURL!);

    const tag = unique();
    const orgName = `E2E Employer ${tag}`;
    owner = {
      email: `e2e-owner-${tag}@example.com`,
      password: "OwnerPass123!",
      userId: 0,
      employerId: 0,
    };
    viewer = {
      email: `e2e-viewer-${tag}@example.com`,
      password: "ViewerPass123!",
      userId: 0,
    };

    const ownerOnboard = await onboardAndActivate({
      admin,
      baseURL: baseURL!,
      role: "employer",
      email: owner.email,
      fullName: `E2E Owner ${tag}`,
      password: owner.password,
      entity: { name: orgName, industry: "Technology", location: "Remote" },
    });
    owner.userId = ownerOnboard.userId;
    expect(ownerOnboard.employerId, "owner should have employerId").toBeTruthy();
    owner.employerId = ownerOnboard.employerId!;

    // Owner invites a teammate to the SAME employer with orgRole="viewer".
    // Then we activate that invited user via the setup-password flow so
    // they have a real password we can sign in with.
    const ownerCtx = await request.newContext({ baseURL });
    await loginApi(ownerCtx, owner.email, owner.password);
    const inviteRes = await ownerCtx.post("/api/staff/invite", {
      data: {
        email: viewer.email,
        fullName: `E2E Viewer ${tag}`,
        orgRole: "viewer",
      },
    });
    expect(inviteRes.status(), "staff invite").toBe(201);
    const inviteJson = (await inviteRes.json()) as {
      user: { id: number };
      setupUrl: string | null;
    };
    expect(inviteJson.setupUrl, "setupUrl returned in dev").toBeTruthy();
    viewer.userId = inviteJson.user.id;
    const inviteToken = new URL(
      inviteJson.setupUrl!,
      baseURL,
    ).searchParams.get("token");
    expect(inviteToken).toBeTruthy();
    const setupCtx = await request.newContext({ baseURL });
    const setupRes = await setupCtx.post("/api/auth/setup-password", {
      data: { token: inviteToken, password: viewer.password },
    });
    expect(setupRes.status(), "viewer setup-password").toBe(200);
    await setupCtx.dispose();
    await ownerCtx.dispose();
    await admin.dispose();
  });

  test("Scenario 1 — free job posting appears immediately", async ({
    page,
    baseURL,
  }) => {
    const tag = unique();
    const title = `Free Tier Test ${tag}`;

    await page.goto("/login");
    await page.locator("#email").fill(owner.email);
    await page.locator("#password").fill(owner.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login$/);

    await page.goto("/post-job");
    await expect(page.locator('[data-testid="tier-card-free"]')).toBeVisible();

    await page.getByLabel(/job title/i).fill(title);
    await page.getByLabel(/location/i).fill("Test City");
    await page.getByLabel(/skills/i).fill("TestSkillFree");
    await page.getByLabel(/short summary/i).fill("Summary for free tier test");
    await page
      .getByLabel(/full description/i)
      .fill("Description for free tier integration test - posting should be immediate.");
    await page.getByLabel(/responsibilities/i).fill("Do the work");
    await page.getByLabel(/requirements/i).fill("Be available");
    await page.getByLabel(/benefits/i).fill("Coffee");

    await page.locator('[data-testid="button-submit-job"]').click();
    await expect(page).toHaveURL(/\/dashboard\/employer/, { timeout: 15_000 });

    const api = await request.newContext({ baseURL });
    const list = await api.get("/api/jobs");
    expect(list.status()).toBe(200);
    const jobs = (await list.json()) as Array<{
      id: number;
      title: string;
      tier: string;
      tierExpiresAt: string | null;
      employerId: number;
    }>;
    const created = jobs.find((j) => j.title === title);
    expect(created, `job titled ${title}`).toBeTruthy();
    expect(created!.tier).toBe("free");
    expect(created!.tierExpiresAt).toBeNull();
    expect(created!.employerId).toBe(owner.employerId);

    await page.goto(`/jobs/${created!.id}`);
    await expect(page.getByText(title)).toBeVisible();
    await api.dispose();
  });

  test("Scenario 2 — non-owner employer member checkout returns 403", async ({
    baseURL,
  }) => {
    // Find any job belonging to the owner's employer (created in Scenario 1).
    const ownerCtx = await request.newContext({ baseURL });
    await loginApi(ownerCtx, owner.email, owner.password);
    const list = await ownerCtx.get("/api/jobs");
    const jobs = (await list.json()) as Array<{
      id: number;
      employerId: number;
    }>;
    const target = jobs.find((j) => j.employerId === owner.employerId);
    expect(
      target,
      `expected at least one job for employer ${owner.employerId}`,
    ).toBeTruthy();
    await ownerCtx.dispose();

    const viewerCtx = await request.newContext({ baseURL });
    const viewerLogin = await loginApi(viewerCtx, viewer.email, viewer.password);
    // Sanity: confirm the viewer is on the SAME employer as the owner
    // (this is what makes the test exercise owner-vs-member, not
    // cross-tenant denial).
    expect(viewerLogin.user.employerId).toBe(owner.employerId);
    const res = await viewerCtx.post(
      `/api/jobs/${target!.id}/promote/checkout`,
      {
        data: {
          tier: "promoted",
          successUrl: "https://example.com/ok",
          cancelUrl: "https://example.com/cancel",
        },
      },
    );
    expect(res.status()).toBe(403);
    const body = await res.text();
    expect(body).toContain(
      "Only employer owners or platform admins can boost a job",
    );
    await viewerCtx.dispose();
  });

  test("Scenario 3 — admin tier price update reflected in posting flow", async ({
    page,
    baseURL,
  }) => {
    const adminCtx = await adminContext(baseURL!);
    try {
      await page.goto("/login");
      await page.locator("#email").fill(ADMIN.email);
      await page.locator("#password").fill(ADMIN.password);
      await page.getByRole("button", { name: /sign in/i }).click();
      await expect(page).not.toHaveURL(/\/login$/);

      await page.goto("/dashboard/admin/job-tier-settings");
      const priceInput = page.locator('[data-testid="input-promoted-price"]');
      const durationInput = page.locator(
        '[data-testid="input-promoted-duration"]',
      );
      await expect(priceInput).toBeVisible();
      await priceInput.fill("47.00");
      await durationInput.fill("21");
      await page
        .locator('[data-testid="button-save-job-tier-settings"]')
        .click();

      await expect
        .poll(
          async () => {
            const r = await adminCtx.get("/api/job-tier-settings");
            const j = (await r.json()) as {
              promotedPriceCents: number;
              promotedDurationDays: number;
            };
            return (
              j.promotedPriceCents === 4700 && j.promotedDurationDays === 21
            );
          },
          { timeout: 10_000 },
        )
        .toBe(true);

      const ownerCtx = await page.context().browser()!.newContext({
        baseURL,
      });
      const op = await ownerCtx.newPage();
      await op.goto("/login");
      await op.locator("#email").fill(owner.email);
      await op.locator("#password").fill(owner.password);
      await op.getByRole("button", { name: /sign in/i }).click();
      await expect(op).not.toHaveURL(/\/login$/);
      await op.goto("/post-job");
      const promotedCard = op.locator('[data-testid="tier-card-promoted"]');
      await expect(promotedCard).toContainText("47");
      await expect(promotedCard).toContainText("21 days");
      await ownerCtx.close();
    } finally {
      const restore = await adminCtx.put("/api/admin/job-tier-settings", {
        data: DEFAULTS,
      });
      expect(restore.status()).toBe(200);
      await adminCtx.dispose();
    }
  });
});
