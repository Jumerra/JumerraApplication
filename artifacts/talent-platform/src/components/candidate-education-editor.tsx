import { useState } from "react";
import {
  useUpdateCandidate,
  getGetCandidateQueryKey,
  type EducationEntry,
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
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GraduationCap, Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const YEAR_MIN = 1900;
const YEAR_MAX = 2100;
const EDUCATION_MAX_ENTRIES = 50;

type Draft = {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startYearText: string;
  endYearText: string;
};

const emptyDraft: Draft = {
  institution: "",
  degree: "",
  fieldOfStudy: "",
  startYearText: "",
  endYearText: "",
};

function entryToDraft(e: EducationEntry): Draft {
  return {
    institution: e.institution,
    degree: e.degree,
    fieldOfStudy: e.fieldOfStudy,
    startYearText: String(e.startYear),
    endYearText: e.endYear != null ? String(e.endYear) : "",
  };
}

function draftValid(d: Draft): { ok: true } | { ok: false; reason: string } {
  if (d.institution.trim().length === 0)
    return { ok: false, reason: "Institution is required." };
  if (d.degree.trim().length === 0)
    return { ok: false, reason: "Degree is required." };
  if (d.fieldOfStudy.trim().length === 0)
    return { ok: false, reason: "Field of study is required." };
  const sy = Number(d.startYearText);
  if (!Number.isInteger(sy) || sy < YEAR_MIN || sy > YEAR_MAX)
    return { ok: false, reason: `Start year must be between ${YEAR_MIN} and ${YEAR_MAX}.` };
  if (d.endYearText.length > 0) {
    const ey = Number(d.endYearText);
    if (!Number.isInteger(ey) || ey < YEAR_MIN || ey > YEAR_MAX)
      return { ok: false, reason: `End year must be between ${YEAR_MIN} and ${YEAR_MAX}.` };
    if (ey < sy) return { ok: false, reason: "End year cannot be earlier than start year." };
  }
  return { ok: true };
}

function draftToInput(d: Draft) {
  return {
    institution: d.institution.trim(),
    degree: d.degree.trim(),
    fieldOfStudy: d.fieldOfStudy.trim(),
    startYear: Number(d.startYearText),
    endYear: d.endYearText.length > 0 ? Number(d.endYearText) : null,
  };
}

interface Props {
  candidateId: number;
  education: EducationEntry[];
}

export function CandidateEducationEditor({ candidateId, education }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateCandidate = useUpdateCandidate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [draftError, setDraftError] = useState<string | null>(null);

  const openAdd = () => {
    if (education.length >= EDUCATION_MAX_ENTRIES) {
      toast({
        title: "Too many entries",
        description: `You can save up to ${EDUCATION_MAX_ENTRIES} education entries.`,
        variant: "destructive",
      });
      return;
    }
    setEditingId(null);
    setDraft(emptyDraft);
    setDraftError(null);
    setDialogOpen(true);
  };

  const openEdit = (entry: EducationEntry) => {
    setEditingId(entry.id);
    setDraft(entryToDraft(entry));
    setDraftError(null);
    setDialogOpen(true);
  };

  const persist = async (next: EducationEntry[] | { drop: number }) => {
    // Build the full education[] array the API expects (full replacement).
    const nextEntries = "drop" in next
      ? education.filter((e) => e.id !== next.drop)
      : next;
    await updateCandidate.mutateAsync({
      id: candidateId,
      data: {
        education: nextEntries.map((e) =>
          // EducationEntry includes id; EducationEntryInput doesn't.
          // The server treats this as a full replacement.
          ({
            institution: e.institution,
            degree: e.degree,
            fieldOfStudy: e.fieldOfStudy,
            startYear: e.startYear,
            endYear: e.endYear ?? null,
          }),
        ),
      },
    });
    await queryClient.invalidateQueries({
      queryKey: getGetCandidateQueryKey(candidateId),
    });
  };

  const onSave = async () => {
    const v = draftValid(draft);
    if (!v.ok) {
      setDraftError(v.reason);
      return;
    }
    setDraftError(null);
    const input = draftToInput(draft);
    try {
      if (editingId == null) {
        // New entry: append to the existing list.
        const nextEntries: EducationEntry[] = [
          ...education,
          { id: 0, ...input },
        ];
        await persist(nextEntries);
        toast({ title: "Education added" });
      } else {
        // Edit: replace the matching entry.
        const nextEntries: EducationEntry[] = education.map((e) =>
          e.id === editingId ? { ...e, ...input } : e,
        );
        await persist(nextEntries);
        toast({ title: "Education updated" });
      }
      setDialogOpen(false);
    } catch (err: any) {
      toast({
        title: "Could not save education entry",
        description: err?.data?.error ?? "Please try again.",
        variant: "destructive",
      });
    }
  };

  const onDelete = async (entry: EducationEntry) => {
    if (
      !window.confirm(
        `Remove "${entry.degree} in ${entry.fieldOfStudy}" at ${entry.institution}?`,
      )
    )
      return;
    try {
      await persist({ drop: entry.id });
      toast({ title: "Education removed" });
    } catch (err: any) {
      toast({
        title: "Could not remove entry",
        description: err?.data?.error ?? "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="shadow-md">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-lg">Education history</CardTitle>
              <CardDescription>
                Add the schools, degrees, and fields of study from your
                academic background.
              </CardDescription>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={openAdd}
            disabled={updateCandidate.isPending}
          >
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {education.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No education entries yet. Add your school, degree, and field of
            study to help employers find you.
          </p>
        ) : (
          education.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start justify-between gap-3 p-4 rounded-lg border"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">
                  {entry.degree} in {entry.fieldOfStudy}
                </p>
                <p className="text-sm text-muted-foreground truncate">
                  {entry.institution}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {entry.startYear} – {entry.endYear ?? "Present"}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => openEdit(entry)}
                  disabled={updateCandidate.isPending}
                  aria-label="Edit"
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => onDelete(entry)}
                  disabled={updateCandidate.isPending}
                  aria-label="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId == null ? "Add education" : "Edit education"}
            </DialogTitle>
            <DialogDescription>
              Tell employers where you studied and what you studied.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edu-institution">School</Label>
              <Input
                id="edu-institution"
                placeholder="e.g. University of Ghana"
                value={draft.institution}
                maxLength={200}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, institution: e.target.value }))
                }
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edu-degree">Degree</Label>
                <Input
                  id="edu-degree"
                  placeholder="e.g. BSc"
                  value={draft.degree}
                  maxLength={200}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, degree: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edu-field">Field of study</Label>
                <Input
                  id="edu-field"
                  placeholder="e.g. Computer Science"
                  value={draft.fieldOfStudy}
                  maxLength={200}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, fieldOfStudy: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edu-start">Start year</Label>
                <Input
                  id="edu-start"
                  type="number"
                  inputMode="numeric"
                  placeholder="2020"
                  value={draft.startYearText}
                  min={YEAR_MIN}
                  max={YEAR_MAX}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      startYearText: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edu-end">
                  End year{" "}
                  <span className="text-xs text-muted-foreground">
                    (leave blank if ongoing)
                  </span>
                </Label>
                <Input
                  id="edu-end"
                  type="number"
                  inputMode="numeric"
                  placeholder="2024"
                  value={draft.endYearText}
                  min={YEAR_MIN}
                  max={YEAR_MAX}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      endYearText: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            {draftError ? (
              <p className="text-sm text-destructive">{draftError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={updateCandidate.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onSave}
              disabled={updateCandidate.isPending}
            >
              {updateCandidate.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
