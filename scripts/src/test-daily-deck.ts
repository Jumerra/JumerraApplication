/**
 * Smoke test for the employer daily candidate deck (Task #79).
 *
 *   tsx scripts/src/test-daily-deck.ts
 *
 * Verifies:
 *   1. GET /me/daily-deck returns a ranked, capped list of candidates.
 *   2. POST /me/daily-deck/:id/shortlist creates the auto pool and adds the
 *      candidate, and the candidate is then excluded from future decks.
 *   3. POST /me/daily-deck/:id/dismiss persists the dismissal and the
 *      candidate is also excluded from future decks.
 *   4. Non-employer accounts are blocked with 403.
 */

import { and, eq } from "drizzle-orm";
import {
  db,
  candidatesTable,
  employersTable,
  employerDailyDecksTable,
  employerDismissedCandidatesTable,
  employerTalentPoolMembersTable,
  employerTalentPoolsTable,
  usersTable,
} from "@workspace/db";

const BASE = process.env.API_BASE ?? "http://localhost:80/api";

type DeckItem = { candidate: { id: number; fullName: string }; matchScore: number };
type DeckResp = { deckDate: string; openJobsCount: number; items: DeckItem[] };

let authToken = "";

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch {}
  if (path === "/auth/login" && json?.sessionToken) {
    authToken = json.sessionToken;
  }
  return { status: res.status, json };
}

function assert(cond: any, msg: string): asserts cond {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok:", msg);
}

async function loginAsEmployer(): Promise<number> {
  const [u] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.role, "employer"))
    .limit(1);
  if (!u) throw new Error("No employer user in DB to test with");
  if (!u.employerId) throw new Error("Employer user has no employerId");

  // Re-login via the auth endpoint — but bypass the password by
  // setting one we know. Reset to a known dev password (precomputed bcrypt
  // hash for "daily-deck-test-pw" so this script has no bcrypt dep).
  const hashed = "$2b$10$q0NSxxfJ.BkG5U9lRUWUVuH5ucz4V.bHfRPVyo.U.9C8GARlsLZlO";
  await db
    .update(usersTable)
    .set({ passwordHash: hashed, status: "active" })
    .where(eq(usersTable.id, u.id));

  const r = await api("POST", "/auth/login", {
    email: u.email,
    password: "daily-deck-test-pw",
  });
  assert(r.status === 200, `login as employer (${r.status})`);
  return u.employerId;
}

async function main() {
  console.log(`Testing daily-deck against ${BASE}`);
  const employerId = await loginAsEmployer();

  // Clean slate for this employer (idempotent test).
  await db.delete(employerDailyDecksTable).where(eq(employerDailyDecksTable.employerId, employerId));
  await db.delete(employerDismissedCandidatesTable).where(eq(employerDismissedCandidatesTable.employerId, employerId));
  const ownPools = await db.select({ id: employerTalentPoolsTable.id }).from(employerTalentPoolsTable).where(and(eq(employerTalentPoolsTable.employerId, employerId), eq(employerTalentPoolsTable.name, "Daily picks")));
  for (const p of ownPools) {
    await db.delete(employerTalentPoolMembersTable).where(eq(employerTalentPoolMembersTable.poolId, p.id));
    await db.delete(employerTalentPoolsTable).where(eq(employerTalentPoolsTable.id, p.id));
  }

  const r1 = await api("GET", "/me/daily-deck");
  assert(r1.status === 200, `GET /me/daily-deck (${r1.status})`);
  const deck = r1.json as DeckResp;
  assert(Array.isArray(deck.items), "deck has items array");
  assert(deck.items.length <= 10, `deck size capped at 10 (got ${deck.items.length})`);
  console.log(`  → deck size ${deck.items.length}, ${deck.openJobsCount} open jobs`);
  if (deck.items.length === 0) {
    console.warn("  (no candidates available — skipping mutation tests)");
    process.exit(0);
  }
  // Verify ordering descending by score.
  for (let i = 1; i < deck.items.length; i++) {
    assert(
      deck.items[i].matchScore <= deck.items[i - 1].matchScore,
      `deck sorted by matchScore desc at i=${i}`,
    );
  }

  const target = deck.items[0].candidate.id;

  // Shortlist.
  const r2 = await api("POST", `/me/daily-deck/${target}/shortlist`);
  assert(r2.status === 200 && r2.json?.ok && r2.json?.poolId, `shortlist ok (${r2.status})`);
  const memberRows = await db
    .select()
    .from(employerTalentPoolMembersTable)
    .where(and(eq(employerTalentPoolMembersTable.poolId, r2.json.poolId), eq(employerTalentPoolMembersTable.candidateId, target)));
  assert(memberRows.length === 1, "shortlisted candidate persisted in pool");

  // Dismiss someone else, if available.
  let dismissedId: number | null = null;
  if (deck.items.length > 1) {
    dismissedId = deck.items[1].candidate.id;
    const r3 = await api("POST", `/me/daily-deck/${dismissedId}/dismiss`, { reason: "test" });
    assert(r3.status === 200 && r3.json?.ok, `dismiss ok (${r3.status})`);
    const dismissRows = await db
      .select()
      .from(employerDismissedCandidatesTable)
      .where(and(eq(employerDismissedCandidatesTable.employerId, employerId), eq(employerDismissedCandidatesTable.candidateId, dismissedId)));
    assert(dismissRows.length === 1, "dismissal persisted");
  }

  // Re-fetch deck — shortlisted + dismissed must not reappear today.
  const r4 = await api("GET", "/me/daily-deck");
  assert(r4.status === 200, `re-fetch deck ok (${r4.status})`);
  const deck2 = r4.json as DeckResp;
  const ids = deck2.items.map((i) => i.candidate.id);
  assert(!ids.includes(target), "shortlisted candidate excluded from refreshed deck");
  if (dismissedId != null) {
    assert(!ids.includes(dismissedId), "dismissed candidate excluded from refreshed deck");
  }

  // Non-employer (candidate) must be blocked.
  const [cu] = await db.select().from(usersTable).where(eq(usersTable.role, "candidate")).limit(1);
  if (cu) {
    const hashed = "$2b$10$q0NSxxfJ.BkG5U9lRUWUVuH5ucz4V.bHfRPVyo.U.9C8GARlsLZlO";
    await db.update(usersTable).set({ passwordHash: hashed, status: "active" }).where(eq(usersTable.id, cu.id));
    authToken = "";
    const rl = await api("POST", "/auth/login", { email: cu.email, password: "daily-deck-test-pw" });
    assert(rl.status === 200, "login as candidate");
    const rf = await api("GET", "/me/daily-deck");
    assert(rf.status === 403, `candidate blocked from deck (${rf.status})`);
  }

  console.log("\nAll daily-deck tests passed");
  process.exit(0);
}

void candidatesTable;
void employersTable;
main().catch((err) => {
  console.error("test crashed:", err);
  process.exit(1);
});
