// Shared label maps for the LinkedIn-style work experience feature.
// Kept here (not in a generated file) so we can localize / restyle the
// strings without regenerating the API client. The keys match the enum
// values defined in lib/api-spec/openapi.yaml — keep them in sync.

export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  self_employed: "Self-employed",
  freelance: "Freelance",
  contract: "Contract",
  internship: "Internship",
  apprenticeship: "Apprenticeship",
  seasonal: "Seasonal",
};

export const LOCATION_TYPE_LABELS: Record<string, string> = {
  on_site: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
};

export const EMPLOYMENT_TYPE_OPTIONS = Object.entries(EMPLOYMENT_TYPE_LABELS) as Array<
  [string, string]
>;
export const LOCATION_TYPE_OPTIONS = Object.entries(LOCATION_TYPE_LABELS) as Array<
  [string, string]
>;
