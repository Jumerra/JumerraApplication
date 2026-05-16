import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  candidatesTable,
  jobsTable,
  employersTable,
  experienceTable,
  educationTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import {
  aiCachedJson,
  AiRateLimitError,
  AiUnavailableError,
} from "../lib/ai-engagement";

const router: Router = Router();

function ensureOwnerOrAdmin(
  candidateId: number,
  user: { role: string; candidateId: number | null },
): boolean {
  if (user.role === "admin") return true;
  return user.role === "candidate" && user.candidateId === candidateId;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function handleAiError(req: { log: { error: (...a: unknown[]) => void } }, res: import("express").Response, err: unknown, label: string): void {
  if (err instanceof AiRateLimitError) {
    res
      .status(429)
      .json({ error: `Daily AI limit reached (${err.dailyLimit}). Try again tomorrow.` });
    return;
  }
  if (err instanceof AiUnavailableError) {
    res.status(503).json({ error: err.message });
    return;
  }
  req.log.error({ err }, `${label} failed`);
  res.status(500).json({ error: "AI request failed" });
}

router.post(
  "/candidates/:id/ai/cover-note",
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
      const jobId = Number((req.body ?? {}).jobId);
      if (!Number.isInteger(jobId) || jobId <= 0) {
        res.status(400).json({ error: "jobId required" });
        return;
      }

      const [candRow, jobRow] = await Promise.all([
        db
          .select()
          .from(candidatesTable)
          .where(eq(candidatesTable.id, candidateId))
          .limit(1),
        db
          .select({ job: jobsTable, employer: employersTable })
          .from(jobsTable)
          .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
          .where(eq(jobsTable.id, jobId))
          .limit(1),
      ]);
      const candidate = candRow[0];
      const job = jobRow[0]?.job;
      const employer = jobRow[0]?.employer;
      if (!candidate || !job || !employer) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const candCtx = {
        fullName: candidate.fullName,
        headline: candidate.headline,
        bio: candidate.bio,
        skills: candidate.skills,
        yearsExperience: candidate.yearsExperience,
      };
      const jobCtx = {
        title: job.title,
        employer: employer.name,
        description: job.description,
        skills: job.skills,
        requirements: job.requirements,
      };

      const result = await aiCachedJson<{ draft: string }>({
        candidateId,
        kind: "cover_note",
        keyParts: ["cover_note_v1", jobId, candidate.skills, candidate.yearsExperience],
        build: () => ({
          system:
            "You are a senior career coach helping early-career candidates apply for jobs. Write warm, specific, confident cover notes in the candidate's voice. No clichés, no apologies, no buzzword soup. Reference at least one concrete fact from the job description. Respond with raw JSON only — no markdown fences.",
          user: `Draft a 130-180 word cover note for the candidate below applying for the job below.

CANDIDATE:
${JSON.stringify(candCtx, null, 2)}

JOB:
${JSON.stringify(jobCtx, null, 2)}

Respond with JSON exactly:
{"draft": "..."}`,
        }),
        parser: (raw) => {
          if (!isObj(raw) || typeof raw.draft !== "string" || raw.draft.trim().length < 30) {
            throw new AiUnavailableError("AI returned an unusable draft");
          }
          return { draft: raw.draft.trim() };
        },
      });

      res.json({ draft: result.output.draft, fromCache: result.fromCache });
    } catch (err) {
      handleAiError(req, res, err, "ai cover-note");
    }
  },
);

router.post(
  "/candidates/:id/ai/interview-prep",
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
      const jobId = Number((req.body ?? {}).jobId);
      if (!Number.isInteger(jobId) || jobId <= 0) {
        res.status(400).json({ error: "jobId required" });
        return;
      }

      const [candRow, jobRow] = await Promise.all([
        db
          .select()
          .from(candidatesTable)
          .where(eq(candidatesTable.id, candidateId))
          .limit(1),
        db
          .select({ job: jobsTable, employer: employersTable })
          .from(jobsTable)
          .innerJoin(employersTable, eq(employersTable.id, jobsTable.employerId))
          .where(eq(jobsTable.id, jobId))
          .limit(1),
      ]);
      const candidate = candRow[0];
      const job = jobRow[0]?.job;
      const employer = jobRow[0]?.employer;
      if (!candidate || !job || !employer) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const result = await aiCachedJson<{
        questions: {
          question: string;
          scaffold: { situation: string; task: string; action: string; result: string };
        }[];
      }>({
        candidateId,
        kind: "interview_prep",
        keyParts: ["interview_prep_v1", jobId, candidate.skills, candidate.yearsExperience],
        build: () => ({
          system:
            "You are an interview coach. Produce realistic interview questions tailored to the role and the candidate's background, plus a STAR-method scaffold (Situation, Task, Action, Result) the candidate can fill in. Tone is concrete, kind, and practical. Respond with raw JSON only — no markdown fences.",
          user: `Generate exactly 5 interview practice questions for the candidate below interviewing for the role below. Mix one behavioural, one technical, one situational, one motivation, and one stretch question.

CANDIDATE:
${JSON.stringify(
  {
    headline: candidate.headline,
    skills: candidate.skills,
    yearsExperience: candidate.yearsExperience,
    bio: candidate.bio,
  },
  null,
  2,
)}

JOB:
${JSON.stringify(
  {
    title: job.title,
    employer: employer.name,
    description: job.description,
    requirements: job.requirements,
    skills: job.skills,
  },
  null,
  2,
)}

Respond with JSON exactly:
{"questions":[{"question":"...","scaffold":{"situation":"hint...","task":"hint...","action":"hint...","result":"hint..."}}, ...]}`,
        }),
        parser: (raw) => {
          if (!isObj(raw) || !Array.isArray(raw.questions)) {
            throw new AiUnavailableError("AI returned no questions");
          }
          const questions = raw.questions.slice(0, 8).flatMap((q) => {
            if (!isObj(q) || !isObj(q.scaffold)) return [];
            const question = asStr(q.question).trim();
            if (!question) return [];
            return [
              {
                question,
                scaffold: {
                  situation: asStr(q.scaffold.situation),
                  task: asStr(q.scaffold.task),
                  action: asStr(q.scaffold.action),
                  result: asStr(q.scaffold.result),
                },
              },
            ];
          });
          if (questions.length === 0) {
            throw new AiUnavailableError("AI returned no usable questions");
          }
          return { questions };
        },
      });

      res.json({
        questions: result.output.questions,
        fromCache: result.fromCache,
      });
    } catch (err) {
      handleAiError(req, res, err, "ai interview-prep");
    }
  },
);

router.post(
  "/candidates/:id/ai/cv-critique",
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

      const candRow = await db
        .select()
        .from(candidatesTable)
        .where(eq(candidatesTable.id, candidateId))
        .limit(1);
      const candidate = candRow[0];
      if (!candidate) {
        res.status(404).json({ error: "Candidate not found" });
        return;
      }

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

      const profileSnapshot = {
        h: candidate.headline,
        b: candidate.bio,
        s: candidate.skills,
        y: candidate.yearsExperience,
        e: experiences.map((x) => [x.title, x.company, x.startDate, x.endDate, x.description]),
        ed: education.map((x) => [x.institution, x.degree, x.fieldOfStudy, x.startYear, x.endYear]),
      };
      const profile = {
        headline: candidate.headline,
        bio: candidate.bio,
        skills: candidate.skills,
        yearsExperience: candidate.yearsExperience,
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

      const result = await aiCachedJson<{
        sections: {
          section: string;
          items: { severity: "info" | "suggestion" | "warning"; message: string; suggestion: string }[];
        }[];
        overall: string;
      }>({
        candidateId,
        kind: "cv_critique",
        keyParts: ["cv_critique_v2", profileSnapshot],
        build: () => ({
          system:
            "You are a frank but supportive CV reviewer for early-career candidates. Give specific, actionable feedback. Avoid generic platitudes. For each issue suggest a concrete rewrite. Respond with raw JSON only — no markdown fences.",
          user: `Critique this candidate profile / CV. Cover the sections that have content (Headline, Summary, Skills, Experience, Education). For each section produce 1-3 actionable items with severity ("info" | "suggestion" | "warning"). End with a single short "overall" sentence.

PROFILE:
${JSON.stringify(profile, null, 2)}

Respond with JSON exactly:
{"sections":[{"section":"Headline","items":[{"severity":"suggestion","message":"...","suggestion":"..."}]}], "overall":"..."}`,
        }),
        parser: (raw) => {
          if (!isObj(raw) || !Array.isArray(raw.sections)) {
            throw new AiUnavailableError("AI returned no sections");
          }
          const sections = raw.sections.slice(0, 10).flatMap((s) => {
            if (!isObj(s)) return [];
            const section = asStr(s.section).trim();
            const itemsRaw = Array.isArray(s.items) ? s.items : [];
            const items = itemsRaw.slice(0, 5).flatMap((it) => {
              if (!isObj(it)) return [];
              const sevRaw = asStr(it.severity).toLowerCase();
              const severity =
                sevRaw === "warning" || sevRaw === "info" || sevRaw === "suggestion"
                  ? (sevRaw as "info" | "suggestion" | "warning")
                  : "suggestion";
              const message = asStr(it.message).trim();
              const suggestion = asStr(it.suggestion).trim();
              if (!message) return [];
              return [{ severity, message, suggestion }];
            });
            if (!section || items.length === 0) return [];
            return [{ section, items }];
          });
          if (sections.length === 0) {
            throw new AiUnavailableError("AI returned no usable critique");
          }
          return {
            sections,
            overall: asStr(raw.overall).trim() || "Profile reviewed.",
          };
        },
      });

      res.json({
        sections: result.output.sections,
        overall: result.output.overall,
        fromCache: result.fromCache,
      });
    } catch (err) {
      handleAiError(req, res, err, "ai cv-critique");
    }
  },
);

export default router;
