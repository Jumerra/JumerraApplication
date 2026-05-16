/**
 * Shared `/jobs` filter predicate.
 *
 * The candidate-facing job feed (`GET /jobs` in routes/jobs.ts) exposes
 * a fixed set of filter facets: free-text `search` (matched across
 * title + summary + skills), `type`, `location` substring,
 * `remote` boolean, `employerId`, `featured`, and exact-match `skill`.
 *
 * The saved-search alert worker MUST use the same predicate or
 * candidates will get alerts that don't match what they actually saved
 * (e.g. saving a search that hits via summary but never seeing the
 * alert because the worker only matched titles). Centralising the
 * predicate here is the single source of truth — both routes/jobs.ts
 * and lib/digest-worker.ts call into it.
 */

import type { jobsTable } from "@workspace/db";

export interface JobFilters {
  search?: string | null;
  type?: string | null;
  location?: string | null;
  remote?: boolean | null;
  employerId?: number | null;
  featured?: boolean | null;
  skill?: string | null;
}

/**
 * Returns true iff `job` matches every populated filter in `filters`.
 * Mirrors the in-memory filter chain used by `GET /jobs`. Unknown /
 * undefined / null filter fields are no-ops.
 */
export function jobMatchesFilters(
  job: typeof jobsTable.$inferSelect,
  filters: JobFilters,
): boolean {
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const blob =
      `${job.title} ${job.summary} ${job.skills.join(" ")}`.toLowerCase();
    if (!blob.includes(q)) return false;
  }
  if (filters.type && job.type !== filters.type) return false;
  if (
    filters.location &&
    !job.location.toLowerCase().includes(filters.location.toLowerCase())
  ) {
    return false;
  }
  if (filters.remote !== undefined && filters.remote !== null && job.remote !== filters.remote) {
    return false;
  }
  if (filters.employerId && job.employerId !== filters.employerId) return false;
  if (
    filters.featured !== undefined &&
    filters.featured !== null &&
    job.featured !== filters.featured
  ) {
    return false;
  }
  if (filters.skill) {
    const skillLower = filters.skill.toLowerCase();
    if (!job.skills.some((s) => s.toLowerCase() === skillLower)) return false;
  }
  return true;
}

/**
 * Coerce a saved-search row's persisted state into the shared
 * `JobFilters` shape. Saved searches store the full UI query state in
 * `filters_json`; the legacy denormalised columns `searchText` and
 * `jobType` are preserved as fallbacks for searches created before
 * filters_json existed.
 */
export function savedSearchToFilters(s: {
  searchText: string | null;
  jobType: string | null;
  filtersJson: string | null;
}): JobFilters {
  let parsed: Record<string, unknown> = {};
  if (s.filtersJson) {
    try {
      const x = JSON.parse(s.filtersJson);
      if (x && typeof x === "object" && !Array.isArray(x)) {
        parsed = x as Record<string, unknown>;
      }
    } catch {
      // malformed JSON falls through to legacy-column-only matching
    }
  }

  // Filters_json wins over legacy columns: it's the full UI snapshot;
  // the legacy columns only exist as a fallback for older rows.
  const search =
    typeof parsed.search === "string"
      ? parsed.search
      : typeof parsed.searchText === "string"
        ? parsed.searchText
        : (s.searchText ?? null);
  const type =
    typeof parsed.type === "string"
      ? parsed.type
      : typeof parsed.jobType === "string"
        ? parsed.jobType
        : (s.jobType ?? null);

  return {
    search,
    type,
    location: typeof parsed.location === "string" ? parsed.location : null,
    remote:
      typeof parsed.remote === "boolean"
        ? parsed.remote
        : null,
    employerId:
      typeof parsed.employerId === "number" ? parsed.employerId : null,
    featured:
      typeof parsed.featured === "boolean" ? parsed.featured : null,
    skill: typeof parsed.skill === "string" ? parsed.skill : null,
  };
}
