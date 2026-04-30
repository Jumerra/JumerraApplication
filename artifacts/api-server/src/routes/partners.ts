import { Router } from "express";
import { eq, asc } from "drizzle-orm";
import {
  db,
  partnerSettingsTable,
  partnersTable,
} from "@workspace/db";
import { requireAdmin } from "../middleware/require-auth";

const router: Router = Router();

const SETTINGS_ROW_ID = 1;

type SettingsRow = typeof partnerSettingsTable.$inferSelect;
type PartnerRow = typeof partnersTable.$inferSelect;

function toApiSettings(row: SettingsRow) {
  return { isActive: row.isActive };
}

function toApiPartner(row: PartnerRow) {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logoUrl,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadOrSeedSettings(): Promise<SettingsRow> {
  const existing = await db
    .select()
    .from(partnerSettingsTable)
    .where(eq(partnerSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  if (existing[0]) return existing[0];
  // Seed the singleton row on first read so the admin form has
  // something to edit. Defaults to disabled — the admin must
  // explicitly enable the section before it appears on the landing page.
  const inserted = await db
    .insert(partnerSettingsTable)
    .values({ id: SETTINGS_ROW_ID })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const reread = await db
    .select()
    .from(partnerSettingsTable)
    .where(eq(partnerSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  if (!reread[0]) throw new Error("Failed to seed partner_settings row");
  return reread[0];
}

/**
 * GET /api/partner-settings
 * Public. Used by the landing page to decide whether to render the
 * "Our Partners" marquee at all.
 */
router.get("/partner-settings", async (_req, res) => {
  const row = await loadOrSeedSettings();
  res.json(toApiSettings(row));
});

/**
 * GET /api/partners
 * Public. Returns the partners in display order. The landing page
 * still gates rendering on the settings toggle, but the data is
 * always readable so the admin UI can preview the list.
 */
router.get("/partners", async (_req, res) => {
  const rows = await db
    .select()
    .from(partnersTable)
    .orderBy(asc(partnersTable.displayOrder), asc(partnersTable.id));
  res.json(rows.map(toApiPartner));
});

/**
 * PUT /api/admin/partner-settings
 * Admin only. Toggles whether the section is rendered on the landing page.
 */
router.put("/admin/partner-settings", requireAdmin, async (req, res) => {
  const body = req.body as { isActive?: unknown } | null;
  if (!body || typeof body.isActive !== "boolean") {
    res.status(400).json({ error: "isActive must be boolean" });
    return;
  }
  const updated = await db
    .update(partnerSettingsTable)
    .set({
      isActive: body.isActive,
      updatedAt: new Date(),
      updatedBy: req.currentUser?.id ?? null,
    })
    .where(eq(partnerSettingsTable.id, SETTINGS_ROW_ID))
    .returning();
  if (!updated[0]) {
    // Race: row hadn't been seeded yet. Seed and retry once.
    await loadOrSeedSettings();
    const retry = await db
      .update(partnerSettingsTable)
      .set({
        isActive: body.isActive,
        updatedAt: new Date(),
        updatedBy: req.currentUser?.id ?? null,
      })
      .where(eq(partnerSettingsTable.id, SETTINGS_ROW_ID))
      .returning();
    if (!retry[0]) {
      res.status(500).json({ error: "Failed to update settings" });
      return;
    }
    res.json(toApiSettings(retry[0]));
    return;
  }
  res.json(toApiSettings(updated[0]));
});

function validatePartnerInput(body: unknown): {
  name?: string;
  logoUrl?: string;
  displayOrder?: number;
  error?: string;
} {
  if (!body || typeof body !== "object") {
    return { error: "Request body required" };
  }
  const b = body as Record<string, unknown>;
  const out: { name?: string; logoUrl?: string; displayOrder?: number } = {};
  if (b.name !== undefined) {
    if (typeof b.name !== "string") return { error: "name must be a string" };
    const trimmed = b.name.trim();
    if (trimmed.length < 1 || trimmed.length > 200) {
      return { error: "name must be 1–200 characters" };
    }
    out.name = trimmed;
  }
  if (b.logoUrl !== undefined) {
    if (typeof b.logoUrl !== "string") {
      return { error: "logoUrl must be a string" };
    }
    const trimmed = b.logoUrl.trim();
    if (trimmed.length < 1 || trimmed.length > 2048) {
      return { error: "logoUrl must be 1–2048 characters" };
    }
    out.logoUrl = trimmed;
  }
  if (b.displayOrder !== undefined) {
    if (
      typeof b.displayOrder !== "number" ||
      !Number.isInteger(b.displayOrder)
    ) {
      return { error: "displayOrder must be an integer" };
    }
    out.displayOrder = b.displayOrder;
  }
  return out;
}

/**
 * POST /api/admin/partners
 * Admin only. Creates a new partner. `displayOrder` defaults to one
 * past the current max so new entries land at the end of the marquee.
 */
router.post("/admin/partners", requireAdmin, async (req, res) => {
  const parsed = validatePartnerInput(req.body);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  if (!parsed.name || !parsed.logoUrl) {
    res.status(400).json({ error: "name and logoUrl are required" });
    return;
  }
  let displayOrder = parsed.displayOrder;
  if (displayOrder === undefined) {
    const existing = await db
      .select({ displayOrder: partnersTable.displayOrder })
      .from(partnersTable)
      .orderBy(asc(partnersTable.displayOrder));
    const max = existing.length
      ? Math.max(...existing.map((r) => r.displayOrder))
      : -1;
    displayOrder = max + 1;
  }
  const [row] = await db
    .insert(partnersTable)
    .values({
      name: parsed.name,
      logoUrl: parsed.logoUrl,
      displayOrder,
    })
    .returning();
  res.status(201).json(toApiPartner(row));
});

/**
 * PATCH /api/admin/partners/:id
 * Admin only. Partial update — any subset of name/logoUrl/displayOrder.
 */
router.patch("/admin/partners/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = validatePartnerInput(req.body);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.name !== undefined) patch.name = parsed.name;
  if (parsed.logoUrl !== undefined) patch.logoUrl = parsed.logoUrl;
  if (parsed.displayOrder !== undefined) patch.displayOrder = parsed.displayOrder;
  if (Object.keys(patch).length === 1) {
    // Only updatedAt — caller passed nothing meaningful.
    res.status(400).json({ error: "No editable fields provided" });
    return;
  }
  const updated = await db
    .update(partnersTable)
    .set(patch)
    .where(eq(partnersTable.id, id))
    .returning();
  if (!updated[0]) {
    res.status(404).json({ error: "Partner not found" });
    return;
  }
  res.json(toApiPartner(updated[0]));
});

/**
 * DELETE /api/admin/partners/:id
 * Admin only.
 */
router.delete("/admin/partners/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const deleted = await db
    .delete(partnersTable)
    .where(eq(partnersTable.id, id))
    .returning({ id: partnersTable.id });
  if (!deleted[0]) {
    res.status(404).json({ error: "Partner not found" });
    return;
  }
  res.status(204).end();
});

export default router;
