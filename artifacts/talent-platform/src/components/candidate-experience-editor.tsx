import { useEffect, useMemo, useState } from "react";
import {
  useUpdateCandidate,
  useListEmployers,
  getGetCandidateQueryKey,
  getListEmployersQueryKey,
  type ExperienceEntry,
  type Employer,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Briefcase, Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPE_OPTIONS,
  LOCATION_TYPE_LABELS,
  LOCATION_TYPE_OPTIONS,
} from "@/lib/experience-labels";

// Months are stored as 1-based ints to match human-readable values, but
// the JS Date constructor wants 0-based. The pickers and the date
// (de)serialization helpers below isolate that quirk so callers don't
// have to think about it.
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const CURRENT_YEAR = new Date().getFullYear();
// Generous range — LinkedIn lets you go back 80+ years and forward a
// few for "expected end" dates. We use the same window.
const YEAR_OPTIONS: number[] = [];
for (let y = CURRENT_YEAR + 5; y >= CURRENT_YEAR - 80; y--) YEAR_OPTIONS.push(y);

// Format a YYYY-MM-DD date string as "Mon YYYY" for read-only display.
function formatMonthYear(date: string | null | undefined): string {
  if (!date) return "";
  // We deliberately split rather than `new Date(date)` to avoid time-zone
  // shifts that can roll the date back a day in negative-offset locales.
  const [yearStr, monthStr] = date.split("-");
  const monthIdx = Math.max(0, Math.min(11, Number(monthStr) - 1));
  return `${MONTHS[monthIdx]?.slice(0, 3) ?? ""} ${yearStr}`;
}

// Convert a YYYY-MM-DD date string into separate month/year ints so we
// can hydrate the pickers when editing an existing entry.
function splitYmd(date: string | null | undefined): {
  month: number | null;
  year: number | null;
} {
  if (!date) return { month: null, year: null };
  const [y, m] = date.split("-");
  return { month: Number(m), year: Number(y) };
}

// Build a YYYY-MM-DD string from month/year (always day=01 since we only
// collect month + year LinkedIn-style).
function joinYmd(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

type Draft = {
  // Stable key for React lists. New drafts get "new-N", existing entries
  // keep their server id stringified so the list doesn't re-mount on save.
  key: string;
  id: number | null;
  employerId: number | null;
  // When linked to an on-platform employer we display its logo in the
  // edit list; not part of the save payload (server snapshots it again).
  employerLogoUrl: string | null;
  company: string;
  title: string;
  employmentType: string | null;
  location: string;
  locationType: string | null;
  description: string;
  startMonth: number | null;
  startYear: number | null;
  endMonth: number | null;
  endYear: number | null;
  isCurrent: boolean;
};

function emptyDraft(key: string): Draft {
  return {
    key,
    id: null,
    employerId: null,
    employerLogoUrl: null,
    company: "",
    title: "",
    employmentType: null,
    location: "",
    locationType: null,
    description: "",
    startMonth: null,
    startYear: null,
    endMonth: null,
    endYear: null,
    isCurrent: false,
  };
}

function entryToDraft(e: ExperienceEntry): Draft {
  const start = splitYmd(e.startDate as unknown as string);
  const end = splitYmd((e.endDate as unknown as string) ?? null);
  return {
    key: `srv-${e.id}`,
    id: e.id,
    employerId: e.employerId ?? null,
    employerLogoUrl: e.employerLogoUrl ?? null,
    company: e.company,
    title: e.title,
    employmentType: e.employmentType ?? null,
    location: e.location ?? "",
    locationType: e.locationType ?? null,
    description: e.description ?? "",
    startMonth: start.month,
    startYear: start.year,
    endMonth: end.month,
    endYear: end.year,
    isCurrent: e.endDate == null,
  };
}

function draftValid(d: Draft): string | null {
  if (d.title.trim().length === 0) return "Title is required.";
  if (d.employerId == null && d.company.trim().length === 0)
    return "Pick a company or type a name.";
  if (d.startMonth == null || d.startYear == null) return "Start date is required.";
  if (!d.isCurrent) {
    if (d.endMonth == null || d.endYear == null)
      return "Add an end date or check 'I currently work here'.";
    const start = joinYmd(d.startYear, d.startMonth);
    const end = joinYmd(d.endYear, d.endMonth);
    if (end < start) return "End date can't be earlier than start date.";
  }
  return null;
}

let nextDraftKey = 1;
const makeDraftKey = () => `new-${nextDraftKey++}`;

export function CandidateExperienceEditor({
  candidateId,
  experience,
}: {
  candidateId: number;
  experience: readonly ExperienceEntry[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateCandidate = useUpdateCandidate();

  // The list is owned by the candidate query (server is the source of
  // truth) — the editor only opens a modal for one entry at a time.
  const sortedEntries = useMemo(() => {
    return [...experience].sort((a, b) => {
      const aEnd = (a.endDate as unknown as string) ?? "9999-12-31";
      const bEnd = (b.endDate as unknown as string) ?? "9999-12-31";
      if (aEnd !== bEnd) return aEnd < bEnd ? 1 : -1;
      return (b.startDate as unknown as string).localeCompare(
        a.startDate as unknown as string,
      );
    });
  }, [experience]);

  const [editing, setEditing] = useState<Draft | null>(null);

  // Build the next list of inputs from current state plus a single
  // mutation (add/update/remove) and ship it as a full replacement —
  // matches the server's "PATCH replaces the whole list" contract.
  function buildPayload(
    op:
      | { kind: "upsert"; draft: Draft }
      | { kind: "remove"; id: number },
  ): Array<Record<string, unknown>> {
    const drafts = sortedEntries.map(entryToDraft);
    if (op.kind === "remove") {
      return drafts
        .filter((d) => d.id !== op.id)
        .map(draftToInput)
        .filter((v): v is Record<string, unknown> => v !== null);
    }
    const next = op.draft;
    let replaced = false;
    const merged = drafts.map((d) => {
      if (next.id != null && d.id === next.id) {
        replaced = true;
        return next;
      }
      return d;
    });
    if (!replaced) merged.push(next);
    return merged
      .map(draftToInput)
      .filter((v): v is Record<string, unknown> => v !== null);
  }

  function draftToInput(d: Draft): Record<string, unknown> | null {
    if (d.startMonth == null || d.startYear == null) return null;
    const startDate = joinYmd(d.startYear, d.startMonth);
    const endDate =
      d.isCurrent || d.endMonth == null || d.endYear == null
        ? null
        : joinYmd(d.endYear, d.endMonth);
    return {
      employerId: d.employerId,
      company: d.company.trim(),
      title: d.title.trim(),
      employmentType: d.employmentType,
      location: d.location.trim() === "" ? null : d.location.trim(),
      locationType: d.locationType,
      description: d.description,
      startDate,
      endDate,
    };
  }

  async function commit(experienceInput: Array<Record<string, unknown>>) {
    try {
      await updateCandidate.mutateAsync({
        id: candidateId,
        // The generated client expects ExperienceEntryInput[] but we
        // built plain objects matching the schema; casting keeps us
        // honest at the API edge without taking on the orval type.
        data: { experience: experienceInput as never },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetCandidateQueryKey(candidateId),
      });
      setEditing(null);
    } catch (err: any) {
      toast({
        title: "Couldn't save experience",
        description: err?.data?.error ?? "Please try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <Card className="shadow-md">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-lg">Work experience</CardTitle>
              <CardDescription>
                Add the roles you've held. Pick a company from the platform
                to link your entry to its profile.
              </CardDescription>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => setEditing(emptyDraft(makeDraftKey()))}
          >
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {sortedEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No entries yet. Add your most recent role to get started.
          </p>
        ) : (
          sortedEntries.map((exp) => {
            const startLabel = formatMonthYear(exp.startDate as unknown as string);
            const endLabel = exp.endDate
              ? formatMonthYear(exp.endDate as unknown as string)
              : "Present";
            const employmentLabel = exp.employmentType
              ? EMPLOYMENT_TYPE_LABELS[exp.employmentType] ?? null
              : null;
            const locationTypeLabel = exp.locationType
              ? LOCATION_TYPE_LABELS[exp.locationType] ?? null
              : null;
            const locationLine = [exp.location, locationTypeLabel]
              .filter(Boolean)
              .join(" · ");
            return (
              <div
                key={exp.id}
                className="flex gap-3 items-start p-3 rounded-lg border"
              >
                <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                  {exp.employerLogoUrl ? (
                    <img
                      src={exp.employerLogoUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Briefcase className="w-6 h-6 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{exp.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {exp.company}
                    {employmentLabel ? ` · ${employmentLabel}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {startLabel} – {endLabel}
                  </p>
                  {locationLine ? (
                    <p className="text-xs text-muted-foreground">
                      {locationLine}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Edit experience"
                    onClick={() => setEditing(entryToDraft(exp))}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove experience"
                    disabled={updateCandidate.isPending}
                    onClick={() => {
                      const ok = window.confirm(
                        `Remove "${exp.title}" from your experience?`,
                      );
                      if (!ok) return;
                      void commit(buildPayload({ kind: "remove", id: exp.id }));
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>

      <ExperienceModal
        open={editing != null}
        draft={editing}
        onCancel={() => setEditing(null)}
        onSubmit={async (next) => {
          await commit(buildPayload({ kind: "upsert", draft: next }));
        }}
        saving={updateCandidate.isPending}
      />
    </Card>
  );
}

function ExperienceModal({
  open,
  draft,
  onCancel,
  onSubmit,
  saving,
}: {
  open: boolean;
  draft: Draft | null;
  onCancel: () => void;
  onSubmit: (next: Draft) => Promise<void>;
  saving: boolean;
}) {
  // Internal state mirrors the prop draft when the modal opens, so edits
  // don't mutate the parent until the user hits Save.
  const [d, setD] = useState<Draft | null>(draft);
  useEffect(() => {
    setD(draft);
  }, [draft]);

  if (!d) return null;

  const validationError = draftValid(d);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {d.id == null ? "Add experience" : "Edit experience"}
          </DialogTitle>
          <DialogDescription>
            Fields marked with * are required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="exp-title">Title *</Label>
            <Input
              id="exp-title"
              value={d.title}
              onChange={(e) => setD({ ...d, title: e.target.value })}
              placeholder="e.g. Software Engineer"
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Employment type</Label>
            <Select
              value={d.employmentType ?? "none"}
              onValueChange={(v) =>
                setD({ ...d, employmentType: v === "none" ? null : v })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose one" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not specified</SelectItem>
                {EMPLOYMENT_TYPE_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <CompanyPicker
            employerId={d.employerId}
            company={d.company}
            onPick={(picked) => {
              if (picked) {
                setD({
                  ...d,
                  employerId: picked.id,
                  employerLogoUrl: picked.logoUrl,
                  company: picked.name,
                });
              } else {
                setD({
                  ...d,
                  employerId: null,
                  employerLogoUrl: null,
                });
              }
            }}
            onTypeFreeText={(value) =>
              setD({
                ...d,
                company: value,
                employerId: null,
                employerLogoUrl: null,
              })
            }
          />

          <div className="space-y-1.5">
            <Label htmlFor="exp-location">Location</Label>
            <Input
              id="exp-location"
              value={d.location}
              onChange={(e) => setD({ ...d, location: e.target.value })}
              placeholder="e.g. Accra, Ghana"
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Location type</Label>
            <Select
              value={d.locationType ?? "none"}
              onValueChange={(v) =>
                setD({ ...d, locationType: v === "none" ? null : v })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose one" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not specified</SelectItem>
                {LOCATION_TYPE_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="exp-current"
              checked={d.isCurrent}
              onCheckedChange={(checked) => {
                const isCurrent = checked === true;
                setD({
                  ...d,
                  isCurrent,
                  endMonth: isCurrent ? null : d.endMonth,
                  endYear: isCurrent ? null : d.endYear,
                });
              }}
            />
            <Label htmlFor="exp-current" className="cursor-pointer">
              I currently work here
            </Label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start date *</Label>
              <div className="flex gap-2">
                <MonthSelect
                  value={d.startMonth}
                  onChange={(m) => setD({ ...d, startMonth: m })}
                />
                <YearSelect
                  value={d.startYear}
                  onChange={(y) => setD({ ...d, startYear: y })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>End date{d.isCurrent ? "" : " *"}</Label>
              <div className="flex gap-2">
                <MonthSelect
                  value={d.endMonth}
                  onChange={(m) => setD({ ...d, endMonth: m })}
                  disabled={d.isCurrent}
                />
                <YearSelect
                  value={d.endYear}
                  onChange={(y) => setD({ ...d, endYear: y })}
                  disabled={d.isCurrent}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exp-desc">Description</Label>
            <Textarea
              id="exp-desc"
              value={d.description}
              onChange={(e) => setD({ ...d, description: e.target.value })}
              placeholder="What did you do in this role?"
              rows={4}
              maxLength={4000}
            />
          </div>

          {validationError ? (
            <p className="text-sm text-destructive">{validationError}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (validationError) return;
              void onSubmit(d);
            }}
            disabled={validationError != null || saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MonthSelect({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (m: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value == null ? "none" : String(value)}
      onValueChange={(v) => onChange(v === "none" ? null : Number(v))}
      disabled={disabled}
    >
      <SelectTrigger className="flex-1">
        <SelectValue placeholder="Month" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Month</SelectItem>
        {MONTHS.map((m, idx) => (
          <SelectItem key={idx} value={String(idx + 1)}>
            {m}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function YearSelect({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (y: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value == null ? "none" : String(value)}
      onValueChange={(v) => onChange(v === "none" ? null : Number(v))}
      disabled={disabled}
    >
      <SelectTrigger className="w-28">
        <SelectValue placeholder="Year" />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value="none">Year</SelectItem>
        {YEAR_OPTIONS.map((y) => (
          <SelectItem key={y} value={String(y)}>
            {y}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// LinkedIn-style company picker: typeahead against the platform's
// employer list. If the candidate's company isn't there, they can type
// it as free text — the entry will simply not be linked to an Employer
// row (no logo, no click-through).
function CompanyPicker({
  employerId,
  company,
  onPick,
  onTypeFreeText,
}: {
  employerId: number | null;
  company: string;
  onPick: (e: { id: number; name: string; logoUrl: string } | null) => void;
  onTypeFreeText: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // Debounce so we don't fire a request on every keystroke. 200ms feels
  // responsive but still cuts the chatter on fast typists.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(id);
  }, [query]);

  const params = debounced.length >= 2 ? { search: debounced } : undefined;
  const employersQuery = useListEmployers(params, {
    query: {
      queryKey: getListEmployersQueryKey(params),
      enabled: open && debounced.length >= 2,
      staleTime: 60_000,
    },
  });
  const results: Employer[] = (employersQuery.data ?? []) as Employer[];

  return (
    <div className="space-y-1.5">
      <Label htmlFor="exp-company">Company *</Label>
      {employerId != null ? (
        <div className="flex items-center gap-2 p-2 rounded-md border bg-muted/40">
          <Briefcase className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm truncate flex-1">{company}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onPick(null)}
          >
            Change
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Input
            id="exp-company"
            value={query.length > 0 ? query : company}
            onChange={(e) => {
              setQuery(e.target.value);
              onTypeFreeText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Delay so the click on a suggestion can register first.
              setTimeout(() => setOpen(false), 150);
            }}
            placeholder="Type to search the platform"
            maxLength={200}
            autoComplete="off"
          />
          {open && debounced.length >= 2 ? (
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-y-auto">
              {employersQuery.isLoading ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Searching…
                </p>
              ) : results.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  No matches. You can keep typing to add it as free text.
                </p>
              ) : (
                results.slice(0, 8).map((emp) => (
                  <button
                    type="button"
                    key={emp.id}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                    onMouseDown={(e) => {
                      // onMouseDown so we win the race against the
                      // input's onBlur which closes the panel.
                      e.preventDefault();
                      onPick({
                        id: emp.id,
                        name: emp.name,
                        logoUrl: emp.logoUrl,
                      });
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    <div className="w-7 h-7 rounded bg-muted overflow-hidden shrink-0">
                      {emp.logoUrl ? (
                        <img
                          src={emp.logoUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate">{emp.name}</p>
                      {emp.industry ? (
                        <p className="text-xs text-muted-foreground truncate">
                          {emp.industry}
                        </p>
                      ) : null}
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Pick a company on the platform to link your entry to its profile, or
        type a name for an off-platform role.
      </p>
    </div>
  );
}
