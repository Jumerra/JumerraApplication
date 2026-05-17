#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Apply only the migrations checked into lib/db/drizzle/. This
# replaces the previous `drizzle-kit push` which silently diffed the
# live schema and could drop columns. New schema changes must be
# committed via `pnpm --filter @workspace/db generate` so they go
# through review.
pnpm --filter @workspace/db migrate

# Run the api-server unit tests and the Playwright e2e suite in
# parallel. The two share no state at the process level — unit tests
# are pure vitest cases, the e2e suite boots its own api-server on
# port 8090 against the same DATABASE_URL but stamps every row with a
# per-run RUN_TAG (see e2e/helpers/env.ts) that globalTeardown
# LIKE-deletes — so wall-clock stays close to max(unit, e2e) instead
# of unit + e2e.
LOG_DIR=".local/post-merge-logs"
mkdir -p "$LOG_DIR"
UNIT_LOG="$LOG_DIR/unit-tests.log"
E2E_LOG="$LOG_DIR/e2e.log"
E2E_FAILURES="$LOG_DIR/e2e-failures.txt"
E2E_QUARANTINED="$LOG_DIR/e2e-quarantined.txt"
rm -f "$UNIT_LOG" "$E2E_LOG" "$E2E_FAILURES" "$E2E_QUARANTINED"

if [ -z "$DATABASE_URL" ]; then
  echo "✗ DATABASE_URL is required for post-merge automation (e2e suite needs a scratch Postgres)."
  echo "  Set DATABASE_URL to a non-production database and re-run."
  exit 1
fi

# Safety gate: the e2e suite seeds + LIKE-deletes rows. Refuse to run
# against anything that looks like production. The merge automation
# must point at a scratch / staging database. Either the URL itself
# must contain a non-prod marker, or the operator must explicitly
# opt in by setting E2E_DB_ALLOWED=1 (used by trusted CI envs whose
# DATABASE_URL host name doesn't carry a recognisable marker).
if [ "$E2E_DB_ALLOWED" != "1" ]; then
  # Lowercase comparison without requiring bash 4 (${var,,}).
  DB_URL_LC=$(printf '%s' "$DATABASE_URL" | tr '[:upper:]' '[:lower:]')
  case "$DB_URL_LC" in
    *prod*|*production*|*live*)
      echo "✗ DATABASE_URL appears to point at a production database."
      echo "  Refusing to run the e2e suite (it writes + LIKE-deletes rows)."
      echo "  Point post-merge at a scratch/staging DB, or set E2E_DB_ALLOWED=1"
      echo "  if you've confirmed this URL is safe."
      exit 1
      ;;
    *test*|*staging*|*dev*|*scratch*|*ephemeral*|*neon*|*replit*|*helium*|*localhost*|*127.0.0.1*)
      : # recognised non-prod marker, proceed
      ;;
    *)
      echo "✗ DATABASE_URL has no recognised non-prod marker (test/staging/dev/scratch/ephemeral/neon/replit/helium/localhost)."
      echo "  Refusing to run the e2e suite against an unknown database."
      echo "  Set E2E_DB_ALLOWED=1 to override after confirming it is non-production."
      exit 1
      ;;
  esac
fi

echo "→ Running api-server unit tests and Playwright e2e suite in parallel"
echo "  unit log: $UNIT_LOG"
echo "  e2e  log: $E2E_LOG"

(pnpm --filter @workspace/api-server test) >"$UNIT_LOG" 2>&1 &
UNIT_PID=$!

(E2E_FAILURE_OUT_DIR="$PWD/$LOG_DIR" pnpm test:e2e) >"$E2E_LOG" 2>&1 &
E2E_PID=$!

UNIT_STATUS=0
E2E_STATUS=0
wait "$UNIT_PID" || UNIT_STATUS=$?
wait "$E2E_PID" || E2E_STATUS=$?

if [ "$UNIT_STATUS" -eq 0 ]; then
  echo "✓ Unit tests passed"
else
  echo "✗ Unit tests failed (exit $UNIT_STATUS) — last 80 lines:"
  tail -n 80 "$UNIT_LOG"
fi

# A non-zero E2E exit is only a hard failure when at least one
# non-quarantined journey failed. Quarantined journeys (those whose
# spec calls `test.info().annotations.push({ type: "quarantine", ... })`)
# still run and still surface here, but they do not block the merge —
# that's the whole point of the quarantine list.
E2E_HARD_FAIL=0
if [ "$E2E_STATUS" -eq 0 ]; then
  echo "✓ E2E suite passed"
elif [ ! -s "$E2E_FAILURES" ] && [ -s "$E2E_QUARANTINED" ]; then
  echo "✓ E2E suite: only quarantined journeys failed (not blocking)"
  cat "$E2E_QUARANTINED"
else
  E2E_HARD_FAIL=1
  echo "✗ E2E suite failed (exit $E2E_STATUS) — last 80 lines of raw log:"
  tail -n 80 "$E2E_LOG"
  if [ -s "$E2E_QUARANTINED" ]; then
    echo ""
    echo "Quarantined journeys also failed (not contributing to exit code):"
    cat "$E2E_QUARANTINED"
  fi
fi

# Print the 7-day flaky-journey health report so quarantined tests
# don't sit in that state indefinitely. Best-effort: never fail the
# post-merge run on a reporting glitch. The same script is the one
# pasted into the weekly team review (see
# `pnpm --filter @workspace/scripts run flaky-report`).
if [ -s "$LOG_DIR/e2e-history.jsonl" ]; then
  echo ""
  echo "→ Flaky-journey health report (last 7 days)"
  pnpm --filter @workspace/scripts exec tsx ./src/flaky-report.ts \
    --history "$PWD/$LOG_DIR/e2e-history.jsonl" --days 7 \
    || echo "  (flaky-report failed to render — non-fatal)"
fi

if [ "$UNIT_STATUS" -ne 0 ] || [ "$E2E_HARD_FAIL" -ne 0 ]; then
  # Emit a compact, structured summary at the VERY END of stdout so it
  # lands in the agent's tail-into-context window (only the last ~10
  # lines of post-merge stdout surface to the Replit chat as a
  # notification). Without this, the 80-line raw-log tails above push
  # the structured failure list past the window and the chat user only
  # sees that "something failed" with no journey/request-id detail.
  # The Replit notification tail is small (~10 lines). Order these so
  # that if anything gets clipped, it's the journey detail (still on
  # disk) and NOT the suite-status + log-path lines, which the user
  # needs to know where to look.
  echo ""
  echo "POST-MERGE FAILED — summary:"
  if [ "$E2E_HARD_FAIL" -ne 0 ] && [ -s "$E2E_FAILURES" ]; then
    TOTAL_FAILS=$(wc -l <"$E2E_FAILURES" | tr -d ' ')
    echo "Top failing journeys (of $TOTAL_FAILS, with request-id where surfaced):"
    # Cap at 5 lines so the summary block fits the ~10-line tail
    # window even when both suites fail.
    head -n 5 "$E2E_FAILURES"
    if [ "$TOTAL_FAILS" -gt 5 ]; then
      echo "  …and $((TOTAL_FAILS - 5)) more"
    fi
  fi
  # Print the suite-status + log-path lines LAST so they're the most
  # likely to survive tail-window truncation in the chat notification.
  if [ "$UNIT_STATUS" -ne 0 ]; then
    echo "✗ unit tests failed (exit $UNIT_STATUS) — full log: $UNIT_LOG"
  fi
  if [ "$E2E_STATUS" -ne 0 ]; then
    echo "✗ e2e suite failed (exit $E2E_STATUS) — full log: $E2E_LOG ; journeys: $E2E_FAILURES"
  fi
  exit 1
fi

echo "✓ Post-merge checks passed"
