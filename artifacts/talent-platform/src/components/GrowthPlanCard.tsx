import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CheckCircle2, ExternalLink, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

type GrowthItem = {
  id: number;
  skill: string;
  status: "active" | "completed" | "dismissed";
  addedAt: string;
  completedAt: string | null;
  targetDate: string | null;
  rejectionCount: number;
  verificationUrl: string | null;
  resources: { title: string; url: string; estMinutes: number }[];
  estMinutes: number;
};

function formatTarget(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatHours(mins: number): string {
  const h = Math.round(mins / 60);
  if (h < 24) return `~${h}h`;
  const d = Math.round(h / 8);
  return `~${d} days of focused study`;
}

export function GrowthPlanCard() {
  const [items, setItems] = useState<GrowthItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [completeOpen, setCompleteOpen] = useState<string | null>(null);
  const [verifyUrl, setVerifyUrl] = useState("");

  const load = () =>
    customFetch<{ items: GrowthItem[] }>(`/api/me/growth-plan`)
      .then((d) => setItems(d?.items ?? []))
      .catch(() => setItems([]));

  useEffect(() => {
    load();
  }, []);

  const dismiss = async (skill: string) => {
    setBusy(skill);
    try {
      await customFetch(
        `/api/me/growth-plan/${encodeURIComponent(skill)}/dismiss`,
        { method: "POST" },
      );
      toast.success("Skill dismissed");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const complete = async (skill: string) => {
    setBusy(skill);
    try {
      const res = await customFetch<{
        ok: boolean;
        employersNotified: number;
      }>(`/api/me/growth-plan/${encodeURIComponent(skill)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verificationUrl: verifyUrl.trim() || undefined,
        }),
      });
      const tail =
        res && res.employersNotified > 0
          ? ` — ${res.employersNotified} employer${res.employersNotified === 1 ? "" : "s"} re-pinged`
          : "";
      toast.success(`Marked ${skill} as complete${tail}`);
      setCompleteOpen(null);
      setVerifyUrl("");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (items == null) return null;

  const active = items.filter((i) => i.status === "active");
  const completed = items.filter((i) => i.status === "completed");

  if (active.length === 0 && completed.length === 0) {
    return null;
  }

  return (
    <Card className="shadow-sm" data-testid="card-growth-plan">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          Your growth plan
          {active.length > 0 ? (
            <Badge variant="secondary" className="bg-primary/15 text-primary">
              {active.length} missing skill{active.length === 1 ? "" : "s"}{" "}
              holding you back
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Skills employers asked for on jobs you didn't land — close one and
          we'll re-ping the same employers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {active.map((item) => (
          <div
            key={item.id}
            className="border rounded-lg p-4 space-y-3"
            data-testid={`growth-skill-${item.skill}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold capitalize">{item.skill}</p>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    missed on {item.rejectionCount} job
                    {item.rejectionCount === 1 ? "" : "s"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatHours(item.estMinutes)}
                  {item.targetDate
                    ? ` · target ${formatTarget(item.targetDate)}`
                    : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => dismiss(item.skill)}
                disabled={busy === item.skill}
                aria-label="Dismiss skill"
                data-testid={`dismiss-${item.skill}`}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <ul className="space-y-1.5">
              {item.resources.map((r) => (
                <li key={r.url}>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {r.title}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
              ))}
            </ul>
            <Dialog
              open={completeOpen === item.skill}
              onOpenChange={(o) => {
                setCompleteOpen(o ? item.skill : null);
                if (!o) setVerifyUrl("");
              }}
            >
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  variant="default"
                  disabled={busy === item.skill}
                  data-testid={`complete-${item.skill}`}
                >
                  <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  Mark complete
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>I'm now skilled in {item.skill}</DialogTitle>
                  <DialogDescription>
                    We'll re-ping employers who previously rejected you for
                    needing this skill (rate-limited to once per quarter).
                    Optionally add a verification link — a certificate, repo,
                    or transcript — so they can see the proof.
                  </DialogDescription>
                </DialogHeader>
                <Input
                  type="url"
                  placeholder="https://… (optional verification URL)"
                  value={verifyUrl}
                  onChange={(e) => setVerifyUrl(e.target.value)}
                  data-testid={`verify-url-${item.skill}`}
                />
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setCompleteOpen(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => complete(item.skill)}
                    disabled={busy === item.skill}
                    data-testid={`confirm-complete-${item.skill}`}
                  >
                    Confirm
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        ))}
        {completed.length > 0 ? (
          <div className="pt-2 border-t">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Completed
            </p>
            <div className="flex flex-wrap gap-2">
              {completed.map((item) => (
                <Badge
                  key={item.id}
                  variant="outline"
                  className="border-emerald-500/50 text-emerald-700 dark:text-emerald-400 capitalize"
                  data-testid={`completed-${item.skill}`}
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" /> {item.skill}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
