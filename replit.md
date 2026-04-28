# TalentLink

A smart talent ecosystem connecting candidates (interns/grads/early-career) with employers via AI-style matching. Educational institutions track their students' real-time placement.

## Architecture

- **Monorepo**: pnpm workspaces.
- **API spec contract**: `lib/api-spec/openapi.yaml` is the source of truth for all endpoints, request/response shapes, and Zod validators (re-generated via `pnpm --filter @workspace/api-spec run codegen`).
- **API server** (`artifacts/api-server`): Express 5 + Drizzle ORM, structured logging (pino), domain-split routes under `src/routes/`, business logic (matching algorithm) in `src/lib/matching.ts`.
- **DB** (`lib/db`): Drizzle schema split per domain under `src/schema/`. Seed at `src/seed.ts` (run with `pnpm dlx tsx src/seed.ts`).
- **API client** (`lib/api-client-react`): Orval-generated React Query hooks consumed by the frontend.
- **Web app** (`artifacts/talent-platform`): React + Vite + wouter + shadcn/ui + Recharts + framer-motion + sonner. Role context (`src/lib/auth.tsx`) provides `View as` switching across Candidate / Employer / Institution / Admin (persisted in localStorage). All three default IDs are 1 and seed data guarantees those entities exist.
- **Mobile app** (`artifacts/talent-mobile`, preview path `/mobile/`): Expo + Expo Router + React Native, **candidate-only experience** (browse jobs, view detail w/ match score, apply, track applications, view profile). Hardcoded `CURRENT_CANDIDATE_ID = 1` in `constants/auth.ts` (no auth on mobile). Tabs: Discover / Search / Applications / Profile. Stack screens: `job/[id]/index` (detail), `job/[id]/apply` (modal). Reuses the same `@workspace/api-client-react` hooks as the web app and the same backend. Design tokens in `constants/colors.ts` mirror the web emerald palette (light + dark via `useColors()`). Inter fonts loaded via `@expo-google-fonts/inter`. Feather icons only (no emojis).

## Domain model

- `institutions` — universities, colleges, bootcamps that track placement of their students.
- `employers` — companies that post jobs and hire candidates.
- `candidates` — students/grads with skills, talent score, optional institution. Detail tables: `education_entries`, `experience_entries`, `certifications`, `badges`.
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
