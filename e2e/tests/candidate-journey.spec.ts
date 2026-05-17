import { test, expect, request as playwrightRequest } from "@playwright/test";
import { RUN_TAG } from "../helpers/env";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../helpers/constants";
import { login, ok } from "../helpers/api";
import {
  findUserByEmail,
  getCandidateById,
} from "../helpers/db-helpers";

/**
 * Journey 1: Candidate sign-up -> profile fill -> apply to a job.
 *
 * NOTE on email confirmation: the product does NOT require email
 * confirmation for candidates. Candidates self-onboard, are stamped
 * `status = 'active'` immediately by `POST /auth/register`, and the
 * same response sets the session cookie so they're logged in on the
 * spot (`artifacts/api-server/src/routes/auth.ts`, candidate branch).
 * Employer/institution sign-ups are gated by admin approval instead
 * of email confirmation — that gate is exercised by the employer and
 * institution journey specs. If a future product change introduces
 * candidate email verification, this spec must be extended to drive
 * the token-redemption step before login.
 *
 * Steps:
 *   1. POST /auth/register  — creates user + linked candidate row
 *   2. POST /auth/login     — establishes a session cookie
 *   3. GET  /auth/me        — confirms identity
 *   4. PATCH /candidates/:id (profile fill)
 *   5. (Admin pre-seeds an employer + job so the candidate has something
 *       to apply to. We use the platform admin to do the seeding via
 *       the API rather than a raw DB insert so the test exercises the
 *       same authorization paths as production.)
 *   6. POST /applications   — submits the application
 *   7. GET  /applications   — candidate sees their application
 */
test("candidate signs up, fills profile, and applies to a job", async ({ playwright }) => {
  const tag = `${RUN_TAG}-cand`;
  const candidateEmail = `cand-${tag}@jumerra.test`;
  const candidatePassword = "CandidatePass123!";
  const jobTitle = `Junior Dev ${tag}`;
  const employerName = `EmpCo ${tag}`;

  // --- Admin context: seed an employer + job for the candidate ---
  const adminCtx = await playwright.request.newContext({
    baseURL: process.env.E2E_API_URL ?? "http://127.0.0.1:8090",
  });
  await login(adminCtx, ADMIN_EMAIL, ADMIN_PASSWORD);

  // Register employer (admin route auto-creates approved employer).
  // The public /auth/register flow puts the employer in "pending" and
  // requires admin approval — we exercise that in the employer journey.
  // Here we cheat the seed by registering + approving in one go.
  const empRegRes = await adminCtx.post("/api/auth/register", {
    data: {
      email: `owner-${tag}@jumerra.test`,
      password: "OwnerPass1234!",
      role: "employer",
      fullName: `EmpOwner ${tag}`,
      submittedData: { companyName: employerName, industry: "Software" },
    },
  });
  expect(empRegRes.status()).toBeLessThan(300);

  const ownerUser = await findUserByEmail(`owner-${tag}@jumerra.test`);
  expect(ownerUser).not.toBeNull();

  // Approve as admin.
  const reg = await adminCtx
    .get(`/api/admin/registrations?status=pending`)
    .then((r) => r.json());
  const regRow = (reg.registrations ?? [])
    .find((r: { userId: number }) => r.userId === ownerUser!.id);
  const regRowId = regRow?.registrationId ?? regRow?.id;
  expect(regRow).toBeDefined();
  const approveRes = await adminCtx.post(
    `/api/admin/registrations/${regRowId}/approve`,
    { data: {} },
  );
  await ok(approveRes, "approve employer registration");

  // Owner logs in and posts a job.
  const ownerCtx = await playwright.request.newContext({
    baseURL: process.env.E2E_API_URL ?? "http://127.0.0.1:8090",
  });
  await login(ownerCtx, `owner-${tag}@jumerra.test`, "OwnerPass1234!");
  const ownerMe = (await ok(await ownerCtx.get("/api/auth/me"), "me")) as {
    user: { employerId: number };
  };
  const job = (await ok(
    await ownerCtx.post("/api/jobs", {
      data: {
        title: jobTitle,
        employerId: ownerMe.user.employerId,
        type: "full_time",
        location: "Remote",
        remote: true,
        salaryMin: 50_000,
        salaryMax: 80_000,
        currency: "USD",
        summary: "Engineer role.",
        description: "Build cool things.",
        responsibilities: ["Build"],
        requirements: ["TypeScript"],
        benefits: ["Remote"],
        skills: ["TypeScript", "React"],
        includeChallenge: false,
      },
    }),
    "create job",
  )) as { id: number };
  expect(job.id).toBeGreaterThan(0);

  // --- Candidate path ---
  const candCtx = await playwright.request.newContext({
    baseURL: process.env.E2E_API_URL ?? "http://127.0.0.1:8090",
  });

  // 1. Register
  const regRes = await candCtx.post("/api/auth/register", {
    data: {
      email: candidateEmail,
      password: candidatePassword,
      role: "candidate",
      fullName: `Cand ${tag}`,
    },
  });
  expect(regRes.status()).toBe(201);

  // 2. Login
  await login(candCtx, candidateEmail, candidatePassword);

  // 3. /auth/me confirms identity + candidate link
  const meBody = (await ok(await candCtx.get("/api/auth/me"), "me")) as {
    user: { id: number; role: string; candidateId: number };
  };
  expect(meBody.user).not.toBeNull();
  expect(meBody.user.role).toBe("candidate");
  expect(meBody.user.candidateId).toBeGreaterThan(0);
  const candidateId = meBody.user.candidateId;

  // 4. Profile fill
  const patchRes = await candCtx.patch(`/api/candidates/${candidateId}`, {
    data: {
      headline: "Aspiring TS dev",
      bio: "Looking for entry-level work",
      location: "Lagos",
      skills: ["TypeScript", "React", "Node.js"],
      yearsExperience: 1,
    },
  });
  await ok(patchRes, "patch candidate profile");
  const candRow = await getCandidateById(candidateId);
  expect(candRow?.skills).toContain("TypeScript");

  // 6. Apply
  const appRes = await candCtx.post("/api/applications", {
    data: { jobId: job.id, coverNote: "Excited to apply!" },
  });
  const created = (await ok(appRes, "submit application")) as {
    id: number;
    status: string;
  };
  expect(created.id).toBeGreaterThan(0);
  expect(["applied", "submitted", "pending"]).toContain(
    String(created.status).toLowerCase(),
  );

  // 7. Candidate sees their own application
  const listRes = await candCtx.get("/api/applications");
  const list = (await ok(listRes, "list applications")) as Array<{
    id: number;
    jobId: number;
  }>;
  expect(list.some((a) => a.id === created.id && a.jobId === job.id)).toBe(true);

  await candCtx.dispose();
  await ownerCtx.dispose();
  await adminCtx.dispose();
});
