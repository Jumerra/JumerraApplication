/**
 * Standardized institution kinds. Keep in sync with the InstitutionKind
 * enum in `lib/api-spec/openapi.yaml`. The DB still stores `type` as
 * free text for legacy compat, so the UI also accepts unknown values
 * (rendered as "Other") on read paths.
 */
export type InstitutionKind =
  | "university"
  | "college"
  | "polytechnic"
  | "nursing_training"
  | "bootcamp"
  | "shs"
  | "vocational"
  | "other";

export const INSTITUTION_KIND_OPTIONS: ReadonlyArray<{
  value: InstitutionKind;
  label: string;
}> = [
  { value: "university", label: "University" },
  { value: "college", label: "College" },
  { value: "polytechnic", label: "Polytechnic" },
  { value: "nursing_training", label: "Nursing training" },
  { value: "bootcamp", label: "Bootcamp" },
  { value: "shs", label: "Senior High School (SHS)" },
  { value: "vocational", label: "Vocational" },
  { value: "other", label: "Other" },
];

const LABEL_BY_VALUE = new Map(
  INSTITUTION_KIND_OPTIONS.map((o) => [o.value, o.label] as const),
);

export function institutionKindLabel(value: string): string {
  return LABEL_BY_VALUE.get(value as InstitutionKind) ?? value;
}
