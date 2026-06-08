---
name: Auto-apply write-path concurrency invariants
description: Locks that keep the AI auto-apply submitter race-safe (challenge gate + daily cap)
---

# Auto-apply write-path concurrency invariants

The auto-apply engine has two entry points that can run concurrently
(per-job fan-out on POST /jobs, and a periodic backstop pass), so its write
path must be race-safe on two independent invariants.

## 1. Never submit to a challenge-gated job

Rule: the submitter and every `job_challenges` writer must serialize on the
SAME `jobs`-row lock (`SELECT ... FROM jobs WHERE id=? FOR UPDATE` inside a
transaction); a job's default challenge must be created in the same transaction
as the job row.

**Why:** without a shared lock domain a challenge could be attached in the
window between the engine's gate re-check and its application insert, letting a
gated job receive an auto-submission.

## 2. Never exceed the per-candidate daily cap

Rule: the rolling-24h cap count AND the application/log insert must happen in
one transaction, guarded by a per-candidate `pg_advisory_xact_lock(namespace,
candidateId)` taken at the top of that transaction.

**Why:** the cap spans DIFFERENT jobs, so `UNIQUE(candidate_id, job_id)` does
not protect it. Two concurrent workers applying to two different jobs could each
read `used < cap` (count done outside the tx) and both insert, pushing the
candidate over the cap. The advisory lock forces all auto-apply writes for one
candidate to run one-at-a-time; it auto-releases on commit/rollback.

**How to apply:** lock order is always candidate-advisory → job-row. The only
other job-row `FOR UPDATE` holders (challenge mutations) never take the advisory
lock, so there is no lock-ordering inversion / deadlock. Cheap pre-filter
checks outside the tx are fine as early-outs but are advisory only — the
authoritative dedupe + cap checks must run inside the locked transaction.
