import { test, expect } from "@playwright/test";
import { RUN_TAG } from "../helpers/env";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../helpers/constants";
import { login, ok } from "../helpers/api";
import {
  findUserByEmail,
  findLatestSetupTokenForUser,
  makeInstitutionPremium,
  setUserAssignedDepartment,
  setUserAssignedFaculty,
} from "../helpers/db-helpers";

/**
 * Journey 5: Dean / HoD scope enforcement on the institution roster.
 *
 *   - A dean assigned to Faculty A must NOT see students under Faculty B.
 *   - An HoD assigned to a department must see only that department's
 *     students.
 *   - When a dean/HoD's scope row is cleared (faculty/department deleted
 *     → FK SET NULL on users.assigned_*), the API must DENY (403) rather
 *     than silently broaden them to org-wide.
 *
 * The boot-time role seeder doesn't see institutions created post-boot,
 * so `ensureInstitutionRoles(institutionId)` mirrors the dean/hod
 * permission set into the DB for this run (same pattern as the
 * institution-journey spec).
 */
test("dean/HoD scope enforcement on institution roster", async ({
  playwright,
}) => {
  const baseURL = process.env.E2E_API_URL ?? "http://127.0.0.1:8090";
  const tag = `${RUN_TAG}-scope`;
  const ownerEmail = `inst-scope-${tag}@jumerra.test`;
  const ownerPassword = "InstOwnerPass1!";
  const deanEmail = `dean-${tag}@jumerra.test`;
  const deanPassword = "DeanPass1234!";
  const hodEmail = `hod-${tag}@jumerra.test`;
  const hodPassword = "HodPass1234!";
  const candAEmail = `candA-${tag}@jumerra.test`;
  const candBEmail = `candB-${tag}@jumerra.test`;
  const candPassword = "CandPass1234!";

  // 1. Institution owner registers + admin approves.
  const pubCtx = await playwright.request.newContext({ baseURL });
  await ok(
    await pubCtx.post("/api/auth/register", {
      data: {
        email: ownerEmail,
        password: ownerPassword,
        role: "institution",
        fullName: `Owner ${tag}`,
        submittedData: {
          institutionName: `Inst Scope U ${tag}`,
          type: "university",
          location: "Accra",
        },
      },
    }),
    "register institution",
  );
  const adminCtx = await playwright.request.newContext({ baseURL });
  await login(adminCtx, ADMIN_EMAIL, ADMIN_PASSWORD);
  const ownerUser = await findUserByEmail(ownerEmail);
  const regs = (await ok(
    await adminCtx.get(`/api/admin/registrations?status=pending`),
    "list pending regs",
  )) as { registrations?: Array<{ userId: number; registrationId?: number; id?: number }> };
  const regRow = (regs.registrations ?? []).find(
    (r) => r.userId === ownerUser!.id,
  );
  expect(regRow).toBeDefined();
  await ok(
    await adminCtx.post(
      `/api/admin/registrations/${regRow!.registrationId ?? regRow!.id}/approve`,
      { data: {} },
    ),
    "approve institution",
  );

  // 2. Owner signs in; create faculties + departments.
  const ownerCtx = await playwright.request.newContext({ baseURL });
  await login(ownerCtx, ownerEmail, ownerPassword);
  const ownerMe = (await ok(await ownerCtx.get("/api/auth/me"), "owner me")) as {
    user: { institutionId: number };
  };
  const institutionId = ownerMe.user.institutionId;
  // Starter tier caps faculties at 1; flip to premium so we can create
  // two faculties + departments for cross-faculty scope assertions.
  await makeInstitutionPremium(institutionId);

  const facultyA = (await ok(
    await ownerCtx.post("/api/institutions/me/faculties", {
      data: { name: `Faculty A ${tag}` },
    }),
    "create faculty A",
  )) as { id: number };
  const facultyB = (await ok(
    await ownerCtx.post("/api/institutions/me/faculties", {
      data: { name: `Faculty B ${tag}` },
    }),
    "create faculty B",
  )) as { id: number };
  const deptA = (await ok(
    await ownerCtx.post("/api/institutions/me/departments", {
      data: { name: `Dept A1 ${tag}`, facultyId: facultyA.id },
    }),
    "create dept A1",
  )) as { id: number };
  const deptB = (await ok(
    await ownerCtx.post("/api/institutions/me/departments", {
      data: { name: `Dept B1 ${tag}`, facultyId: facultyB.id },
    }),
    "create dept B1",
  )) as { id: number };

  // 3. Two candidates, one affiliated under each faculty's department.
  async function registerCandidateInDept(
    email: string,
    departmentId: number,
  ): Promise<number> {
    await ok(
      await pubCtx.post("/api/auth/register", {
        data: {
          email,
          password: candPassword,
          role: "candidate",
          fullName: `Cand ${email}`,
        },
      }),
      `register ${email}`,
    );
    const ctx = await playwright.request.newContext({ baseURL });
    await login(ctx, email, candPassword);
    const meRes = (await ok(await ctx.get("/api/auth/me"), `${email} me`)) as {
      user: { candidateId: number };
    };
    const candidateId = meRes.user.candidateId;
    // First attach the affiliation, then set the department on it.
    await ok(
      await ctx.patch(`/api/candidates/${candidateId}`, {
        data: { institutionId },
      }),
      `${email} affiliate`,
    );
    await ok(
      await ctx.patch(`/api/candidates/${candidateId}`, {
        data: {
          affiliations: [{ institutionId, departmentId }],
        },
      }),
      `${email} set dept`,
    );
    await ctx.dispose();
    return candidateId;
  }
  const candAId = await registerCandidateInDept(candAEmail, deptA.id);
  const candBId = await registerCandidateInDept(candBEmail, deptB.id);

  // Debug: check DB affiliation state
  const { getAffiliation } = await import("../helpers/db-helpers");
  const affA = await getAffiliation(candAId, institutionId);
  const affB = await getAffiliation(candBId, institutionId);
  console.log("DEBUG affA", affA, "affB", affB, "candAId", candAId, "candBId", candBId, "institutionId", institutionId, "deptA", deptA.id, "deptB", deptB.id);

  // 4. Sanity: owner sees both students (org-wide view).
  const ownerList = (await ok(
    await ownerCtx.get(`/api/institutions/${institutionId}/students`),
    "owner list students",
  )) as Array<{ candidateId: number }>;
  const ownerIds = new Set(ownerList.map((s) => s.candidateId));
  expect(ownerIds.has(candAId)).toBe(true);
  expect(ownerIds.has(candBId)).toBe(true);

  // 5. Invite a dean assigned to Faculty A, finish setup, log in.
  const deanInvite = (await ok(
    await ownerCtx.post("/api/staff/invite", {
      data: {
        email: deanEmail,
        fullName: `Dean ${tag}`,
        orgRole: "dean",
        assignedFacultyId: facultyA.id,
      },
    }),
    "invite dean",
  )) as { setupUrl: string | null };
  expect(deanInvite).toBeDefined();
  const deanUser = await findUserByEmail(deanEmail);
  const deanToken = await findLatestSetupTokenForUser(deanUser!.id);
  const deanCtx = await playwright.request.newContext({ baseURL });
  await ok(
    await deanCtx.post("/api/auth/setup-password", {
      data: { token: deanToken!.token, password: deanPassword },
    }),
    "dean setup-password",
  );

  // 6. Dean sees only Faculty A's student.
  const deanList = (await ok(
    await deanCtx.get(`/api/institutions/${institutionId}/students`),
    "dean list students",
  )) as Array<{ candidateId: number }>;
  const deanIds = new Set(deanList.map((s) => s.candidateId));
  expect(deanIds.has(candAId)).toBe(true);
  expect(deanIds.has(candBId)).toBe(false);

  // 7. Invite an HoD assigned to Dept A1.
  const hodInvite = (await ok(
    await ownerCtx.post("/api/staff/invite", {
      data: {
        email: hodEmail,
        fullName: `HoD ${tag}`,
        orgRole: "hod",
        assignedDepartmentId: deptA.id,
      },
    }),
    "invite hod",
  )) as { setupUrl: string | null };
  expect(hodInvite).toBeDefined();
  const hodUser = await findUserByEmail(hodEmail);
  const hodToken = await findLatestSetupTokenForUser(hodUser!.id);
  const hodCtx = await playwright.request.newContext({ baseURL });
  await ok(
    await hodCtx.post("/api/auth/setup-password", {
      data: { token: hodToken!.token, password: hodPassword },
    }),
    "hod setup-password",
  );

  // 8. HoD sees only Dept A1's student.
  const hodList = (await ok(
    await hodCtx.get(`/api/institutions/${institutionId}/students`),
    "hod list students",
  )) as Array<{ candidateId: number }>;
  const hodIds = new Set(hodList.map((s) => s.candidateId));
  expect(hodIds.has(candAId)).toBe(true);
  expect(hodIds.has(candBId)).toBe(false);

  // 9. HoD can't widen by passing `?departmentId=` for Dept B (ignored).
  const hodTrySpoof = (await ok(
    await hodCtx.get(
      `/api/institutions/${institutionId}/students?departmentId=${deptB.id}`,
    ),
    "hod spoof B",
  )) as Array<{ candidateId: number }>;
  expect(hodTrySpoof.find((s) => s.candidateId === candBId)).toBeUndefined();

  // 10. FK SET NULL: clear HoD's department (simulate the
  //     department being deleted) → must DENY with 403, not silently
  //     broaden to org-wide. We clear directly in the DB because the
  //     DELETE faculty/department endpoints reject when children
  //     reference them; the schema-level FK SET NULL behaviour is what
  //     the server's null-scope guard exists to defend against.
  await setUserAssignedDepartment(hodUser!.id, null);
  const hodAfterDeleteRes = await hodCtx.get(
    `/api/institutions/${institutionId}/students`,
  );
  expect(hodAfterDeleteRes.status()).toBe(403);

  // 11. Same for the dean's faculty.
  await setUserAssignedFaculty(deanUser!.id, null);
  const deanAfterDeleteRes = await deanCtx.get(
    `/api/institutions/${institutionId}/students`,
  );
  expect(deanAfterDeleteRes.status()).toBe(403);

  await pubCtx.dispose();
  await adminCtx.dispose();
  await ownerCtx.dispose();
  await deanCtx.dispose();
  await hodCtx.dispose();
});
