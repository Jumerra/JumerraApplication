# TalentLink

A smart talent ecosystem connecting candidates (interns/grads/early-career) with employers via AI-style matching. Educational institutions track their students' real-time placement.

## Architecture

- **Monorepo**: pnpm workspaces.
- **API spec contract**: `lib/api-spec/openapi.yaml` is the source of truth for all endpoints, request/response shapes, and Zod validators (re-generated via `pnpm --filter @workspace/api-spec run codegen`).
- **API server** (`artifacts/api-server`): Express 5 + Drizzle ORM, structured logging (pino), domain-split routes under `src/routes/`, business logic (matching algorithm) in `src/lib/matching.ts`.
- **DB** (`lib/db`): Drizzle schema split per domain under `src/schema/`. Seed at `src/seed.ts` (run with `pnpm dlx tsx src/seed.ts`).
- **API client** (`lib/api-client-react`): Orval-generated React Query hooks consumed by the frontend.
- **Web app** (`artifacts/talent-platform`): React + Vite + wouter + shadcn/ui + Recharts + framer-motion + sonner. Real cookie-session auth (see "Auth" below) with a fallback `View as` demo dropdown when no session is active. Auth context lives in `src/lib/auth.tsx`: it consumes `/api/auth/me` and exposes both `sessionUser` (real) and `demoRole` (localStorage-persisted). When a session is present `role`/`userId` come from the session; otherwise they fall back to the demo role.

## Auth

- **Schema** (`lib/db/src/schema/auth.ts`):
  - `users(id, email UNIQUE, password_hash NULLABLE, full_name, role, status, candidate_id, employer_id, institution_id, created_at, approved_at)` — `status` is `pending` | `active` | `rejected` | `invited`. `password_hash` is null for admin-onboarded users until they set a password.
  - `pending_registrations(id, user_id, submitted_data jsonb, reviewed_by, reviewed_at, decision_note, created_at)` — public signups land here.
  - `password_setup_tokens(id, user_id, token UNIQUE, expires_at, used_at, created_at)` — one-time setup links for invitees and admin onboarding.
  - `session(sid, sess, expire)` — connect-pg-simple table (manually created in schema; we set `createTableIfMissing: false`).
- **API** (`artifacts/api-server`): `express-session` + `connect-pg-simple` reading `SESSION_SECRET`, cookie name `talentlink.sid`. `src/lib/auth.ts` does bcrypt hashing and token generation. `src/middleware/require-auth.ts` exports `requireAuth` and `requireAdmin`. Routes:
  - Public: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/setup-token/:token`, `POST /api/auth/setup-password`, `POST /api/auth/forgot-password`.
  - Authenticated: `POST /api/auth/change-password` (requires session, verifies current password before updating).
  - Admin only: `GET /api/admin/registrations`, `POST /api/admin/registrations/:id/approve`, `POST /api/admin/registrations/:id/reject`, `POST /api/admin/onboard`, `GET /api/admin/onboarded-users`.
- **Web pages**: `/signup` (3 role tabs), `/login` (with show/hide password toggle and "Forgot password?" link), `/setup-password?token=...`, `/forgot-password`, `/account/password` (change-password, reachable from the user dropdown), `/dashboard/admin/registrations`, `/dashboard/admin/onboard`. All password fields use `components/ui/password-input.tsx` (eye/eye-off lucide toggle).
- **Forgot-password flow**: `POST /api/auth/forgot-password` always responds `{ ok: true }` to avoid email enumeration. If the email matches an active or invited user, it issues a fresh password-setup token (reusing the `password_setup_tokens` table and the `/setup-password` page) and calls `sendAuthLinkEmail`. The reset link reuses the existing `POST /api/auth/setup-password` endpoint to consume the token.
- **Email layer** (`artifacts/api-server/src/lib/email.ts`): `sendAuthLinkEmail({ to, fullName, linkPath, kind: "setup" | "reset", origin, logger })` is the single entry point.
  - Today it returns `{ sent: false, reason: "email-not-configured" }`. For `kind: "setup"` (admin onboarding) it logs the full URL so admins can copy it; for `kind: "reset"` it intentionally logs only a short token fingerprint (never the full URL) to avoid plaintext reset links in logs.
  - The admin onboarding success card reads `emailSent` and only shows the copyable link when `emailSent === false`, so once the email layer starts returning `{ sent: true }` the link disappears from the UI automatically.
  - **Email provider not connected.** A Resend integration was offered and dismissed by the user. To wire real delivery later, either revisit the Resend integration, pick another provider (SendGrid, Gmail, Outlook, AgentMail are all available as integrations), or take a direct provider API key as a secret. Implementation point is the single `TODO` in `lib/email.ts` — replace the `return { sent: false, ... }` with a real send and return `{ sent: true, provider }`.
- **Seeded admin**: `admin@talentlink.com` / `admin123`. Other test users: `techcorp@talentlink.com` / `employer123` (employer owner of #7), `stanford@talentlink.com` / `institution123` (institution owner of #4), `alex@example.com` / `candidate123`.

## Roles & staff invites

- `users.org_role` (nullable text) layers on top of `users.role` for in-org permissions:
  - `admin` → `super_admin` | `support`
  - `employer` → `owner` | `recruiter` | `viewer`
  - `institution` → `owner` | `coordinator` | `viewer`
  - `candidate` → null
- Backfill: existing admins → `super_admin`; first user attached to each employer/institution → `owner`. Admin onboarding now sets `org_role: 'owner'` for new employer/institution users.
- Middleware (`require-auth.ts`):
  - `requireOrgOwner` — owner of the same org (or any platform admin).
  - `requireOrgMember` — any user belonging to the same org (admins always pass).
- Endpoints (`routes/staff.ts`):
  - `GET /api/staff` — admin sees all org members; employer/institution owner sees only their org.
  - `POST /api/staff/invite` — owner-only. Creates a `password_setup_tokens` row, calls the stubbed email layer, and ALWAYS returns the `setupUrl` so the inviter can copy it.
  - `DELETE /api/staff/:id` — owner-only. Cannot remove yourself or the last owner of an org.
- Web: `/dashboard/<role>/staff` (single page reused by admin/employer/institution). Owners see invite form + remove buttons; non-owners see a read-only roster. Layout dropdown adds **Team** for employer/institution and **Admin team** for admin.

## Light website builder

- `site_content(key TEXT PK, type TEXT, value TEXT, updated_at, updated_by → users.id)` — bulk key/value store for editable home-page copy and image URLs.
- `GET /api/site-content` — public; returns `{ items: [{ key, type, value }] }`.
- `PUT /api/site-content` — admin-only bulk upsert. Validates `type ∈ {text, image}`, key ≤200, value ≤5000.
- Web: `/dashboard/admin/site-content` groups all 21 keys into Hero / How it works / Audience cards with sticky save bar and image previews. `home.tsx` consumes `useGetSiteContent` with hard-coded fallbacks for every key, and runs every image URL through a `safeImage` allow-list (http(s)/data:image/relative paths only) to block `javascript:` URIs.
- **Mobile app** (`artifacts/talent-mobile`, preview path `/mobile/`): Expo + Expo Router + React Native, **candidate-only experience** (browse jobs, view detail w/ match score, apply, track applications, view profile). Hardcoded `CURRENT_CANDIDATE_ID = 1` in `constants/auth.ts` (no auth on mobile). Tabs: Discover / Search / Applications / Profile. Stack screens: `job/[id]/index` (detail), `job/[id]/apply` (modal). Reuses the same `@workspace/api-client-react` hooks as the web app and the same backend. Design tokens in `constants/colors.ts` mirror the web emerald palette (light + dark via `useColors()`). Inter fonts loaded via `@expo-google-fonts/inter`. Feather icons only (no emojis).

## Domain model

- `institutions` — universities, colleges, bootcamps that track placement of their students.
- `employers` — companies that post jobs and hire candidates.
- `candidates` — students/grads with skills, talent score, optional institution. Detail tables: `education_entries`, `experience_entries`, `certifications`, `badges`.
- `candidate_institutions` — many-to-many junction between candidates and institutions. Each row has `isPrimary` (true exactly once per candidate, mirroring `candidates.institutionId`). Lets a candidate belong to several institutions (e.g. university grad + bootcamp) and lets each institution see them on its dashboard. Helpers in `artifacts/api-server/src/lib/candidate-institutions.ts`: `getInstitutionLinksByCandidate`, `getCandidateIdsForInstitution`, `setCandidateInstitutionLinks`. The `Candidate` API response includes an `institutions` array (primary first); the `InstitutionStudent` row includes `isPrimaryAffiliation` so dashboards can label affiliated-vs-primary students.
- `jobs` — postings owned by an employer with skills, type, salary, etc.
- `applications` — many-to-many between candidates and jobs with status pipeline (applied → screening → interview → offer → hired / rejected / withdrawn) and a precomputed match score.
- `skills` — a small catalog used for filter UIs.

## Key endpoints

Full CRUD on candidates / employers / institutions / jobs / applications, plus AI-style matching (`/jobs/:id/matches`, `/candidates/:id/recommendations`) and dashboard aggregations (`/dashboard/platform`, `/dashboard/employer/:id`, `/dashboard/institution/:id`, `/dashboard/candidate/:id`, `/dashboard/activity`, `/dashboard/salary-insights`).

## Match score

`artifacts/api-server/src/lib/matching.ts`:
- 65% skill coverage (overlap between job and candidate skills)
- 15% experience scaling (capped at 10 years)
- 20% talent score
- Clamped to 15–99.

## Build constraints

- No emojis — lucide icons only.
- No auth, payments, mobile, or video in this build.
- Real data on first load via the seed.
- Color palette in `src/index.css` is emerald/teal primary on warm neutral, with a dark variant.

## Common commands

```bash
# Regenerate API client + zod from the spec
pnpm --filter @workspace/api-spec run codegen

# Push schema to the database
pnpm --filter @workspace/db run push

# Re-seed the database from scratch
pnpm dlx tsx lib/db/src/seed.ts

# Typecheck the API server
pnpm --filter @workspace/api-server run typecheck
```
