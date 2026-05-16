#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Apply only the migrations checked into lib/db/drizzle/. This
# replaces the previous `drizzle-kit push` which silently diffed the
# live schema and could drop columns. New schema changes must be
# committed via `pnpm --filter @workspace/db generate` so they go
# through review.
pnpm --filter @workspace/db migrate
