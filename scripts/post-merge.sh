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
rm -f "$UNIT_LOG" "$E2E_LOG" "$E2E_FAILURES"

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
    *test*|*staging*|*dev*|*scratch*|*ephemeral*|*neon*|*replit*|*localhost*|*127.0.0.1*)
      : # recognised non-prod marker, proceed
      ;;
    *)
      echo "✗ DATABASE_URL has no recognised non-prod marker (test/staging/dev/scratch/ephemeral/neon/replit/localhost)."
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

if [ "$E2E_STATUS" -eq 0 ]; then
  echo "✓ E2E suite passed"
else
  echo "✗ E2E suite failed (exit $E2E_STATUS)"
  if [ -s "$E2E_FAILURES" ]; then
    echo "Failing journeys (with request-id where the API surfaced one):"
    cat "$E2E_FAILURES"
  else
    echo "No structured failure summary written — last 80 lines of raw log:"
    tail -n 80 "$E2E_LOG"
  fi
fi

if [ "$UNIT_STATUS" -ne 0 ] || [ "$E2E_STATUS" -ne 0 ]; then
  exit 1
fi

echo "✓ Post-merge checks passed"
