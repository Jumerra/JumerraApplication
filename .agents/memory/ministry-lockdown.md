---
name: Ministry aggregate-only lockdown
description: Why ministry-role accounts need a global route allowlist, not per-endpoint gating
---

Ministry oversight accounts (role `ministry`, Ministry of Education / Labour) are an
**aggregate-statistics-only** account type — they must never see individual candidate
or application PII.

**Rule:** A logged-in `ministry` user is allowed ONLY on path prefixes `/ministry/*`
and `/auth/*`. Every other API path returns 403. This is enforced by a single global
gate mounted at the very top of the api-server router (before all business routes), not
by adding a denylist to each PII endpoint.

**Why:** The hot read paths (`/candidates`, `/applications`, etc.) were gated by
`requireAuth` only. A ministry account holds a valid session, so it passed those gates
and could read full candidate PII (email/phone/profile) — silently defeating the entire
"aggregate-only" guarantee. Per-endpoint denylists are easy to forget on the next new
route; an allowlist-by-default global gate fails closed for any route added later.

**How to apply:** If you add a route a ministry account legitimately needs, add its
prefix to the allowlist (`MINISTRY_ALLOWED_PREFIXES` in
`artifacts/api-server/src/middleware/require-auth.ts`). The gate caches the resolved
user on `req.currentUser`, and `requireAuth` reuses it, so authenticated requests still
do a single user lookup (anonymous requests do zero — the gate skips when no session).

**Known-accepted gap:** an admin can re-issue a setup/reset link to a disabled ministry
user whose ministry row was soft-deleted, reactivating the account. This is contained:
the lockdown 403s them on every non-ministry path and `requireMinistry` 403s them on the
dashboard (soft-deleted ministry), so a reactivated orphan account can do nothing.
