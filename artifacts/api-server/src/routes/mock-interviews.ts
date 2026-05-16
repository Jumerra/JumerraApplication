/**
 * AI mock interview per job.
 *
 * Flow:
 *   1. POST /me/mock-interviews { jobId } — generates 6–8 questions
 *      tuned to (job.skills, job.requirements, candidate experience),
 *      returns the row with `status='in_progress'`. If a row in
 *      progress already exists for this (candidate, job) it is
 *      returned as-is (idempotent resume).
 *   2. POST /me/mock-interviews/:id/answer { questionIndex, answer }
 *      — scores the answer 0–100 on technical / communication /
 *      culture, appends to `transcript`. Must answer in order.
 *   3. POST /me/mock-interviews/:id/finalise — averages sub-scores
 *      across answered questions, sets `scoreOverall`, marks
 *      `status='finalised'`. Transcript is immutable from here.
 *   4. GET /me/mock-interviews?jobId= — list candidate's interviews
 *      for a job (latest first); used by the job detail page to
 *      show "Already interviewed (87/100)".
 *   5. GET /me/mock-interviews/:id — fetch one (also visible to the
 *      employer that owns the linked application).
 *
 * Authorization: candidate-scoped via `req.currentUser.candidateId`.
 * Employer reads are gated through the application linkage.
 */

import { Router, type IRouter, type Response, type Request } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  applicationsTable,
  candidatesTable,
  db,
  employersTable,
  jobsTable,
  mockInterviewsTable,
  type MockInterview,
  type MockInterviewQuestion,
  type MockInterviewTranscriptEntry,
} from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import {
  AiRateLimitError,
  AiUnavailableError,
  aiCachedJson,
} from "../lib/ai-engagement";
import { ANTHROPIC_MODEL, getAnthropic } from "../aiClient";

const router: IRouter = Router();

// All routes require auth.
router.use("/me/mock-interviews", requireAuth);

// --- Helpers --------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function handleAiError(
  req: Request,
  res: Response,
  err: unknown,
  label: string,
): void {
  if (err instanceof AiRateLimitError) {
    res.status(429).json({
      error: `Daily AI limit reached (${err.dailyLimit}). Try again tomorrow.`,
    });
    return;
  }
  if (err instanceof AiUnavailableError) {
    res.status(503).json({ error: err.message });
    return;
  }
  req.log.error({ err }, `${label} failed`);
  res.status(500).json({ error: "AI request failed" });
}

function inferSeniority(years: number): "junior" | "mid" | "senior" {
  if (years >= 6) return "senior";
  if (years >= 2) return "mid";
  return "junior";
}

type QuestionFocus = MockInterviewQuestion["focus"];
const FOCUSES: QuestionFocus[] = ["technical", "communication", "culture"];

function serializeInterview(row: MockInterview): {
  id: number;
  candidateId: number;
  jobId: number;
  applicationId: number | null;
  status: string;
  questions: MockInterviewQuestion[];
  transcript: MockInterviewTranscriptEntry[];
  scoreOverall: number | null;
  scoreTechnical: number | null;
  scoreCommunication: number | null;
  scoreCulture: number | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
} {
  return {
    id: row.id,
    candidateId: row.candidateId,
    jobId: row.jobId,
    applicationId: row.applicationId ?? null,
    status: row.status,
    questions: (row.questions as MockInterviewQuestion[] | null) ?? [],
    transcript:
      (row.transcript as MockInterviewTranscriptEntry[] | null) ?? [],
    scoreOverall: row.scoreOverall ?? null,
    scoreTechnical: row.scoreTechnical ?? null,
    scoreCommunication: row.scoreCommunication ?? null,
    scoreCulture: row.scoreCulture ?? null,
    summary: row.summary ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

// --- Question generation --------------------------------------------------

async function generateQuestionsForJob(
  candidateId: number,
  candidate: { yearsExperience: number; headline: string; skills: string[] },
  job: {
    id: number;
    title: string;
    description: string;
    skills: string[];
    requirements: string[];
  },
  employerName: string,
): Promise<MockInterviewQuestion[]> {
  const seniority = inferSeniority(candidate.yearsExperience);
  // Cache is candidate-scoped (the helper enforces that), but the
  // KEY only depends on (jobId, seniority, rubricVersion) so a single
  // candidate retaking the same job gets the same questions —
  // important for fair retake comparisons within a day.
  const result = await aiCachedJson<{ questions: MockInterviewQuestion[] }>({
    candidateId,
    kind: "mock_interview_questions",
    keyParts: ["mock_interview_v1", job.id, seniority],
    build: () => ({
      system:
        "You are an expert interview designer for early-career hiring. Produce a focused, fair, role-specific mock interview. Mix technical, communication, and culture/motivation questions in proportion to the role. Keep each question concrete and answerable in 2–4 minutes by an early-career candidate. Respond with raw JSON only — no markdown fences.",
      user: `Design a 6-question mock interview for the role below, calibrated for a ${seniority} candidate.

ROLE:
${JSON.stringify(
  {
    title: job.title,
    employer: employerName,
    description: job.description.slice(0, 1200),
    skills: job.skills,
    requirements: job.requirements,
  },
  null,
  2,
)}

REQUIREMENTS:
- Exactly 6 questions.
- Each question has a focus: "technical" | "communication" | "culture".
- Roughly: 3 technical, 2 communication, 1 culture (adjust slightly if the role is non-technical, but stay in those categories).
- Tag each focus accurately so server scoring uses the right rubric.

Respond with JSON exactly:
{"questions":[{"id":1,"text":"...","focus":"technical"}, ...]}`,
    }),
    parser: (raw) => {
      if (!isObj(raw) || !Array.isArray(raw.questions)) {
        throw new AiUnavailableError("AI returned no questions");
      }
      const questions = raw.questions.flatMap((q, i): MockInterviewQuestion[] => {
        if (!isObj(q)) return [];
        const text = asStr(q.text).trim();
        if (!text) return [];
        const focusRaw = asStr(q.focus).toLowerCase();
        const focus: QuestionFocus = (FOCUSES as string[]).includes(focusRaw)
          ? (focusRaw as QuestionFocus)
          : "technical";
        return [{ id: i + 1, text, focus }];
      });
      if (questions.length < 4) {
        throw new AiUnavailableError(
          `AI returned ${questions.length} usable questions; expected at least 4`,
        );
      }
      // Cap at 8 — never let the model bloat the interview.
      return { questions: questions.slice(0, 8) };
    },
  });
  return result.output.questions;
}

// --- Per-answer scoring ---------------------------------------------------

type AnswerScore = {
  technical: number;
  communication: number;
  culture: number;
  feedback: string;
};

async function scoreAnswer(args: {
  candidateId: number;
  jobTitle: string;
  question: MockInterviewQuestion;
  answer: string;
}): Promise<AnswerScore> {
  // Score is keyed by (jobTitle, question text, answer text). Identical
  // re-submits hit the cache; new attempts (different answer text)
  // burn quota.
  const result = await aiCachedJson<AnswerScore>({
    candidateId: args.candidateId,
    kind: "mock_interview_answer",
    keyParts: [
      "mock_answer_v1",
      args.jobTitle,
      args.question.focus,
      args.question.text,
      args.answer,
    ],
    build: () => ({
      system:
        "You are a fair, calibrated interview scorer. Score the candidate's answer 0–100 on three axes: technical correctness/depth, communication clarity, and culture/motivation signal. Be honest but constructive. Anchor: 0=nothing useful, 50=passable but generic, 75=solid early-career, 90+=standout. Provide a 1–2 sentence feedback note. Respond with raw JSON only — no markdown fences.",
      user: `ROLE: ${args.jobTitle}
QUESTION FOCUS: ${args.question.focus}
QUESTION: ${args.question.text}
CANDIDATE ANSWER:
${args.answer.slice(0, 4000)}

Respond with JSON exactly:
{"technical": <0-100>, "communication": <0-100>, "culture": <0-100>, "feedback": "..."}`,
    }),
    parser: (raw) => {
      if (!isObj(raw)) {
        throw new AiUnavailableError("AI returned no score");
      }
      const t = asNum(raw.technical);
      const c = asNum(raw.communication);
      const k = asNum(raw.culture);
      if (t == null || c == null || k == null) {
        throw new AiUnavailableError("AI returned non-numeric scores");
      }
      return {
        technical: clamp(t),
        communication: clamp(c),
        culture: clamp(k),
        feedback: asStr(raw.feedback).trim().slice(0, 600) || "—",
      };
    },
  });
  return result.output;
}

// --- Aggregation ----------------------------------------------------------

/**
 * Weighted aggregate over the transcript, biasing each sub-score by
 * the focus of the question it came from (a technical question's
 * `technical` score counts more heavily). Then `scoreOverall` is a
 * fixed 50/30/20 weighting of (technical, communication, culture).
 *
 * Exported for unit testing.
 */
export function aggregateScores(
  transcript: MockInterviewTranscriptEntry[],
): {
  scoreTechnical: number;
  scoreCommunication: number;
  scoreCulture: number;
  scoreOverall: number;
} | null {
  if (transcript.length === 0) return null;
  // Per-axis weighted average. The question's focus gets weight 2,
  // the other axes weight 1 — so a technical question contributes
  // more to the technical aggregate than to communication.
  const sums: Record<QuestionFocus, number> = {
    technical: 0,
    communication: 0,
    culture: 0,
  };
  const weights: Record<QuestionFocus, number> = {
    technical: 0,
    communication: 0,
    culture: 0,
  };
  for (const entry of transcript) {
    const focus: QuestionFocus | null = (FOCUSES as string[]).includes(
      entry.focus,
    )
      ? entry.focus
      : null;
    for (const axis of FOCUSES) {
      const w = focus === axis ? 2 : 1;
      sums[axis] += entry.scores[axis] * w;
      weights[axis] += w;
    }
  }
  const scoreTechnical = clamp(sums.technical / Math.max(1, weights.technical));
  const scoreCommunication = clamp(
    sums.communication / Math.max(1, weights.communication),
  );
  const scoreCulture = clamp(sums.culture / Math.max(1, weights.culture));
  const scoreOverall = clamp(
    scoreTechnical * 0.5 + scoreCommunication * 0.3 + scoreCulture * 0.2,
  );
  return { scoreTechnical, scoreCommunication, scoreCulture, scoreOverall };
}

async function generateSummary(args: {
  jobTitle: string;
  scores: {
    scoreOverall: number;
    scoreTechnical: number;
    scoreCommunication: number;
    scoreCulture: number;
  };
  transcript: MockInterviewTranscriptEntry[];
}): Promise<string> {
  // Best-effort summary; if AI is unavailable we synthesise a fallback
  // so finalise never fails on summary alone.
  try {
    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      system:
        "You are a fair interview reviewer. Write a 2-3 sentence wrap-up of the candidate's mock-interview performance. Specific, kind, no clichés. Plain text only — no markdown.",
      messages: [
        {
          role: "user",
          content: `Role: ${args.jobTitle}
Final scores — Overall ${args.scores.scoreOverall}, Technical ${args.scores.scoreTechnical}, Communication ${args.scores.scoreCommunication}, Culture ${args.scores.scoreCulture}.

Per-answer feedback:
${args.transcript
  .map(
    (t, i) =>
      `${i + 1}. (${t.scores.technical}/${t.scores.communication}/${t.scores.culture}) ${t.feedback}`,
  )
  .join("\n")}`,
        },
      ],
    });
    const block = response.content[0];
    const text = block && block.type === "text" ? block.text.trim() : "";
    if (text) return text.slice(0, 800);
  } catch {
    // fall through
  }
  return `Overall ${args.scores.scoreOverall}/100 — strongest in ${
    args.scores.scoreTechnical >= args.scores.scoreCommunication &&
    args.scores.scoreTechnical >= args.scores.scoreCulture
      ? "technical depth"
      : args.scores.scoreCommunication >= args.scores.scoreCulture
        ? "communication"
        : "culture/motivation"
  }.`;
}

// --- Routes ---------------------------------------------------------------

async function loadJobAndCandidate(jobId: number, candidateId: number) {
  const [candRow, jobRow] = await Promise.all([
    db
      .select()
      .from(candidatesTable)
      .where(eq(candidatesTable.id, candidateId))
      .limit(1),
    db
      .select({ job: jobsTable, employer: employersTable })
      .from(jobsTable)
      .innerJoin(
        employersTable,
        eq(employersTable.id, jobsTable.employerId),
      )
      .where(eq(jobsTable.id, jobId))
      .limit(1),
  ]);
  return {
    candidate: candRow[0] ?? null,
    job: jobRow[0]?.job ?? null,
    employer: jobRow[0]?.employer ?? null,
  };
}

router.get("/me/mock-interviews", async (req, res) => {
  const me = req.currentUser!;
  if (me.role !== "candidate" || me.candidateId == null) {
    res.status(403).json({ error: "Candidate-only" });
    return;
  }
  const jobIdRaw = req.query.jobId;
  const jobId = jobIdRaw ? Number(jobIdRaw) : NaN;
  const conditions = [eq(mockInterviewsTable.candidateId, me.candidateId)];
  if (Number.isInteger(jobId) && jobId > 0) {
    conditions.push(eq(mockInterviewsTable.jobId, jobId));
  }
  const rows = await db
    .select()
    .from(mockInterviewsTable)
    .where(and(...conditions))
    .orderBy(desc(mockInterviewsTable.createdAt))
    .limit(50);
  res.json({ items: rows.map(serializeInterview) });
});

router.get("/me/mock-interviews/:id", async (req, res) => {
  const me = req.currentUser!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(mockInterviewsTable)
    .where(eq(mockInterviewsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Candidates can read their own; admins see anything; employers
  // can read interviews linked to applications on their own jobs.
  if (me.role === "candidate" && me.candidateId === row.candidateId) {
    res.json(serializeInterview(row));
    return;
  }
  if (me.role === "admin") {
    res.json(serializeInterview(row));
    return;
  }
  if (me.role === "employer" && me.employerId != null) {
    // Employer access requires the interview to be linked to an
    // application on one of THIS employer's jobs. Without the
    // applicationId linkage we'd leak transcripts taken before the
    // candidate ever applied (or never applied at all) — that's
    // PII the candidate never consented to share with this employer.
    if (row.applicationId == null) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    const [link] = await db
      .select({ employerId: jobsTable.employerId })
      .from(applicationsTable)
      .innerJoin(jobsTable, eq(jobsTable.id, applicationsTable.jobId))
      .where(eq(applicationsTable.id, row.applicationId))
      .limit(1);
    if (link?.employerId === me.employerId) {
      res.json(serializeInterview(row));
      return;
    }
  }
  res.status(403).json({ error: "Not allowed" });
});

router.post("/me/mock-interviews", async (req, res) => {
  const me = req.currentUser!;
  if (me.role !== "candidate" || me.candidateId == null) {
    res.status(403).json({ error: "Candidate-only" });
    return;
  }
  const candidateId = me.candidateId;
  const jobId = Number((req.body ?? {}).jobId);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    res.status(400).json({ error: "jobId required" });
    return;
  }

  // Idempotent resume — return any existing in-progress interview
  // rather than burning quota generating a duplicate set.
  const [existing] = await db
    .select()
    .from(mockInterviewsTable)
    .where(
      and(
        eq(mockInterviewsTable.candidateId, candidateId),
        eq(mockInterviewsTable.jobId, jobId),
        eq(mockInterviewsTable.status, "in_progress"),
      ),
    )
    .limit(1);
  if (existing) {
    res.status(200).json(serializeInterview(existing));
    return;
  }

  // Retake policy: candidates get one initial attempt + one retake.
  // Once two finalised attempts exist for this (candidate, job),
  // refuse to start another. Abandoned rows don't count toward the
  // cap so a network drop doesn't cost the candidate an attempt.
  const finalisedRows = await db
    .select({ id: mockInterviewsTable.id })
    .from(mockInterviewsTable)
    .where(
      and(
        eq(mockInterviewsTable.candidateId, candidateId),
        eq(mockInterviewsTable.jobId, jobId),
        eq(mockInterviewsTable.status, "finalised"),
      ),
    );
  if (finalisedRows.length >= 2) {
    res.status(409).json({
      error:
        "You've already used your retake for this job. Mock interviews are limited to two attempts per job.",
      code: "retake_limit_reached",
    });
    return;
  }

  const { candidate, job, employer } = await loadJobAndCandidate(
    jobId,
    candidateId,
  );
  if (!candidate || !job || !employer) {
    res.status(404).json({ error: "Job or candidate not found" });
    return;
  }

  try {
    const questions = await generateQuestionsForJob(
      candidateId,
      {
        yearsExperience: candidate.yearsExperience,
        headline: candidate.headline,
        skills: candidate.skills,
      },
      {
        id: job.id,
        title: job.title,
        description: job.description,
        skills: job.skills,
        requirements: job.requirements,
      },
      employer.name,
    );
    try {
      const [created] = await db
        .insert(mockInterviewsTable)
        .values({
          candidateId,
          jobId,
          status: "in_progress",
          rubricVersion: "v1",
          rubric: {
            version: "v1",
            axes: [
              {
                key: "technical",
                weight: 0.5,
                criteria:
                  "Depth of role-relevant technical knowledge; correctness; concrete examples.",
              },
              {
                key: "communication",
                weight: 0.3,
                criteria:
                  "Clarity, structure, conciseness; explains trade-offs without jargon.",
              },
              {
                key: "culture",
                weight: 0.2,
                criteria:
                  "Motivation, ownership, collaboration signals appropriate for early-career.",
              },
            ],
          },
          questions,
          transcript: [],
        })
        .returning();
      res.status(201).json(serializeInterview(created));
    } catch (insertErr) {
      // Race: a concurrent start created the in-progress row between
      // our pre-check and our insert. The partial unique index
      // `mock_interviews_one_in_progress_per_job` rejects ours with
      // SQLSTATE 23505. Resolve by returning the winning row instead
      // of bubbling a 500.
      const code =
        insertErr && typeof insertErr === "object"
          ? ((insertErr as { code?: string }).code ?? "")
          : "";
      if (code === "23505") {
        const [winner] = await db
          .select()
          .from(mockInterviewsTable)
          .where(
            and(
              eq(mockInterviewsTable.candidateId, candidateId),
              eq(mockInterviewsTable.jobId, jobId),
              eq(mockInterviewsTable.status, "in_progress"),
            ),
          )
          .limit(1);
        if (winner) {
          res.status(200).json(serializeInterview(winner));
          return;
        }
      }
      throw insertErr;
    }
  } catch (err) {
    handleAiError(req, res, err, "mock-interview start");
  }
});

router.post("/me/mock-interviews/:id/answer", async (req, res) => {
  const me = req.currentUser!;
  if (me.role !== "candidate" || me.candidateId == null) {
    res.status(403).json({ error: "Candidate-only" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = req.body ?? {};
  const questionIndex = Number(body.questionIndex);
  const answer = asStr(body.answer).trim();
  if (!Number.isInteger(questionIndex) || questionIndex < 0) {
    res.status(400).json({ error: "questionIndex required" });
    return;
  }
  if (answer.length < 5) {
    res.status(400).json({ error: "Answer is too short" });
    return;
  }
  if (answer.length > 6000) {
    res.status(400).json({ error: "Answer is too long (6000 char max)" });
    return;
  }

  const [row] = await db
    .select()
    .from(mockInterviewsTable)
    .where(eq(mockInterviewsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (row.candidateId !== me.candidateId) {
    res.status(403).json({ error: "Not allowed" });
    return;
  }
  if (row.status !== "in_progress") {
    res.status(409).json({ error: "Interview is not in progress" });
    return;
  }

  const questions = (row.questions as MockInterviewQuestion[] | null) ?? [];
  const transcript =
    (row.transcript as MockInterviewTranscriptEntry[] | null) ?? [];
  if (questionIndex !== transcript.length) {
    res.status(409).json({
      error: `Out-of-order answer: expected questionIndex ${transcript.length}`,
    });
    return;
  }
  const question = questions[questionIndex];
  if (!question) {
    res.status(400).json({ error: "questionIndex out of range" });
    return;
  }

  const [job] = await db
    .select({ title: jobsTable.title })
    .from(jobsTable)
    .where(eq(jobsTable.id, row.jobId))
    .limit(1);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  try {
    const score = await scoreAnswer({
      candidateId: me.candidateId,
      jobTitle: job.title,
      question,
      answer,
    });
    const newEntry: MockInterviewTranscriptEntry = {
      questionIndex,
      question: question.text,
      answer,
      focus: question.focus,
      scores: {
        technical: score.technical,
        communication: score.communication,
        culture: score.culture,
      },
      feedback: score.feedback,
      answeredAt: new Date().toISOString(),
    };
    const newTranscript = [...transcript, newEntry];
    const [updated] = await db
      .update(mockInterviewsTable)
      .set({ transcript: newTranscript, updatedAt: new Date() })
      .where(eq(mockInterviewsTable.id, id))
      .returning();
    res.json({
      interview: serializeInterview(updated),
      lastAnswer: newEntry,
      done: newTranscript.length >= questions.length,
    });
  } catch (err) {
    handleAiError(req, res, err, "mock-interview answer");
  }
});

router.post("/me/mock-interviews/:id/finalise", async (req, res) => {
  const me = req.currentUser!;
  if (me.role !== "candidate" || me.candidateId == null) {
    res.status(403).json({ error: "Candidate-only" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(mockInterviewsTable)
    .where(eq(mockInterviewsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (row.candidateId !== me.candidateId) {
    res.status(403).json({ error: "Not allowed" });
    return;
  }
  if (row.status === "finalised") {
    res.status(200).json(serializeInterview(row));
    return;
  }
  if (row.status !== "in_progress") {
    res.status(409).json({ error: "Cannot finalise" });
    return;
  }
  const transcript =
    (row.transcript as MockInterviewTranscriptEntry[] | null) ?? [];
  if (transcript.length === 0) {
    res.status(400).json({ error: "Answer at least one question first" });
    return;
  }
  const agg = aggregateScores(transcript);
  if (!agg) {
    res.status(400).json({ error: "No scored answers" });
    return;
  }

  const [job] = await db
    .select({ title: jobsTable.title })
    .from(jobsTable)
    .where(eq(jobsTable.id, row.jobId))
    .limit(1);
  const summary = await generateSummary({
    jobTitle: job?.title ?? "this role",
    scores: agg,
    transcript,
  });

  const [finalRow] = await db
    .update(mockInterviewsTable)
    .set({
      status: "finalised",
      scoreOverall: agg.scoreOverall,
      scoreTechnical: agg.scoreTechnical,
      scoreCommunication: agg.scoreCommunication,
      scoreCulture: agg.scoreCulture,
      summary,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(mockInterviewsTable.id, id))
    .returning();

  // If the candidate already submitted an application for this job
  // BEFORE finalising, retro-link the latest interview onto it. The
  // standard direction (apply after interview) is handled in
  // routes/applications.ts.
  const [existingApp] = await db
    .select()
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.jobId, finalRow.jobId),
        eq(applicationsTable.candidateId, finalRow.candidateId),
      ),
    )
    .limit(1);
  if (existingApp) {
    await db
      .update(mockInterviewsTable)
      .set({ applicationId: existingApp.id })
      .where(eq(mockInterviewsTable.id, finalRow.id));
    finalRow.applicationId = existingApp.id;
  }

  res.json(serializeInterview(finalRow));
});

export default router;
