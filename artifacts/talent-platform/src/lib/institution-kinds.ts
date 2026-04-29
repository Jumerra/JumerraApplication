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

/**
 * The "department" concept is presented differently per institution kind.
 * SHS schools group students by program (Science, General Arts, Business,
 * Visual Arts, etc.) instead of departments/faculties. The underlying
 * data shape (name/code/headName/description) fits both equally well, so
 * we just relabel the UI based on the institution's kind.
 */
export interface AcademicUnitTerms {
  singular: string; // e.g. "Department" / "Program"
  plural: string; // e.g. "Departments" / "Programs"
  // Hint shown under list headers and in dialogs.
  hint: string;
  // Label for the optional short identifier ("CS-101" for a dept, "SCI" for a program).
  codeLabel: string;
  // Label for the lead-staff field.
  headLabel: string;
}

const SHS_TERMS: AcademicUnitTerms = {
  singular: "Program",
  plural: "Programs",
  hint: "Programs offered by your school (e.g. Science, General Arts, Business, Visual Arts).",
  codeLabel: "Code",
  headLabel: "Coordinator",
};

const DEFAULT_TERMS: AcademicUnitTerms = {
  singular: "Department",
  plural: "Departments",
  hint: "Academic departments and faculties within your institution.",
  codeLabel: "Code",
  headLabel: "Head of department",
};

export function academicUnitTerms(
  kind: string | null | undefined,
): AcademicUnitTerms {
  return kind === "shs" ? SHS_TERMS : DEFAULT_TERMS;
}
