import { Router, type IRouter } from "express";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  institutionApiKeysTable,
  candidateInstitutionsTable,
  candidatesTable,
  institutionDepartmentsTable,
  institutionFacultiesTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { isInstitutionPremium } from "./institution-subscription";

const router: IRouter = Router();

/**
 * T7: Institution Pro API keys.
 *
 * - List/create/revoke endpoints are owner-only and Pro-gated.
 * - The plaintext key is returned exactly ONCE from the create endpoint
 *   in the `key` field; only the SHA-256 is persisted. There is no
 *   recovery path — users must mint a new key if they lose it.
 * - The SIS read endpoint (`GET /api/v1/institutions/students`) is
 *   authenticated by the same key via `Authorization: Bearer <key>` and
 *   returns the verified roster as JSON.
 */

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function generatePlaintext(): { plaintext: string; prefix: string } {
  // 32 random bytes → 64 hex chars. Prefix the key with `jum_` so
  // accidental commits to public repos are easier to detect via
  // string scanners.
  const random = randomBytes(32).toString("hex");
  const plaintext = `jum_${random}`;
  return { plaintext, prefix: plaintext.slice(0, 12) };
}

router.get(
  "/institutions/:id/api-keys",
  requireAuth,
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params["id"]);
    if (!Number.isInteger(institutionId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (
      me.role !== "admin" &&
      !(
        me.role === "institution" &&
        me.institutionId === institutionId &&
        me.orgRole === "owner"
      )
    ) {
      res.status(403).json({ error: "Owners only" });
      return;
    }
    const rows = await db
      .select({
        id: institutionApiKeysTable.id,
        label: institutionApiKeysTable.label,
        prefix: institutionApiKeysTable.prefix,
        createdAt: institutionApiKeysTable.createdAt,
        lastUsedAt: institutionApiKeysTable.lastUsedAt,
        revokedAt: institutionApiKeysTable.revokedAt,
      })
      .from(institutionApiKeysTable)
      .where(eq(institutionApiKeysTable.institutionId, institutionId))
      .orderBy(desc(institutionApiKeysTable.createdAt));
    res.json(
      rows.map((r) => ({
        id: r.id,
        label: r.label,
        prefix: r.prefix,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      })),
    );
  },
);

router.post(
  "/institutions/:id/api-keys",
  requireAuth,
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params["id"]);
    if (!Number.isInteger(institutionId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (
      me.role !== "institution" ||
      me.institutionId !== institutionId ||
      me.orgRole !== "owner"
    ) {
      res.status(403).json({ error: "Owners only" });
      return;
    }
    if (!(await isInstitutionPremium(institutionId))) {
      res.status(402).json({
        error: "API keys are an Institution Pro feature",
        requiresUpgrade: true,
        kind: "apiKeys",
      });
      return;
    }
    const label =
      typeof (req.body as { label?: unknown })?.label === "string"
        ? ((req.body as { label: string }).label.trim() || "Untitled key")
        : "Untitled key";
    if (label.length > 80) {
      res.status(400).json({ error: "Label must be 80 characters or fewer" });
      return;
    }
    const { plaintext, prefix } = generatePlaintext();
    const [inserted] = await db
      .insert(institutionApiKeysTable)
      .values({
        institutionId,
        label,
        prefix,
        hashedKey: hashKey(plaintext),
        createdBy: me.id,
      })
      .returning();
    if (!inserted) {
      res.status(500).json({ error: "Failed to create key" });
      return;
    }
    res.status(201).json({
      id: inserted.id,
      label: inserted.label,
      prefix: inserted.prefix,
      key: plaintext,
      createdAt: inserted.createdAt.toISOString(),
    });
  },
);

router.delete(
  "/institutions/:id/api-keys/:keyId",
  requireAuth,
  async (req, res): Promise<void> => {
    const institutionId = Number(req.params["id"]);
    const keyId = Number(req.params["keyId"]);
    if (!Number.isInteger(institutionId) || !Number.isInteger(keyId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const me = req.currentUser!;
    if (
      me.role !== "institution" ||
      me.institutionId !== institutionId ||
      me.orgRole !== "owner"
    ) {
      res.status(403).json({ error: "Owners only" });
      return;
    }
    const result = await db
      .update(institutionApiKeysTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(institutionApiKeysTable.id, keyId),
          eq(institutionApiKeysTable.institutionId, institutionId),
          isNull(institutionApiKeysTable.revokedAt),
        ),
      )
      .returning();
    if (result.length === 0) {
      res.status(404).json({ error: "Key not found or already revoked" });
      return;
    }
    res.json({ ok: true });
  },
);

/**
 * Public SIS endpoint. Auth via `Authorization: Bearer <key>`. Returns
 * the verified roster (one row per verified affiliation) for the
 * institution that minted the key. No session/cookie auth — this is
 * for server-to-server integrations.
 */
// NOTE: the parent router is mounted at `/api` in app.ts, so the path
// here is relative to that mount — declaring it as `/v1/...` (not
// `/api/v1/...`) is what makes the final URL `/api/v1/institutions/students`.
// Earlier this was double-prefixed which is why Orval generated a
// `/api/api/v1/...` client URL.
router.get(
  "/v1/institutions/students",
  async (req, res): Promise<void> => {
    const auth = req.header("authorization") ?? "";
    const match = /^Bearer\s+(\S+)$/.exec(auth);
    if (!match) {
      res.status(401).json({ error: "Missing Bearer token" });
      return;
    }
    const presented = match[1] ?? "";
    const [keyRow] = await db
      .select()
      .from(institutionApiKeysTable)
      .where(eq(institutionApiKeysTable.hashedKey, hashKey(presented)))
      .limit(1);
    if (!keyRow || keyRow.revokedAt) {
      res.status(401).json({ error: "Invalid or revoked API key" });
      return;
    }
    if (!(await isInstitutionPremium(keyRow.institutionId))) {
      res.status(402).json({
        error: "Institution Pro is required to use the SIS API",
        requiresUpgrade: true,
        kind: "apiKeys",
      });
      return;
    }
    // Best-effort lastUsedAt bump — never block the response if it
    // races with a revoke.
    void db
      .update(institutionApiKeysTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(institutionApiKeysTable.id, keyRow.id))
      .catch((err) =>
        req.log.warn({ err }, "Failed to update lastUsedAt on api key"),
      );

    const rows = await db
      .select({
        candidateId: candidatesTable.id,
        fullName: candidatesTable.fullName,
        email: candidatesTable.email,
        phone: candidatesTable.phone,
        verifiedAt: candidateInstitutionsTable.verifiedAt,
        verifiedByName: usersTable.fullName,
        departmentId: candidateInstitutionsTable.departmentId,
        departmentName: institutionDepartmentsTable.name,
        facultyName: institutionFacultiesTable.name,
      })
      .from(candidateInstitutionsTable)
      .innerJoin(
        candidatesTable,
        eq(candidatesTable.id, candidateInstitutionsTable.candidateId),
      )
      .leftJoin(
        usersTable,
        eq(usersTable.id, candidateInstitutionsTable.verifiedBy),
      )
      .leftJoin(
        institutionDepartmentsTable,
        eq(
          institutionDepartmentsTable.id,
          candidateInstitutionsTable.departmentId,
        ),
      )
      .leftJoin(
        institutionFacultiesTable,
        eq(institutionFacultiesTable.id, institutionDepartmentsTable.facultyId),
      )
      .where(
        and(
          eq(
            candidateInstitutionsTable.institutionId,
            keyRow.institutionId,
          ),
        ),
      );

    res.json({
      institutionId: keyRow.institutionId,
      generatedAt: new Date().toISOString(),
      students: rows
        .filter((r) => r.verifiedAt != null)
        .map((r) => ({
          candidateId: r.candidateId,
          fullName: r.fullName,
          email: r.email,
          phone: r.phone,
          verifiedAt: r.verifiedAt!.toISOString(),
          verifiedByName: r.verifiedByName,
          facultyName: r.facultyName,
          departmentName: r.departmentName,
        })),
    });
  },
);

export default router;
