import { useEffect, useState, useCallback } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Users, Send, Check } from "lucide-react";
import { toast } from "sonner";

type AlumniSample = {
  alumniUserId: number;
  candidateId: number;
  fullName: string;
  avatarUrl: string;
  headline: string;
  requestStatus: "pending" | "accepted" | "declined" | null;
};

type AlumniPanelData = {
  institution: { id: number; name: string } | null;
  employer: { id: number; name: string };
  count: number;
  sample: AlumniSample[];
};

/**
 * Shown on the job-detail page for signed-in candidates. Displays
 * alumni from the candidate's verified institution(s) who currently
 * work at the job's employer, with a one-click "Request intro" CTA
 * per alumni. Server enforces throttle (max 3 per job / 1 per alumni
 * per 30 days) so we just surface the 4xx as a toast.
 */
export function AlumniIntroPanel({ jobId }: { jobId: number }) {
  const [data, setData] = useState<AlumniPanelData | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await customFetch<AlumniPanelData>(
        `/api/jobs/${jobId}/alumni-at-employer`,
      );
      setData(res ?? null);
    } catch {
      setData(null);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data || data.count === 0 || !data.institution) return null;

  const request = async (alumniUserId: number) => {
    setPending(alumniUserId);
    try {
      await customFetch(`/api/jobs/${jobId}/intro-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alumniUserId }),
      });
      toast.success("Intro request sent.");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <Card
      className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent"
      data-testid="panel-alumni-intros"
    >
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <GraduationCap className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              {data.count} alumni from {data.institution.name} work at{" "}
              {data.employer.name}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Ask for a quick endorsement — one tap, optional sentence. Shown
              on your application card.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {data.sample.map((a) => (
            <div
              key={a.alumniUserId}
              className="flex items-center gap-3 rounded-md border bg-background/70 p-2"
              data-testid={`alumni-row-${a.alumniUserId}`}
            >
              <img
                src={a.avatarUrl || "/avatar-placeholder.png"}
                alt=""
                className="w-9 h-9 rounded-full object-cover bg-muted shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{a.fullName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {a.headline}
                </p>
              </div>
              {a.requestStatus === "accepted" ? (
                <Badge
                  variant="outline"
                  className="border-green-500 text-green-600"
                >
                  <Check className="w-3 h-3 mr-1" /> Accepted
                </Badge>
              ) : a.requestStatus === "declined" ? (
                <Badge variant="outline" className="text-muted-foreground">
                  Declined
                </Badge>
              ) : a.requestStatus === "pending" ? (
                <Badge
                  variant="outline"
                  className="border-primary/40 text-primary"
                >
                  Requested
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending === a.alumniUserId}
                  onClick={() => request(a.alumniUserId)}
                  data-testid={`button-request-intro-${a.alumniUserId}`}
                >
                  <Send className="w-3 h-3 mr-1" />
                  Request intro
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
