/**
 * Client-side mirror of the ministry data-scope catalog. The server is
 * the source of truth (`artifacts/api-server/src/lib/ministry-scopes.ts`)
 * — this only carries the display label per scope key so the ministry
 * sidebar and dashboard can render section headings without an extra
 * round-trip. The dashboard only ever shows sections the server actually
 * returns, so a drift here can never widen data access.
 */
export type MinistryType = "education" | "labour";

export type MinistryScopeMeta = {
  key: string;
  label: string;
  type: MinistryType;
};

export const MINISTRY_SCOPE_META: ReadonlyArray<MinistryScopeMeta> = [
  { key: "edu:overview", label: "National overview", type: "education" },
  {
    key: "edu:institutions",
    label: "Institution performance",
    type: "education",
  },
  { key: "edu:trends", label: "Placement trends", type: "education" },
  { key: "edu:skills", label: "Graduate skills", type: "education" },
  { key: "lab:overview", label: "Labour-market overview", type: "labour" },
  { key: "lab:jobs", label: "Jobs & hiring", type: "labour" },
  { key: "lab:salary", label: "Salary insights", type: "labour" },
  { key: "lab:employers", label: "Employer activity", type: "labour" },
  { key: "lab:skills", label: "Skills demand", type: "labour" },
];

export function scopeLabel(key: string): string {
  return MINISTRY_SCOPE_META.find((s) => s.key === key)?.label ?? key;
}

/** A DOM-safe anchor id for a scope key (`edu:overview` -> `section-edu-overview`). */
export function scopeAnchorId(key: string): string {
  return `section-${key.replace(/:/g, "-")}`;
}
