import { test, expect } from "@playwright/test";
import { RUN_TAG } from "../helpers/env";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../helpers/constants";
import { login, ok } from "../helpers/api";
import {
  findUserByEmail,
  findLatestSetupTokenForUser,
  getAffiliation,
} from "../helpers/db-helpers";

/**
 * Journey 3: Institution owner registration -> admin approval ->
 *            invite staff -> staff sets password -> staff verifies
 *            a candidate's affiliation.
 */
test("institution registers, gets approved, invites staff, verifies a candidate", async ({
  playwright,
}) => {
  const baseURL = process.env.E2E_API_URL ?? "http://127.0.0.1:8090";
  const tag = `${RUN_TAG}-inst`;
  const ownerEmail = `inst-${tag}@jumerra.test`;
  const ownerPassword = "InstOwnerPass1!";
  const staffEmail = `staff-${tag}@jumerra.test`;
  const staffPassword = "StaffPass1234!";
  const candidateEmail = `instcand-${tag}@jumerra.test`;
  const candidatePassword = "InstCandPass1!";
  const institutionName = `Inst Journey U ${tag}`;

  // 1. Institution owner self-registers (pending)
  const pubCtx = await playwright.request.newContext({ baseURL });
  await ok(
    await pubCtx.post("/api/auth/register", {
      data: {
        email: ownerEmail,
        password: ownerPassword,
        role: "institution",
        fullName: `InstOwner ${tag}`,
        submittedData: {
          institutionName,
          type: "university",
          location: "Accra",
        },
      },
    }),
    "register institution",
  );

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
    "approve institution",
  );

  // 3. Owner logs in and invites a staff member (coordinator role,
  //    which has `students:verify` — sufficient to verify candidates
  //    without faculty/department scoping).
  const ownerCtx = await playwright.request.newContext({ baseURL });
  await login(ownerCtx, ownerEmail, ownerPassword);
  const ownerMe = (await ok(await ownerCtx.get("/api/auth/me"), "owner me")) as {
    user: { institutionId: number };
  };
  const institutionId = ownerMe.user.institutionId;
  expect(institutionId).toBeGreaterThan(0);

  const invite = (await ok(
    await ownerCtx.post("/api/staff/invite", {
      data: {
        email: staffEmail,
        fullName: `InstStaff ${tag}`,
        orgRole: "coordinator",
      },
    }),
    "invite staff",
  )) as { member: { id: number }; setupUrl: string | null };

  // 4. Staff sets password. Email is not configured in the e2e
  //    environment, so `setupUrl` is returned directly OR we read the
  //    token straight from the DB — whichever is available.
  const staffUser = await findUserByEmail(staffEmail);
  expect(staffUser).not.toBeNull();
  const tokenRow = await findLatestSetupTokenForUser(staffUser!.id);
  expect(tokenRow).not.toBeNull();

  const staffCtx = await playwright.request.newContext({ baseURL });
  await ok(
    await staffCtx.post("/api/auth/setup-password", {
      data: { token: tokenRow!.token, password: staffPassword },
    }),
    "staff setup-password",
  );

  // setup-password auto-logs the staff in; confirm.
  const staffMe = (await ok(await staffCtx.get("/api/auth/me"), "staff me")) as {
    user: { id: number; institutionId: number; orgRole: string };
  };
  expect(staffMe.user.id).toBe(staffUser!.id);
  expect(staffMe.user.institutionId).toBe(institutionId);
  expect(staffMe.user.orgRole).toBe("coordinator");

  // 5. Seed a candidate and link them to this institution (the
  //    candidate registers, then attaches the affiliation themselves).
  await ok(
    await pubCtx.post("/api/auth/register", {
      data: {
        email: candidateEmail,
        password: candidatePassword,
        role: "candidate",
        fullName: `InstCand ${tag}`,
      },
    }),
    "register candidate",
  );
  const candCtx = await playwright.request.newContext({ baseURL });
  await login(candCtx, candidateEmail, candidatePassword);
  const candMe = (await ok(await candCtx.get("/api/auth/me"), "cand me")) as {
    user: { candidateId: number };
  };
  const candidateId = candMe.user.candidateId;

  // Setting `institutionId` on the candidate row populates the
  // candidate_institutions junction via the PATCH side-effect (see
  // setCandidateInstitutionLinks in routes/candidates.ts).
  await ok(
    await candCtx.patch(`/api/candidates/${candidateId}`, {
      data: { institutionId },
    }),
    "candidate self-attaches affiliation",
  );

  // Pre-condition: affiliation exists, unverified.
  const before = await getAffiliation(candidateId, institutionId);
  expect(before).not.toBeNull();
  expect(before!.verifiedAt).toBeNull();

  // 6. Staff verifies the affiliation
  await ok(
    await staffCtx.post(
      `/api/institutions/${institutionId}/students/${candidateId}/verify`,
      { data: {} },
    ),
    "verify affiliation",
  );
  const after = await getAffiliation(candidateId, institutionId);
  expect(after!.verifiedAt).not.toBeNull();
  expect(after!.verifiedBy).toBe(staffUser!.id);

  await pubCtx.dispose();
  await adminCtx.dispose();
  await ownerCtx.dispose();
  await staffCtx.dispose();
  await candCtx.dispose();
});
