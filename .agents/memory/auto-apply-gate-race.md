---
name: Auto-apply challenge-gate race
description: How challenge-gating is kept race-safe against the AI auto-apply submitter
---

# Auto-apply challenge-gate race

Rule: every writer to `job_challenges` for a given job AND the auto-apply
submitter must serialize on the SAME Postgres `jobs`-row lock
(`SELECT ... FROM jobs WHERE id=? FOR UPDATE` inside a transaction), and a job's
default challenge must be created in the SAME transaction as the job row.

**Why:** AI auto-apply must never submit to a challenge-gated job. Without a
shared lock domain a challenge could be attached/removed in the window between
the engine's gate re-check and its application insert, or the periodic pass
could observe a freshly committed job before its default challenge row existed —
both let a gated job receive an auto-submission.

**How to apply:**
- The auto-apply submitter locks the job row, re-checks `job_challenges` inside
  its write transaction, and aborts the submission if a challenge exists.
- Any challenge mutation endpoint (attach/remove/edit) must take the same job-row
  `FOR UPDATE` lock inside a transaction before touching `job_challenges`.
- Job creation that auto-attaches a default challenge must insert the job AND the
  challenge in one transaction, and only fire the auto-apply fan-out after commit.
