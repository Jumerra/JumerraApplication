import { test, expect } from "@playwright/test";
import { RUN_TAG } from "../helpers/env";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../helpers/constants";
import { login, ok } from "../helpers/api";
import { findUserByEmail } from "../helpers/db-helpers";

/**
 * Journey 2: Employer registration -> admin approval -> post job ->
 *            review applications -> mark a hire.
 */
test("employer registers, gets approved, posts a job, reviews and hires", async ({
  playwright,
}) => {
  const baseURL = process.env.E2E_API_URL ?? "http://127.0.0.1:8090";
  const tag = `${RUN_TAG}-emp`;
  const ownerEmail = `emp-${tag}@jumerra.test`;
  const ownerPassword = "EmpOwnerPass1!";
  const candidateEmail = `cand-${tag}@jumerra.test`;
  const candidatePassword = "CandPass1234!";
  const companyName = `EmployerJourneyCo ${tag}`;
  const jobTitle = `Engineer ${tag}`;

  // 1. Employer self-registers (pending admin review)
  const pubCtx = await playwright.request.newContext({ baseURL });
  const regRes = await pubCtx.post("/api/auth/register", {
    data: {
      email: ownerEmail,
      password: ownerPassword,
      role: "employer",
      fullName: `EmpOwner ${tag}`,
      submittedData: { companyName, industry: "Software" },
    },
  });
  expect(regRes.status()).toBe(201);

  // Owner cannot login yet (status=pending) — login should fail.
  const earlyLogin = await pubCtx.post("/api/auth/login", {
    data: { email: ownerEmail, password: ownerPassword },
  });
  expect(earlyLogin.ok()).toBe(false);

  // 2. Admin approves
  const adminCtx = await playwright.request.newContext({ baseURL });
  await login(adminCtx, ADMIN_EMAIL, ADMIN_PASSWORD);
  const ownerUser = await findUserByEmail(ownerEmail);
  expect(ownerUser).not.toBeNull();
  const regs = await adminCtx
    .get(`/api/admin/registrations?status=pending`)
    .then((r) => r.json());
  const regRow = (regs.registrations ?? [])
    .find((r: { userId: number }) => r.userId === ownerUser!.id);
  expect(regRow).toBeDefined();
  const regRowId = regRow.registrationId ?? regRow.id;
  await ok(
    await adminCtx.post(`/api/admin/registrations/${regRowId}/approve`, {
      data: {},
    }),
    "approve",
  );

  // 3. Owner can now login + post a job
  const ownerCtx = await playwright.request.newContext({ baseURL });
  await login(ownerCtx, ownerEmail, ownerPassword);
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
        salaryMin: 60_000,
        salaryMax: 90_000,
        currency: "USD",
        summary: "Engineer needed.",
        description: "We need an engineer.",
        responsibilities: ["Build"],
        requirements: ["TypeScript"],
        benefits: ["Remote"],
        skills: ["TypeScript"],
        includeChallenge: false,
      },
    }),
    "create job",
  )) as { id: number };
  expect(job.id).toBeGreaterThan(0);

  // 4. Seed a candidate who applies
  const candCtx = await playwright.request.newContext({ baseURL });
  await pubCtx.post("/api/auth/register", {
    data: {
      email: candidateEmail,
      password: candidatePassword,
      role: "candidate",
      fullName: `EmpCand ${tag}`,
    },
  });
  await login(candCtx, candidateEmail, candidatePassword);
  const meBody = (await ok(await candCtx.get("/api/auth/me"), "me")) as {
    user: { candidateId: number };
  };
  const appCreated = (await ok(
    await candCtx.post("/api/applications", {
      data: { jobId: job.id, coverNote: "I want this." },
    }),
    "apply",
  )) as { id: number };

  // 5. Owner reviews applications and marks the hire
  const apps = (await ok(
    await ownerCtx.get(`/api/applications?jobId=${job.id}`),
    "list job applications",
  )) as Array<{ id: number; candidateId: number; status: string }>;
  expect(
    apps.some(
      (a) =>
        a.id === appCreated.id && a.candidateId === meBody.user.candidateId,
    ),
  ).toBe(true);

  const hired = (await ok(
    await ownerCtx.patch(`/api/applications/${appCreated.id}`, {
      data: { status: "hired" },
    }),
    "mark hire",
  )) as { id: number; status: string };
  expect(String(hired.status).toLowerCase()).toBe("hired");

  await pubCtx.dispose();
  await adminCtx.dispose();
  await ownerCtx.dispose();
  await candCtx.dispose();
});
