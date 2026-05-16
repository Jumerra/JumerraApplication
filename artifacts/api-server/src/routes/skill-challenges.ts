import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  jobsTable,
  applicationsTable,
  applicationStatusHistoryTable,
  candidatesTable,
  challengeTemplatesTable,
  jobChallengesTable,
  applicationChallengesTable,
} from "@workspace/db";
import type { ChallengeQuestion } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { calculateMatchScore } from "../lib/matching";

const router: IRouter = Router();

/**
 * Build a default challenge from a job's skills by picking one
 * matching template per skill (case-insensitive, deduped). Falls
 * back to the "problem solving" template when no skill matches.
 */
export async function buildDefaultChallengeForSkills(
  skills: string[],
): Promise<{ questions: ChallengeQuestion[]; templateIds: number[] }> {
  const wantedSkills = Array.from(
    new Set(skills.map((s) => s.trim().toLowerCase()).filter(Boolean)),
  );
  const templates = await db.select().from(challengeTemplatesTable);
  if (templates.length === 0) {
    return { questions: [], templateIds: [] };
  }
  const picked: typeof templates = [];
  const seenSkills = new Set<string>();
  for (const skill of wantedSkills) {
    const match = templates.find(
      (t) => t.skill.toLowerCase() === skill && !seenSkills.has(t.skill),
    );
    if (match) {
      picked.push(match);
      seenSkills.add(match.skill);
    }
  }
  if (picked.length === 0) {
    const fallback =
      templates.find((t) => t.skill === "problem solving") ?? templates[0];
    if (fallback) picked.push(fallback);
  }
  // Cap to 6 questions total so the candidate experience stays short.
  const questions: ChallengeQuestion[] = [];
  const templateIds: number[] = [];
  for (const t of picked) {
    const qs = (t.questions as ChallengeQuestion[]) ?? [];
    for (const q of qs) {
      if (questions.length >= 6) break;
      questions.push(q);
    }
    templateIds.push(t.id);
    if (questions.length >= 6) break;
  }
  return { questions, templateIds };
}

/** Strip `correctIndex` from every question before returning to the candidate. */
function sanitiseQuestions(qs: ChallengeQuestion[]) {
  return qs.map((q, i) => ({
    index: i,
    prompt: q.prompt,
    options: q.options,
  }));
}

/** Score answers (array of chosen indices) against the answer key. Returns 0–100. */
function gradeAnswers(
  qs: ChallengeQuestion[],
  answers: unknown,
): { score: number; correct: number; total: number } {
  if (!Array.isArray(answers) || qs.length === 0) {
    return { score: 0, correct: 0, total: qs.length };
  }
  let correct = 0;
  for (let i = 0; i < qs.length; i += 1) {
    const a = answers[i];
    if (typeof a === "number" && a === qs[i]!.correctIndex) correct += 1;
  }
  const score = Math.round((correct / qs.length) * 100);
  return { score, correct, total: qs.length };
}

/**
 * GET /challenge-templates — employer-facing template picker.
 * Returns templates WITHOUT answer keys (so the same list can be
 * previewed safely in the post-job UI).
 */
router.get(
  "/challenge-templates",
  requireAuth,
  async (req, res): Promise<void> => {
    const me = req.currentUser!;
    if (me.role !== "employer" && me.role !== "admin") {
      res.status(403).json({ error: "Only employers may browse templates" });
      return;
    }
    const rows = await db.select().from(challengeTemplatesTable);
    res.json(
      rows.map((t) => ({
        id: t.id,
        skill: t.skill,
        title: t.title,
        description: t.description,
        questionCount: ((t.questions as ChallengeQuestion[]) ?? []).length,
        preview: sanitiseQuestions((t.questions as ChallengeQuestion[]) ?? []),
      })),
    );
  },
);

/**
 * GET /jobs/:id/challenge — candidate-facing fetch. Returns the
 * sanitised question set (no answer keys). 404 if the job has no
 * challenge attached.
 */
router.get("/jobs/:id/challenge", async (req, res): Promise<void> => {
  const jobId = Number(req.params.id);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const [ch] = await db
    .select()
    .from(jobChallengesTable)
    .where(eq(jobChallengesTable.jobId, jobId));
  if (!ch) {
    res.status(404).json({ error: "No challenge attached to this job" });
    return;
  }
  const qs = (ch.questions as ChallengeQuestion[]) ?? [];
  res.json({
    jobId,
    title: ch.title,
    passingScore: ch.passingScore,
    questions: sanitiseQuestions(qs),
  });
});

/**
 * PUT /jobs/:id/challenge — employer customise. Replaces the
 * question set. The body may supply either:
 *   - `templateIds: number[]` — regenerate from these templates, OR
 *   - `questions: ChallengeQuestion[]` — full custom snapshot.
 */
router.put(
  "/jobs/:id/challenge",
  requireAuth,
  async (req, res): Promise<void> => {
    const jobId = Number(req.params.id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const me = req.currentUser!;
    if (me.role !== "employer" && me.role !== "admin") {
      res.status(403).json({ error: "Only employers may edit challenges" });
      return;
    }
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (me.role === "employer" && job.employerId !== me.employerId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    let questions: ChallengeQuestion[] = [];
    let templateIds: number[] = [];
    const passingScore = Number(req.body?.passingScore ?? 50);
    const title = typeof req.body?.title === "string" && req.body.title.trim()
      ? req.body.title.trim()
      : "Skill challenge";

    if (Array.isArray(req.body?.questions) && req.body.questions.length > 0) {
      questions = (req.body.questions as unknown[])
        .filter(
          (q): q is ChallengeQuestion =>
            !!q &&
            typeof q === "object" &&
            typeof (q as ChallengeQuestion).prompt === "string" &&
            Array.isArray((q as ChallengeQuestion).options) &&
            typeof (q as ChallengeQuestion).correctIndex === "number",
        )
        .slice(0, 12);
    } else if (Array.isArray(req.body?.templateIds) && req.body.templateIds.length > 0) {
      templateIds = (req.body.templateIds as unknown[])
        .map((x) => Number(x))
        .filter((n) => Number.isInteger(n) && n > 0);
      if (templateIds.length > 0) {
        const templates = await db
          .select()
          .from(challengeTemplatesTable)
          .where(inArray(challengeTemplatesTable.id, templateIds));
        for (const t of templates) {
          for (const q of (t.questions as ChallengeQuestion[]) ?? []) {
            if (questions.length >= 8) break;
            questions.push(q);
          }
          if (questions.length >= 8) break;
        }
      }
    } else {
      const built = await buildDefaultChallengeForSkills(job.skills);
      questions = built.questions;
      templateIds = built.templateIds;
    }

    if (questions.length === 0) {
      res.status(400).json({ error: "Challenge must have at least one question" });
      return;
    }

    const [existing] = await db
      .select()
      .from(jobChallengesTable)
      .where(eq(jobChallengesTable.jobId, jobId));

    const values = {
      jobId,
      title,
      questions,
      passingScore: Number.isFinite(passingScore) ? passingScore : 50,
      templateIds,
    };

    let row;
    if (existing) {
      [row] = await db
        .update(jobChallengesTable)
        .set(values)
        .where(eq(jobChallengesTable.id, existing.id))
        .returning();
    } else {
      [row] = await db.insert(jobChallengesTable).values(values).returning();
    }

    res.json({
      jobId,
      title: row!.title,
      passingScore: row!.passingScore,
      questions: sanitiseQuestions(row!.questions as ChallengeQuestion[]),
    });
  },
);

/**
 * DELETE /jobs/:id/challenge — employer remove. Drops the challenge
 * so the job reverts to the legacy cover-note apply path.
 */
router.delete(
  "/jobs/:id/challenge",
  requireAuth,
  async (req, res): Promise<void> => {
    const jobId = Number(req.params.id);
    const me = req.currentUser!;
    if (me.role !== "employer" && me.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (me.role === "employer" && job.employerId !== me.employerId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await db.delete(jobChallengesTable).where(eq(jobChallengesTable.jobId, jobId));
    res.status(204).end();
  },
);

/**
 * POST /jobs/:id/challenge/submit — candidate submit. Grades the
 * answers server-side, creates (or updates) the application
 * atomically, and links the challenge submission to it. Returns
 * the score + the created/updated application id.
 */
router.post(
  "/jobs/:id/challenge/submit",
  requireAuth,
  async (req, res): Promise<void> => {
    const jobId = Number(req.params.id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const me = req.currentUser!;
    if (me.role !== "candidate" || !me.candidateId) {
      res.status(403).json({ error: "Only candidates may submit challenges" });
      return;
    }
    const candidateId = me.candidateId;

    const SubmitBody = z.object({
      answers: z
        .array(z.number().int().min(0).max(20))
        .min(1)
        .max(20),
      source: z.enum(["browse", "for_you"]).optional(),
    });
    const parsed = SubmitBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [ch] = await db
      .select()
      .from(jobChallengesTable)
      .where(eq(jobChallengesTable.jobId, jobId));
    if (!ch) {
      res.status(404).json({ error: "No challenge attached to this job" });
      return;
    }

    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    const [candidate] = await db
      .select()
      .from(candidatesTable)
      .where(eq(candidatesTable.id, candidateId));
    if (!job || !candidate) {
      res.status(404).json({ error: "Job or candidate not found" });
      return;
    }

    const qs = (ch.questions as ChallengeQuestion[]) ?? [];

    // Re-take guard: short-circuit BEFORE grading. We never grade
    // an incoming answer set after the first submission so the
    // endpoint can't be turned into an answer-mining oracle by
    // varying answers across retries.
    const [existingSubmission] = await db
      .select()
      .from(applicationChallengesTable)
      .where(
        and(
          eq(applicationChallengesTable.candidateId, candidateId),
          eq(applicationChallengesTable.jobId, jobId),
        ),
      );
    if (existingSubmission) {
      // Link to the candidate's application row if not already.
      let applicationId = existingSubmission.applicationId;
      if (applicationId == null) {
        const [existingApp] = await db
          .select({ id: applicationsTable.id })
          .from(applicationsTable)
          .where(
            and(
              eq(applicationsTable.jobId, jobId),
              eq(applicationsTable.candidateId, candidateId),
            ),
          );
        if (existingApp) {
          applicationId = existingApp.id;
          await db
            .update(applicationChallengesTable)
            .set({ applicationId })
            .where(eq(applicationChallengesTable.id, existingSubmission.id));
        }
      }
      res.status(200).json({
        applicationId: applicationId ?? 0,
        score: existingSubmission.score,
        correct: 0,
        total: qs.length,
        alreadySubmitted: true,
      });
      return;
    }

    // Grade only on first submission.
    const { score, correct, total } = gradeAnswers(qs, parsed.data.answers);
    const answersClean = parsed.data.answers.slice(0, qs.length);
    const source = parsed.data.source ?? "browse";
    const { score: matchScore } = calculateMatchScore(
      job.skills,
      candidate.skills,
      candidate.yearsExperience,
      candidate.talentScore,
    );

    // Atomic: app find-or-create + status history + challenge
    // submission share a single transaction, so a partial write
    // can't leave an orphan submission with no application.
    let applicationId: number;
    try {
      applicationId = await db.transaction(async (tx) => {
        const [existingApp] = await tx
          .select()
          .from(applicationsTable)
          .where(
            and(
              eq(applicationsTable.jobId, jobId),
              eq(applicationsTable.candidateId, candidateId),
            ),
          );
        let appId: number;
        if (existingApp) {
          appId = existingApp.id;
        } else {
          const [created] = await tx
            .insert(applicationsTable)
            .values({
              jobId,
              candidateId,
              coverNote: "",
              source,
              status: "applied",
              matchScore,
            })
            .returning();
          appId = created.id;
          await tx.insert(applicationStatusHistoryTable).values({
            applicationId: appId,
            status: "applied",
            changedBy: me.id,
          });
        }
        await tx.insert(applicationChallengesTable).values({
          applicationId: appId,
          candidateId,
          jobId,
          score,
          answers: answersClean,
        });
        return appId;
      });
    } catch (err) {
      // Race: another concurrent submission won. Re-read and
      // return the persisted score instead of double-inserting.
      const [latest] = await db
        .select()
        .from(applicationChallengesTable)
        .where(
          and(
            eq(applicationChallengesTable.candidateId, candidateId),
            eq(applicationChallengesTable.jobId, jobId),
          ),
        );
      if (latest) {
        res.status(200).json({
          applicationId: latest.applicationId ?? 0,
          score: latest.score,
          correct: 0,
          total: qs.length,
          alreadySubmitted: true,
        });
        return;
      }
      req.log.error({ err }, "challenge submit failed");
      res.status(500).json({ error: "Failed to submit challenge" });
      return;
    }

    res.status(201).json({
      applicationId,
      score,
      correct,
      total,
      alreadySubmitted: false,
    });
  },
);

export default router;
