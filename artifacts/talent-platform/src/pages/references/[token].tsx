import { useState } from "react";
import { useParams } from "wouter";
import {
  useViewRefereeForm,
  useSubmitRefereeForm,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const RELATIONSHIP_LABEL: Record<string, string> = {
  lecturer: "Lecturer / academic supervisor",
  past_employer: "Past employer",
  colleague: "Colleague",
  other: "Other",
};

export default function PublicReferenceFormPage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, refetch } = useViewRefereeForm(token);
  const submit = useSubmitRefereeForm();
  const [refereeName, setRefereeName] = useState("");
  const [refereeRole, setRefereeRole] = useState("");
  const [strengths, setStrengths] = useState("");
  const [wouldRehire, setWouldRehire] = useState<"" | "yes" | "no">("");
  const [submitted, setSubmitted] = useState(false);

  if (isLoading) {
    return <div className="container py-12 text-center text-muted-foreground">Loading…</div>;
  }
  if (!data) {
    return (
      <div className="container py-16 max-w-md mx-auto text-center">
        <h1 className="text-xl font-semibold mb-2">Link not valid</h1>
        <p className="text-muted-foreground text-sm">
          This reference link has expired or never existed.
        </p>
      </div>
    );
  }
  if (data.alreadySubmitted || submitted) {
    return (
      <div className="container py-16 max-w-md mx-auto text-center">
        <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-4" />
        <h1 className="text-xl font-semibold mb-2">Thanks for your reference</h1>
        <p className="text-muted-foreground text-sm">
          Your response has been recorded for {data.candidateName}.
        </p>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (refereeName.trim().length === 0 || strengths.trim().length < 10) {
      toast.error("Please share your name and a few sentences of feedback.");
      return;
    }
    try {
      await submit.mutateAsync({
        token,
        data: {
          refereeName: refereeName.trim(),
          refereeRole: refereeRole.trim() || null,
          wouldRehire:
            wouldRehire === "yes" ? true : wouldRehire === "no" ? false : null,
          strengths: strengths.trim(),
        },
      });
      setSubmitted(true);
      void refetch();
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Could not submit. Please try again.");
    }
  }

  return (
    <div className="container py-12 max-w-2xl mx-auto">
      <Card className="shadow-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <CardTitle>Reference for {data.candidateName}</CardTitle>
              <CardDescription>
                {data.candidateHeadline} · {RELATIONSHIP_LABEL[data.relationship] ?? data.relationship}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="ref-name">Your full name</Label>
              <Input
                id="ref-name"
                value={refereeName}
                onChange={(e) => setRefereeName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ref-role">Your role (optional)</Label>
              <Input
                id="ref-role"
                placeholder="e.g. Lecturer, CS Department"
                value={refereeRole}
                onChange={(e) => setRefereeRole(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Would you work with them again?</Label>
              <div className="flex gap-2">
                {(["yes", "no", ""] as const).map((v) => (
                  <Button
                    key={v || "skip"}
                    type="button"
                    variant={wouldRehire === v ? "default" : "outline"}
                    size="sm"
                    onClick={() => setWouldRehire(v)}
                  >
                    {v === "yes" ? "Yes" : v === "no" ? "No" : "Prefer not to say"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ref-strengths">Strengths and context</Label>
              <Textarea
                id="ref-strengths"
                rows={6}
                placeholder="What were they like to work with? Strengths, projects, growth areas…"
                value={strengths}
                onChange={(e) => setStrengths(e.target.value)}
                minLength={10}
                maxLength={4000}
                required
              />
              <p className="text-xs text-muted-foreground">
                Visible to employers viewing {data.candidateName}'s profile. Your email is never shown.
              </p>
            </div>
            <Button type="submit" disabled={submit.isPending} className="w-full">
              {submit.isPending ? "Submitting…" : "Submit reference"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
