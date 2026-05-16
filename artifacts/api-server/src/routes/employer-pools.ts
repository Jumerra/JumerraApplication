import { Router, type IRouter } from "express";
import { and, eq, gte, inArray, sql, desc } from "drizzle-orm";
import {
  db,
  employersTable,
  employerTalentPoolsTable,
  employerTalentPoolMembersTable,
  employerMessageTemplatesTable,
  employerOutreachMessagesTable,
  candidatesTable,
  notificationsTable,
  usersTable,
  jobsTable,
} from "@workspace/db";
import {
  CreateTalentPoolBody,
  CreateTalentPoolParams,
  GetTalentPoolParams,
  DeleteTalentPoolParams,
  AddTalentPoolMembersBody,
  AddTalentPoolMembersParams,
  RemoveTalentPoolMemberParams,
  ListMessageTemplatesParams,
  CreateMessageTemplateBody,
  CreateMessageTemplateParams,
  DeleteMessageTemplateParams,
  SendOutreachBody,
  SendOutreachParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();

const OUTREACH_DAILY_CAP = 200;

/**
 * Employer-scoped authorization. Allows the org's own users (employer
 * role bound to the same employerId) and platform admins. Returns the
 * employer row when allowed, or null + writes the appropriate response.
 */
async function authzEmployer(
  req: Parameters<Parameters<typeof router.get>[1]>[0],
  res: Parameters<Parameters<typeof router.get>[1]>[1],
  employerId: number,
) {
  const user = req.currentUser!;
  const isAdmin = user.role === "admin";
  const isMember = user.role === "employer" && user.employerId === employerId;
  if (!isAdmin && !isMember) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  const [employer] = await db
    .select()
    .from(employersTable)
    .where(eq(employersTable.id, employerId));
  if (!employer) {
    res.status(404).json({ error: "Employer not found" });
    return null;
  }
  return employer;
}

function serializePool(
  pool: typeof employerTalentPoolsTable.$inferSelect,
  memberCount: number,
) {
  return {
    id: pool.id,
    employerId: pool.employerId,
    name: pool.name,
    description: pool.description,
    memberCount,
    createdAt: pool.createdAt.toISOString(),
  };
}

async function loadPoolMembers(poolId: number) {
  const rows = await db
    .select({
      candidateId: candidatesTable.id,
      candidateName: candidatesTable.fullName,
      candidateAvatarUrl: candidatesTable.avatarUrl,
      headline: candidatesTable.headline,
      location: candidatesTable.location,
      talentScore: candidatesTable.talentScore,
      openToOffers: candidatesTable.openToOffers,
      tags: employerTalentPoolMembersTable.tags,
      addedAt: employerTalentPoolMembersTable.addedAt,
    })
    .from(employerTalentPoolMembersTable)
    .innerJoin(
      candidatesTable,
      eq(candidatesTable.id, employerTalentPoolMembersTable.candidateId),
    )
    .where(eq(employerTalentPoolMembersTable.poolId, poolId))
    .orderBy(desc(employerTalentPoolMembersTable.addedAt));
  return rows.map((r) => ({
    ...r,
    addedAt: r.addedAt.toISOString(),
  }));
}

router.use("/employers/:id/talent-pools", requireAuth);
router.use("/employers/:id/message-templates", requireAuth);
router.use("/employers/:id/outreach", requireAuth);

// ---------------- Talent pools ----------------

router.get("/employers/:id/talent-pools", async (req, res): Promise<void> => {
  const params = CreateTalentPoolParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const employer = await authzEmployer(req, res, params.data.id);
  if (!employer) return;

  const rows = await db
    .select({
      pool: employerTalentPoolsTable,
      memberCount: sql<number>`count(${employerTalentPoolMembersTable.id})::int`,
    })
    .from(employerTalentPoolsTable)
    .leftJoin(
      employerTalentPoolMembersTable,
      eq(employerTalentPoolMembersTable.poolId, employerTalentPoolsTable.id),
    )
    .where(eq(employerTalentPoolsTable.employerId, params.data.id))
    .groupBy(employerTalentPoolsTable.id)
    .orderBy(desc(employerTalentPoolsTable.createdAt));

  res.json(rows.map((r) => serializePool(r.pool, Number(r.memberCount))));
});

router.post("/employers/:id/talent-pools", async (req, res): Promise<void> => {
  const params = CreateTalentPoolParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const employer = await authzEmployer(req, res, params.data.id);
  if (!employer) return;

  const body = CreateTalentPoolBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const [created] = await db
      .insert(employerTalentPoolsTable)
      .values({
        employerId: params.data.id,
        name: body.data.name.trim(),
        description: body.data.description ?? "",
        createdBy: req.currentUser!.id,
      })
      .returning();
    res.status(201).json(serializePool(created, 0));
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      res.status(409).json({ error: "A pool with that name already exists." });
      return;
    }
    throw err;
  }
});

router.get(
  "/employers/:id/talent-pools/:poolId",
  async (req, res): Promise<void> => {
    const params = GetTalentPoolParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const employer = await authzEmployer(req, res, params.data.id);
    if (!employer) return;

    const [pool] = await db
      .select()
      .from(employerTalentPoolsTable)
      .where(
        and(
          eq(employerTalentPoolsTable.id, params.data.poolId),
          eq(employerTalentPoolsTable.employerId, params.data.id),
        ),
      );
    if (!pool) {
      res.status(404).json({ error: "Pool not found" });
      return;
    }
    const members = await loadPoolMembers(pool.id);
    res.json({ ...serializePool(pool, members.length), members });
  },
);

router.delete(
  "/employers/:id/talent-pools/:poolId",
  async (req, res): Promise<void> => {
    const params = DeleteTalentPoolParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const employer = await authzEmployer(req, res, params.data.id);
    if (!employer) return;
    const deleted = await db
      .delete(employerTalentPoolsTable)
      .where(
        and(
          eq(employerTalentPoolsTable.id, params.data.poolId),
          eq(employerTalentPoolsTable.employerId, params.data.id),
        ),
      )
      .returning({ id: employerTalentPoolsTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Pool not found" });
      return;
    }
    res.status(204).end();
  },
);

router.post(
  "/employers/:id/talent-pools/:poolId/members",
  async (req, res): Promise<void> => {
    const params = AddTalentPoolMembersParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const employer = await authzEmployer(req, res, params.data.id);
    if (!employer) return;

    const body = AddTalentPoolMembersBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const [pool] = await db
      .select()
      .from(employerTalentPoolsTable)
      .where(
        and(
          eq(employerTalentPoolsTable.id, params.data.poolId),
          eq(employerTalentPoolsTable.employerId, params.data.id),
        ),
      );
    if (!pool) {
      res.status(404).json({ error: "Pool not found" });
      return;
    }

    // Filter to candidates that actually exist before insert.
    const existing = await db
      .select({ id: candidatesTable.id })
      .from(candidatesTable)
      .where(inArray(candidatesTable.id, body.data.candidateIds));
    const validIds = existing.map((c) => c.id);

    if (validIds.length > 0) {
      await db
        .insert(employerTalentPoolMembersTable)
        .values(
          validIds.map((cid) => ({
            poolId: pool.id,
            candidateId: cid,
            tags: body.data.tags ?? [],
            addedBy: req.currentUser!.id,
          })),
        )
        .onConflictDoNothing({
          target: [
            employerTalentPoolMembersTable.poolId,
            employerTalentPoolMembersTable.candidateId,
          ],
        });
    }

    const members = await loadPoolMembers(pool.id);
    res.json({ ...serializePool(pool, members.length), members });
  },
);

router.delete(
  "/employers/:id/talent-pools/:poolId/members/:candidateId",
  async (req, res): Promise<void> => {
    const params = RemoveTalentPoolMemberParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const employer = await authzEmployer(req, res, params.data.id);
    if (!employer) return;

    // Verify pool belongs to employer first to avoid leaking existence.
    const [pool] = await db
      .select({ id: employerTalentPoolsTable.id })
      .from(employerTalentPoolsTable)
      .where(
        and(
          eq(employerTalentPoolsTable.id, params.data.poolId),
          eq(employerTalentPoolsTable.employerId, params.data.id),
        ),
      );
    if (!pool) {
      res.status(404).json({ error: "Pool not found" });
      return;
    }
    await db
      .delete(employerTalentPoolMembersTable)
      .where(
        and(
          eq(employerTalentPoolMembersTable.poolId, pool.id),
          eq(
            employerTalentPoolMembersTable.candidateId,
            params.data.candidateId,
          ),
        ),
      );
    res.status(204).end();
  },
);

// ---------------- Message templates ----------------

router.get(
  "/employers/:id/message-templates",
  async (req, res): Promise<void> => {
    const params = ListMessageTemplatesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const employer = await authzEmployer(req, res, params.data.id);
    if (!employer) return;

    const rows = await db
      .select()
      .from(employerMessageTemplatesTable)
      .where(eq(employerMessageTemplatesTable.employerId, params.data.id))
      .orderBy(desc(employerMessageTemplatesTable.createdAt));
    res.json(
      rows.map((t) => ({
        id: t.id,
        employerId: t.employerId,
        name: t.name,
        subject: t.subject,
        body: t.body,
        createdAt: t.createdAt.toISOString(),
      })),
    );
  },
);

router.post(
  "/employers/:id/message-templates",
  async (req, res): Promise<void> => {
    const params = CreateMessageTemplateParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const employer = await authzEmployer(req, res, params.data.id);
    if (!employer) return;

    const body = CreateMessageTemplateBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    try {
      const [created] = await db
        .insert(employerMessageTemplatesTable)
        .values({
          employerId: params.data.id,
          name: body.data.name.trim(),
          subject: body.data.subject ?? "",
          body: body.data.body,
          createdBy: req.currentUser!.id,
        })
        .returning();
      res.status(201).json({
        id: created.id,
        employerId: created.employerId,
        name: created.name,
        subject: created.subject,
        body: created.body,
        createdAt: created.createdAt.toISOString(),
      });
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        res
          .status(409)
          .json({ error: "A template with that name already exists." });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/employers/:id/message-templates/:templateId",
  async (req, res): Promise<void> => {
    const params = DeleteMessageTemplateParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const employer = await authzEmployer(req, res, params.data.id);
    if (!employer) return;
    await db
      .delete(employerMessageTemplatesTable)
      .where(
        and(
          eq(employerMessageTemplatesTable.id, params.data.templateId),
          eq(employerMessageTemplatesTable.employerId, params.data.id),
        ),
      );
    res.status(204).end();
  },
);

// ---------------- Outreach ----------------

function renderTemplate(
  tpl: string,
  vars: { firstName: string; jobTitle: string; employerName: string },
) {
  return tpl
    .replaceAll("{{firstName}}", vars.firstName)
    .replaceAll("{{jobTitle}}", vars.jobTitle)
    .replaceAll("{{employerName}}", vars.employerName);
}

function firstName(full: string): string {
  const t = (full ?? "").trim();
  if (!t) return "there";
  return t.split(/\s+/)[0]!;
}

router.post("/employers/:id/outreach", async (req, res): Promise<void> => {
  const params = SendOutreachParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const employer = await authzEmployer(req, res, params.data.id);
  if (!employer) return;

  const body = SendOutreachBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  // Resolve subject + body, either from the templateId or from inline fields.
  let subject = body.data.subject ?? "";
  let bodyTpl = body.data.body ?? "";
  if (body.data.templateId) {
    const [tpl] = await db
      .select()
      .from(employerMessageTemplatesTable)
      .where(
        and(
          eq(employerMessageTemplatesTable.id, body.data.templateId),
          eq(employerMessageTemplatesTable.employerId, params.data.id),
        ),
      );
    if (!tpl) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    subject = subject || tpl.subject;
    bodyTpl = bodyTpl || tpl.body;
  }
  if (!bodyTpl.trim()) {
    res.status(400).json({
      error: "Provide either templateId or a non-empty body.",
    });
    return;
  }

  // Resolve recipient candidate IDs (direct list ∪ pool members).
  const ids = new Set<number>(body.data.candidateIds ?? []);
  if (body.data.poolId) {
    const [pool] = await db
      .select({ id: employerTalentPoolsTable.id })
      .from(employerTalentPoolsTable)
      .where(
        and(
          eq(employerTalentPoolsTable.id, body.data.poolId),
          eq(employerTalentPoolsTable.employerId, params.data.id),
        ),
      );
    if (!pool) {
      res.status(404).json({ error: "Pool not found" });
      return;
    }
    const memberRows = await db
      .select({
        candidateId: employerTalentPoolMembersTable.candidateId,
      })
      .from(employerTalentPoolMembersTable)
      .where(eq(employerTalentPoolMembersTable.poolId, pool.id));
    for (const r of memberRows) ids.add(r.candidateId);
  }
  if (ids.size === 0) {
    res
      .status(400)
      .json({ error: "Provide at least one candidateId or a poolId." });
    return;
  }

  // Daily cap per employer. Computed once for the early-out path; the
  // authoritative count is recomputed inside the transaction below
  // under a per-employer advisory lock so concurrent sends cannot
  // exceed the cap.
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const [{ used: usedPreview }] = await db
    .select({
      used: sql<number>`count(*)::int`,
    })
    .from(employerOutreachMessagesTable)
    .where(
      and(
        eq(employerOutreachMessagesTable.employerId, params.data.id),
        gte(employerOutreachMessagesTable.sentAt, since),
      ),
    );
  if (Math.max(0, OUTREACH_DAILY_CAP - Number(usedPreview)) <= 0) {
    res.status(429).json({
      error: `Daily outreach cap of ${OUTREACH_DAILY_CAP} messages reached. Try again tomorrow.`,
    });
    return;
  }

  // Optional job context for {{jobTitle}}; must belong to the employer.
  let jobTitle = "";
  if (body.data.jobId) {
    const [job] = await db
      .select({ id: jobsTable.id, title: jobsTable.title })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.id, body.data.jobId),
          eq(jobsTable.employerId, params.data.id),
        ),
      );
    if (!job) {
      res.status(403).json({ error: "Job does not belong to this employer." });
      return;
    }
    jobTitle = job.title;
  }

  const recipients = await db
    .select({
      id: candidatesTable.id,
      fullName: candidatesTable.fullName,
    })
    .from(candidatesTable)
    .where(inArray(candidatesTable.id, Array.from(ids)));

  const renderedSubject = (name: string) =>
    renderTemplate(subject, {
      firstName: firstName(name),
      jobTitle,
      employerName: employer.name,
    });
  const renderedBody = (name: string) =>
    renderTemplate(bodyTpl, {
      firstName: firstName(name),
      jobTitle,
      employerName: employer.name,
    });

  // Atomic quota enforcement: take a per-employer transactional advisory
  // lock so concurrent sends from the same org serialize, then re-count
  // inside the transaction and only insert up to the remaining quota.
  // The lock is released automatically at COMMIT/ROLLBACK.
  const employerId = params.data.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${employerId})`);

    const [{ used }] = await tx
      .select({ used: sql<number>`count(*)::int` })
      .from(employerOutreachMessagesTable)
      .where(
        and(
          eq(employerOutreachMessagesTable.employerId, employerId),
          gte(employerOutreachMessagesTable.sentAt, since),
        ),
      );
    const remaining = Math.max(0, OUTREACH_DAILY_CAP - Number(used));
    if (remaining <= 0) {
      return { capped: true as const };
    }

    const allowed = recipients.slice(0, remaining);
    const skipped =
      Math.max(0, ids.size - recipients.length) +
      Math.max(0, recipients.length - allowed.length);

    if (allowed.length === 0) {
      return {
        capped: false as const,
        sent: 0,
        skipped,
        remainingToday: remaining,
      };
    }

    // Map candidate → user_id + email for notifications and email queue.
    // Candidates without a linked user account still get an outreach log
    // row but no in-app notification or email.
    const candUsers = await tx
      .select({
        userId: usersTable.id,
        email: usersTable.email,
        candidateId: usersTable.candidateId,
      })
      .from(usersTable)
      .where(
        inArray(
          usersTable.candidateId,
          allowed.map((a) => a.id),
        ),
      );
    const userByCandidate = new Map<
      number,
      { userId: number; email: string | null }
    >();
    for (const u of candUsers) {
      if (u.candidateId != null) {
        userByCandidate.set(u.candidateId, {
          userId: u.userId,
          email: u.email,
        });
      }
    }

    // Outreach opt-in: candidates marked openToOffers can receive emails.
    const candRows = await tx
      .select({
        id: candidatesTable.id,
        openToOffers: candidatesTable.openToOffers,
      })
      .from(candidatesTable)
      .where(
        inArray(
          candidatesTable.id,
          allowed.map((a) => a.id),
        ),
      );
    const openByCandidate = new Map<number, boolean>();
    for (const r of candRows) openByCandidate.set(r.id, r.openToOffers);

    await tx.insert(employerOutreachMessagesTable).values(
      allowed.map((c) => {
        const u = userByCandidate.get(c.id);
        // Queue an email when the candidate has a real account, an email
        // address, and has not opted out (openToOffers). The email
        // worker is not yet wired (followup #40); until then queued
        // rows stay queued and the in-app notification still delivers.
        const canEmail =
          !!u && !!u.email && (openByCandidate.get(c.id) ?? false);
        return {
          employerId,
          senderUserId: req.currentUser!.id,
          candidateId: c.id,
          poolId: body.data.poolId ?? null,
          templateId: body.data.templateId ?? null,
          subject: renderedSubject(c.fullName),
          body: renderedBody(c.fullName),
          deliveryStatus: (canEmail ? "queued" : "in_app") as
            | "queued"
            | "in_app",
        };
      }),
    );

    const notifRows = allowed
      .map((c) => {
        const u = userByCandidate.get(c.id);
        if (!u) return null;
        return {
          userId: u.userId,
          kind: "employer_outreach",
          title:
            renderedSubject(c.fullName) ||
            `Message from ${employer.name}`,
          body: renderedBody(c.fullName).slice(0, 280),
          // Candidate web dashboard surfaces notifications via the bell;
          // mobile app routes "/dashboard/candidate" link via the inbox.
          link: "/dashboard/candidate",
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (notifRows.length > 0) {
      await tx.insert(notificationsTable).values(notifRows);
    }

    return {
      capped: false as const,
      sent: allowed.length,
      skipped,
      remainingToday: Math.max(0, remaining - allowed.length),
    };
  });

  if (result.capped) {
    res.status(429).json({
      error: `Daily outreach cap of ${OUTREACH_DAILY_CAP} messages reached. Try again tomorrow.`,
    });
    return;
  }

  res.json({
    sent: result.sent,
    skipped: result.skipped,
    remainingToday: result.remainingToday,
  });
});

export default router;
