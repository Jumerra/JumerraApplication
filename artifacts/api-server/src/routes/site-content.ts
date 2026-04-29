import { Router } from "express";
import { db } from "@workspace/db";
import { siteContentTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../middleware/require-auth";
import { requirePermission } from "../lib/permissions";

const router: Router = Router();

const ALLOWED_TYPES = new Set(["text", "image"]);

/**
 * GET /api/site-content
 * Public. Returns every site content row so the home page can render.
 * Missing keys are simply absent from the response — clients fall back
 * to their hard-coded defaults.
 */
router.get("/site-content", async (_req, res) => {
  const rows = await db.select().from(siteContentTable);
  res.json({
    items: rows.map((r) => ({
      key: r.key,
      type: r.type,
      value: r.value,
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

/**
 * PUT /api/site-content
 * Admin only. Bulk upsert. Body: { items: [{ key, type, value }, ...] }
 */
router.put("/site-content", requireAdmin, requirePermission("site-content:edit"), async (req, res) => {
  try {
    const items = (req.body?.items ?? []) as Array<{
      key?: unknown;
      type?: unknown;
      value?: unknown;
    }>;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "items array required" });
      return;
    }
    const cleaned: Array<{ key: string; type: string; value: string }> = [];
    for (const it of items) {
      if (
        typeof it.key !== "string" ||
        typeof it.type !== "string" ||
        typeof it.value !== "string"
      ) {
        res.status(400).json({ error: "Each item needs string key, type, value" });
        return;
      }
      if (!ALLOWED_TYPES.has(it.type)) {
        res
          .status(400)
          .json({ error: `Invalid type "${it.type}" (allowed: text, image)` });
        return;
      }
      if (it.key.length > 200 || it.value.length > 5000) {
        res.status(400).json({ error: "Field length exceeds limit" });
        return;
      }
      cleaned.push({ key: it.key, type: it.type, value: it.value });
    }

    const updatedBy = req.currentUser!.id;
    await db
      .insert(siteContentTable)
      .values(
        cleaned.map((c) => ({
          key: c.key,
          type: c.type,
          value: c.value,
          updatedBy,
        })),
      )
      .onConflictDoUpdate({
        target: siteContentTable.key,
        set: {
          value: sql`excluded.value`,
          type: sql`excluded.type`,
          updatedAt: sql`now()`,
          updatedBy: sql`excluded.updated_by`,
        },
      });

    res.json({ ok: true, count: cleaned.length });
  } catch (err) {
    req.log.error({ err }, "site-content upsert failed");
    res.status(500).json({ error: "Update failed" });
  }
});

export default router;
