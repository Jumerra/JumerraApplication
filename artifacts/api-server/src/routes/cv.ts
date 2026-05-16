import { Router } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  cvSettingsTable,
  cvPaymentsTable,
  candidatesTable,
  experienceTable,
  educationTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middleware/require-auth";
import {
  getUncachableStripeClient,
  mapStripeCheckoutError,
} from "../stripeClient";
import { getAnthropic, ANTHROPIC_MODEL } from "../aiClient";
import { finalizeCvPayment } from "../lib/payment-finalizers";

const router: Router = Router();

const SETTINGS_ROW_ID = 1;
const ALLOWED_CURRENCIES = new Set([
  "usd",
  "eur",
  "gbp",
  "ngn",
  "ghs",
  "kes",
  "zar",
]);

type SettingsRow = typeof cvSettingsTable.$inferSelect;

function toApiSettings(row: SettingsRow) {
  return {
    isActive: row.isActive,
    priceCents: row.priceCents,
    currency: row.currency,
  };
}

async function loadOrSeedSettings(): Promise<SettingsRow> {
  const existing = await db
    .select()
    .from(cvSettingsTable)
    .where(eq(cvSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await db
    .insert(cvSettingsTable)
    .values({ id: SETTINGS_ROW_ID })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const reread = await db
    .select()
    .from(cvSettingsTable)
    .where(eq(cvSettingsTable.id, SETTINGS_ROW_ID))
    .limit(1);
  if (!reread[0]) throw new Error("Failed to seed cv_settings row");
  return reread[0];
}

router.get("/cv/settings", requireAuth, async (_req, res) => {
  const row = await loadOrSeedSettings();
  res.json(toApiSettings(row));
});

router.put("/admin/cv/settings", requireAdmin, async (req, res) => {
  try {
    const body = req.body as {
      isActive?: unknown;
      priceCents?: unknown;
      currency?: unknown;
    } | null;
    if (!body) {
      res.status(400).json({ error: "Request body required" });
      return;
    }
    const isActive = body.isActive;
    const priceCents = body.priceCents;
    const currency = body.currency;

    if (typeof isActive !== "boolean") {
      res.status(400).json({ error: "isActive must be boolean" });
      return;
    }
    if (
      typeof priceCents !== "number" ||
      !Number.isInteger(priceCents) ||
      priceCents < 50 ||
      priceCents > 1_000_000
    ) {
      res
        .status(400)
        .json({ error: "priceCents must be an integer between 50 and 1000000" });
      return;
    }
    if (typeof currency !== "string") {
      res.status(400).json({ error: "currency must be a string" });
      return;
    }
    const normalizedCurrency = currency.toLowerCase();
    if (!ALLOWED_CURRENCIES.has(normalizedCurrency)) {
      res.status(400).json({
        error: `currency must be one of: ${Array.from(ALLOWED_CURRENCIES).join(", ")}`,
      });
      return;
    }

    await loadOrSeedSettings();
    const updated = await db
      .update(cvSettingsTable)
      .set({
        isActive,
        priceCents,
        currency: normalizedCurrency,
        updatedAt: new Date(),
        updatedBy: req.currentUser!.id,
      })
      .where(eq(cvSettingsTable.id, SETTINGS_ROW_ID))
      .returning();
    if (!updated[0]) {
      res.status(500).json({ error: "Failed to update cv settings" });
      return;
    }
    res.json(toApiSettings(updated[0]));
  } catch (err) {
    req.log.error({ err }, "cv settings update failed");
    res.status(500).json({ error: "Update failed" });
  }
});

function ensureOwnerOrAdmin(
  candidateId: number,
  user: { role: string; candidateId: number | null },
): boolean {
  if (user.role === "admin") return true;
  return user.role === "candidate" && user.candidateId === candidateId;
}

router.post(
  "/candidates/:id/cv/checkout",
  requireAuth,
  async (req, res) => {
    try {
      const candidateId = Number(req.params.id);
      if (!Number.isInteger(candidateId) || candidateId <= 0) {
        res.status(400).json({ error: "Invalid candidate id" });
        return;
      }
      if (!ensureOwnerOrAdmin(candidateId, req.currentUser!)) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }

      const body = (req.body ?? {}) as {
        successUrl?: unknown;
        cancelUrl?: unknown;
      };
      const successUrl = body.successUrl;
      const cancelUrl = body.cancelUrl;
      if (typeof successUrl !== "string" || !/^https?:\/\//.test(successUrl)) {
        res.status(400).json({ error: "successUrl must be an absolute URL" });
        return;
      }
      if (typeof cancelUrl !== "string" || !/^https?:\/\//.test(cancelUrl)) {
        res.status(400).json({ error: "cancelUrl must be an absolute URL" });
        return;
      }

      const settings = await loadOrSeedSettings();
      if (!settings.isActive) {
        res
          .status(400)
          .json({ error: "AI CV Builder is currently disabled" });
        return;
      }

      const candRows = await db
        .select({
          id: candidatesTable.id,
          fullName: candidatesTable.fullName,
          aiCvUnlocked: candidatesTable.aiCvUnlocked,
        })
        .from(candidatesTable)
        .where(eq(candidatesTable.id, candidateId))
        .limit(1);
      const candidate = candRows[0];
      if (!candidate) {
        res.status(404).json({ error: "Candidate not found" });
        return;
      }
      if (candidate.aiCvUnlocked) {
        res
          .status(400)
          .json({ error: "AI CV Builder is already unlocked for this candidate" });
        return;
      }

      let session;
      try {
        const stripe = await getUncachableStripeClient();
        session = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: settings.currency,
                unit_amount: settings.priceCents,
                product_data: {
                  name: "AI CV Builder (lifetime unlock)",
                  description: `Unlock the AI CV Builder for ${candidate.fullName}.`,
                },
              },
            },
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            candidateId: String(candidateId),
            purpose: "ai_cv_unlock",
          },
        });
      } catch (stripeErr) {
        const mapped = mapStripeCheckoutError(stripeErr);
        req.log.error(
          {
            err: stripeErr,
            candidateId,
            purpose: "ai_cv_unlock",
            ...mapped.logFields,
          },
          "cv checkout: stripe call failed",
        );
        res.status(mapped.status).json(mapped.body);
        return;
      }

      if (!session.url) {
        req.log.error(
          { candidateId, purpose: "ai_cv_unlock", sessionId: session.id },
          "cv checkout: stripe returned session without url",
        );
        res.status(502).json({
          error:
            "Stripe didn't return a checkout URL. Please try again or contact support.",
          code: "stripe_no_url",
        });
        return;
      }

      await db.insert(cvPaymentsTable).values({
        candidateId,
        stripeSessionId: session.id,
        amountCents: settings.priceCents,
        currency: settings.currency,
        status: "pending",
      });

      res.json({ sessionId: session.id, checkoutUrl: session.url });
    } catch (err) {
      req.log.error({ err }, "cv checkout: unexpected failure");
      res.status(500).json({
        error:
          "An unexpected error occurred while creating the checkout session.",
        code: "internal_error",
      });
    }
  },
);

router.post("/cv/checkout/verify", requireAuth, async (req, res) => {
  const body = (req.body ?? {}) as { sessionId?: unknown };
  const sessionId = body.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    res.status(400).json({ error: "sessionId required" });
    return;
  }
  // Tracked across the try/catch so logs always carry the payment-owner
  // candidate id even when an admin is verifying on behalf of a candidate
  // (req.currentUser.candidateId is null for admins).
  let paymentCandidateId: number | null = null;
  try {

    const paymentRows = await db
      .select()
      .from(cvPaymentsTable)
      .where(eq(cvPaymentsTable.stripeSessionId, sessionId))
      .limit(1);
    const payment = paymentRows[0];
    if (!payment) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    paymentCandidateId = payment.candidateId;

    if (!ensureOwnerOrAdmin(payment.candidateId, req.currentUser!)) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }

    if (payment.status === "paid") {
      res.json({ status: "paid", unlocked: true });
      return;
    }
    if (payment.status === "failed" || payment.status === "expired") {
      res.json({ status: payment.status, unlocked: false });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      if (session.status === "expired") {
        await db
          .update(cvPaymentsTable)
          .set({ status: "expired" })
          .where(
            and(
              eq(cvPaymentsTable.id, payment.id),
              eq(cvPaymentsTable.status, "pending"),
            ),
          );
        res.json({ status: "expired", unlocked: false });
        return;
      }
      if (session.status === "complete") {
        await db
          .update(cvPaymentsTable)
          .set({ status: "failed" })
          .where(
            and(
              eq(cvPaymentsTable.id, payment.id),
              eq(cvPaymentsTable.status, "pending"),
            ),
          );
        res.json({ status: "failed", unlocked: false });
        return;
      }
      res.json({ status: "pending", unlocked: false });
      return;
    }

    // Delegate to the shared finalizer so the status flip and the
    // candidate's aiCvUnlocked flag are written in the same DB
    // transaction. Previously this route flipped the two in sequence,
    // which could leave a paid payment row without the corresponding
    // unlock if the process died between writes.
    await finalizeCvPayment({ provider: "stripe", externalRef: sessionId });
    res.json({ status: "paid", unlocked: true });
  } catch (err) {
    const mapped = mapStripeCheckoutError(err);
    req.log.error(
      {
        err,
        sessionId,
        candidateId:
          paymentCandidateId ?? req.currentUser?.candidateId ?? null,
        actorCandidateId: req.currentUser?.candidateId ?? null,
        purpose: "ai_cv_unlock",
        errCode: mapped.body.code,
        ...mapped.logFields,
      },
      "cv checkout verify failed",
    );
    res.status(mapped.status).json(mapped.body);
  }
});

router.get("/candidates/:id/cv", requireAuth, async (req, res) => {
  try {
    const candidateId = Number(req.params.id);
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      res.status(400).json({ error: "Invalid candidate id" });
      return;
    }
    if (!ensureOwnerOrAdmin(candidateId, req.currentUser!)) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    const rows = await db
      .select({
        aiCvUnlocked: candidatesTable.aiCvUnlocked,
        aiCvText: candidatesTable.aiCvText,
        aiCvGeneratedAt: candidatesTable.aiCvGeneratedAt,
      })
      .from(candidatesTable)
      .where(eq(candidatesTable.id, candidateId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    res.json({
      unlocked: row.aiCvUnlocked,
      cvText: row.aiCvText,
      generatedAt: row.aiCvGeneratedAt
        ? row.aiCvGeneratedAt.toISOString()
        : null,
    });
  } catch (err) {
    req.log.error({ err }, "cv fetch failed");
    res.status(500).json({ error: "Failed to load CV" });
  }
});

router.post(
  "/candidates/:id/cv/generate",
  requireAuth,
  async (req, res) => {
    try {
      const candidateId = Number(req.params.id);
      if (!Number.isInteger(candidateId) || candidateId <= 0) {
        res.status(400).json({ error: "Invalid candidate id" });
        return;
      }
      if (!ensureOwnerOrAdmin(candidateId, req.currentUser!)) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }

      const body = (req.body ?? {}) as { focus?: unknown };
      const focus =
        typeof body.focus === "string" && body.focus.trim().length > 0
          ? body.focus.trim().slice(0, 500)
          : null;

      const candRows = await db
        .select()
        .from(candidatesTable)
        .where(eq(candidatesTable.id, candidateId))
        .limit(1);
      const candidate = candRows[0];
      if (!candidate) {
        res.status(404).json({ error: "Candidate not found" });
        return;
      }
      if (!candidate.aiCvUnlocked) {
        res.status(402).json({ error: "AI CV Builder not unlocked" });
        return;
      }

      // Pull related data we know exists in the schema. These tables
      // may all be empty for new candidates — that's fine, the prompt
      // tells the model to work with whatever is provided.
      const [experiences, education] = await Promise.all([
        db
          .select()
          .from(experienceTable)
          .where(eq(experienceTable.candidateId, candidateId)),
        db
          .select()
          .from(educationTable)
          .where(eq(educationTable.candidateId, candidateId)),
      ]);

      const profileSummary = {
        fullName: candidate.fullName,
        headline: candidate.headline,
        location: candidate.location,
        bio: candidate.bio,
        yearsExperience: candidate.yearsExperience,
        skills: candidate.skills,
        availability: candidate.availability,
        experiences: experiences.map((e) => ({
          title: e.title,
          company: e.company,
          startDate: e.startDate,
          endDate: e.endDate,
          description: e.description,
        })),
        education: education.map((e) => ({
          institution: e.institution,
          degree: e.degree,
          fieldOfStudy: e.fieldOfStudy,
          startYear: e.startYear,
          endYear: e.endYear,
        })),
      };

      const focusLine = focus
        ? `\n\nThe candidate has asked the CV to focus on: ${focus}`
        : "";

      const prompt = `You are a senior career coach writing a polished, ATS-friendly CV in Markdown for the candidate below. Produce ONLY the CV (no preamble, no commentary). Use these sections in order, omitting any that have no content:

# {Full Name}
{Headline} — {Location}

## Summary
2-4 sentences. Confident but not boastful. Tailor to the focus area if provided.

## Skills
Comma-separated list of the most relevant skills.

## Experience
For each role: bold the title, italicize the company and location, then dates. Follow with 2-4 bullet points starting with strong action verbs and quantified outcomes where possible.

## Education
For each entry: bold the degree and field, italicize the institution, then dates. One short line of detail if provided.

Profile data (JSON):
${JSON.stringify(profileSummary, null, 2)}${focusLine}`;

      const anthropic = getAnthropic();
      const response = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });

      const cvText = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n")
        .trim();

      if (!cvText) {
        res.status(502).json({ error: "AI returned an empty response" });
        return;
      }

      const generatedAt = new Date();
      await db
        .update(candidatesTable)
        .set({ aiCvText: cvText, aiCvGeneratedAt: generatedAt })
        .where(eq(candidatesTable.id, candidateId));

      res.json({
        unlocked: true,
        cvText,
        generatedAt: generatedAt.toISOString(),
      });
    } catch (err) {
      req.log.error({ err }, "cv generation failed");
      res.status(500).json({ error: "Failed to generate CV" });
    }
  },
);

export default router;
