# Threat Model

## Project Overview

Jumerra is a pnpm monorepo for an early-career hiring platform. It has an Express API (`artifacts/api-server`) backed by PostgreSQL/Drizzle, a React web app (`artifacts/talent-platform`), and an Expo mobile app (`artifacts/talent-mobile`). Web authentication is session-based with `express-session`; the mobile app currently consumes the same backend without a real user auth flow. The platform stores candidate profiles, application pipeline data, employer and institution records, staff memberships, and admin review workflows.

Production assumptions for this repository:
- `NODE_ENV` is `production` in deployed environments.
- Replit terminates TLS for deployed traffic.
- `artifacts/mockup-sandbox` is dev-only and should not be treated as production-reachable unless future scans prove otherwise.
- Build scripts and local tooling paths are out of scope unless runtime reachability is demonstrated.

## Assets

- **User accounts and sessions** — authenticated web sessions, password hashes, password-setup/reset tokens, and org-role assignments. Compromise enables account takeover and privilege abuse.
- **Candidate personal data** — names, email addresses, phone numbers, education, work history, certifications, affiliations, availability, and talent scores. This is directly sensitive personal and placement data.
- **Hiring workflow data** — applications, cover notes, match scores, status progression, hires, dashboard aggregates, and student placement metrics. Exposure or tampering harms both users and institutions/employers.
- **Organization records** — employer, institution, job-posting, and staff-membership data. Unauthorized modification can falsify marketplace content and break tenant boundaries.
- **Administrative review data** — pending registration submissions, approval decisions, and onboarding flows. This controls who joins the platform and under which organization.
- **Application secrets** — `SESSION_SECRET`, database credentials, and any future email-provider credentials.

## Trust Boundaries

- **Browser/mobile client to API** — all request bodies, params, headers, and IDs from web or mobile clients are untrusted and must never define authorization by themselves.
- **API to PostgreSQL** — the API has broad read/write access to platform data. Any missing authn/authz or unsafe query logic at the API layer directly impacts stored data.
- **Public to authenticated/admin/org-member surfaces** — public browsing exists, but candidate-specific, institution-specific, employer-specific, staff, and admin operations must be enforced server-side.
- **User to organization boundary** — employer/institution users must only act within their own org; candidate data and application workflows must not be readable or writable across tenants.
- **Internal/admin to external email delivery** — password setup and reset links cross an external delivery boundary and must not trust attacker-controlled origins or leak plaintext secrets.

## Scan Anchors

- Production API entry point: `artifacts/api-server/src/index.ts` and `artifacts/api-server/src/app.ts`
- Auth/session controls: `artifacts/api-server/src/lib/session.ts`, `artifacts/api-server/src/middleware/require-auth.ts`, `artifacts/api-server/src/routes/auth.ts`
- Highest-risk business routes: `artifacts/api-server/src/routes/candidates.ts`, `applications.ts`, `jobs.ts`, `dashboard.ts`, `institutions.ts`, `employers.ts`
- Public/auth/admin boundaries are implemented per-route, not globally; mounted routers under `src/routes/index.ts` require special scrutiny
- Mobile trust anchor: `artifacts/talent-mobile/constants/auth.ts` and mobile screens that pass `candidateId` to the API
- Usually ignore as dev-only: `artifacts/mockup-sandbox/**`, mobile build scripts, and local tooling unless shown reachable in production

## Threat Categories

### Spoofing

The platform must bind authenticated actions to a verified server-side identity, not to client-supplied `candidateId`, `employerId`, `institutionId`, or role hints. Session cookies must remain unpredictable and protected, and any future mobile auth must provide an equivalent server-verifiable identity before candidate-specific actions are accepted.

### Tampering

Jobs, candidate profiles, applications, application statuses, employer records, institution records, and staff/org relationships must only be mutable by appropriately authorized principals. The API must reject unauthenticated writes and must enforce tenant ownership on every create/update/delete path instead of trusting request parameters or body fields.

### Information Disclosure

Candidate PII, application cover notes, placement outcomes, dashboard analytics, and institution/employer tenant data must only be returned to permitted viewers. Public endpoints may expose marketplace-safe summaries, but detailed profile data, workflow history, and org-scoped analytics must be filtered and authorized server-side.

### Denial of Service

Public auth and discovery endpoints must resist abuse with reasonable request validation and operational limits. Expensive dashboard or ranking queries should not be callable in ways that allow unauthenticated scraping or repeated high-cost database work at scale.

### Elevation of Privilege

Administrative and organization-owner capabilities must be enforced exclusively on the server. Any route that lets a client select another user, candidate, job owner, or organization by ID is a potential privilege-escalation point and must verify the caller’s relationship to that resource before proceeding.