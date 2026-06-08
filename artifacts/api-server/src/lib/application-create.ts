import { and, desc, eq } from "drizzle-orm";
import {
  db,
  applicationsTable,
  applicationStatusHistoryTable,
  mockInterviewsTable,
} from "@workspace/db";
import { logger } from "./logger";

/**
 * Any drizzle executor — the singleton `db` or a transaction handle. Lets the
 * shared creation logic participate in a caller's transaction (e.g. auto-apply,
 * which needs the application + its log row to commit atomically).
 */
type DbExecutor = Pick<typeof db, "select" | "insert" | "update">;

/**
 * Look up the most recent finalised mock interview for (candidate, job) and
 * return its sub-scores. Used by `serializeApplication` (employer view) and by
 * the linker inside `createApplicationRecord`.
 */
export async function findLatestFinalisedMockInterview(
  candidateId: number,
  jobId: number,
): Promise<{
  id: number;
  scoreOverall: number;
  scoreTechnical: number;
  scoreCommunication: number;
  scoreCulture: number;
} | null> {
  const [row] = await db
    .select({
      id: mockInterviewsTable.id,
      scoreOverall: mockInterviewsTable.scoreOverall,
      scoreTechnical: mockInterviewsTable.scoreTechnical,
      scoreCommunication: mockInterviewsTable.scoreCommunication,
      scoreCulture: mockInterviewsTable.scoreCulture,
    })
    .from(mockInterviewsTable)
    .where(
      and(
        eq(mockInterviewsTable.candidateId, candidateId),
        eq(mockInterviewsTable.jobId, jobId),
        eq(mockInterviewsTable.status, "finalised"),
      ),
    )
    .orderBy(desc(mockInterviewsTable.completedAt))
    .limit(1);
  if (
    !row ||
    row.scoreOverall == null ||
    row.scoreTechnical == null ||
    row.scoreCommunication == null ||
    row.scoreCulture == null
  ) {
    return null;
  }
  return {
    id: row.id,
    scoreOverall: row.scoreOverall,
    scoreTechnical: row.scoreTechnical,
    scoreCommunication: row.scoreCommunication,
    scoreCulture: row.scoreCulture,
  };
}

export interface CreateApplicationInput {
  jobId: number;
  candidateId: number;
  source: string;
  matchScore: number;
  /** User id stamped on the initial status-history row; null for system/auto. */
  changedBy: number | null;
  coverNote?: string | null;
}

/**
 * Single source of truth for inserting a pipeline application. Both the manual
 * `POST /applications` route and the AI Auto-Apply engine go through here so the
 * core invariants stay identical: an `applications` row plus its seed "applied"
 * status-history milestone, plus a best-effort link of the most recent finalised
 * mock interview. Callers layer their own extra side-effects (auto-apply log
 * row, notifications) on top. Pass a transaction handle as `exec` to make the
 * insert atomic with the caller's other writes.
 */
export async function createApplicationRecord(
  exec: DbExecutor,
  input: CreateApplicationInput,
): Promise<number> {
  const [created] = await exec
    .insert(applicationsTable)
    .values({
      jobId: input.jobId,
      candidateId: input.candidateId,
      coverNote: input.coverNote ?? undefined,
      source: input.source,
      status: "applied",
      matchScore: input.matchScore,
    })
    .returning({ id: applicationsTable.id });
  const appId = created?.id;
  if (!appId) throw new Error("application insert returned no id");

  await exec.insert(applicationStatusHistoryTable).values({
    applicationId: appId,
    status: "applied",
    changedBy: input.changedBy,
  });

  // Best-effort: link the most recent finalised mock interview for this
  // (candidate, job) so its sub-scores surface in the employer Kanban. Never
  // block (or roll back) application creation on a linking failure.
  try {
    const mock = await findLatestFinalisedMockInterview(
      input.candidateId,
      input.jobId,
    );
    if (mock) {
      await exec
        .update(mockInterviewsTable)
        .set({ applicationId: appId })
        .where(eq(mockInterviewsTable.id, mock.id));
    }
  } catch (err) {
    logger.warn({ err }, "link mock interview to application failed");
  }

  return appId;
}
