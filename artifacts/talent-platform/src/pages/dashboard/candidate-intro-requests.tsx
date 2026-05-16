import { useEffect, useState, useCallback } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Inbox, Send } from "lucide-react";
import { toast } from "sonner";

type IntroReq = {
  id: number;
  status: "pending" | "accepted" | "declined";
  response: string | null;
  jobId: number;
  jobTitle: string;
  employerId: number;
  employerName: string;
  employerLogoUrl: string | null;
  candidateId: number;
  candidateName: string;
  candidateAvatarUrl: string | null;
  candidateHeadline: string | null;
  createdAt: string;
  respondedAt: string | null;
};

type IntroData = { inbox: IntroReq[]; sent: IntroReq[] };

export default function CandidateIntroRequestsPage() {
  const { role } = useAuth();
  const [data, setData] = useState<IntroData | null>(null);
  const [tab, setTab] = useState<"inbox" | "sent">("inbox");
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const reload = useCallback(async () => {
    const res = await customFetch<IntroData>(`/api/me/intro-requests`);
    setData(res ?? { inbox: [], sent: [] });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const respond = async (id: number, accept: boolean) => {
    try {
      await customFetch(`/api/me/intro-requests/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept, message: drafts[id] || undefined }),
      });
      toast.success(accept ? "Endorsement sent." : "Declined.");
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (role !== "candidate") {
    return <div className="container py-12">Candidate-only.</div>;
  }

  const rows = tab === "inbox" ? data?.inbox ?? [] : data?.sent ?? [];

  return (
    <div className="container px-4 py-8 max-w-3xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">
        <Inbox className="w-7 h-7 text-primary" /> Intro requests
      </h1>
      <p className="text-sm text-muted-foreground">
        Job-seekers from your institution can ask you to vouch for them when
        they apply to your current employer. Your response shows on their
        application card.
      </p>
      <div className="flex gap-2">
        <Button
          variant={tab === "inbox" ? "default" : "outline"}
          onClick={() => setTab("inbox")}
          data-testid="tab-intro-inbox"
        >
          <Inbox className="w-4 h-4 mr-1" /> Inbox ({data?.inbox.length ?? 0})
        </Button>
        <Button
          variant={tab === "sent" ? "default" : "outline"}
          onClick={() => setTab("sent")}
          data-testid="tab-intro-sent"
        >
          <Send className="w-4 h-4 mr-1" /> Sent ({data?.sent.length ?? 0})
        </Button>
      </div>

      {data == null ? (
        <div className="animate-pulse h-48 bg-muted rounded-xl" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No {tab === "inbox" ? "incoming" : "sent"} requests.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const counterpart =
              tab === "inbox"
                ? {
                    name: r.candidateName,
                    avatar: r.candidateAvatarUrl,
                    sub: r.candidateHeadline,
                  }
                : {
                    name: r.employerName,
                    avatar: r.employerLogoUrl,
                    sub: r.jobTitle,
                  };
            return (
              <Card key={r.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <img
                      src={counterpart.avatar || "/avatar-placeholder.png"}
                      alt=""
                      className="w-12 h-12 rounded-full bg-muted shrink-0 object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <p className="font-semibold">{counterpart.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {counterpart.sub}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={
                            r.status === "accepted"
                              ? "border-green-500 text-green-600"
                              : r.status === "declined"
                                ? "border-red-500 text-red-600"
                                : ""
                          }
                          data-testid={`status-intro-${r.id}`}
                        >
                          {r.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        For <span className="font-medium">{r.jobTitle}</span> at{" "}
                        <span className="font-medium">{r.employerName}</span>
                      </p>
                      {r.response ? (
                        <p className="text-sm mt-2 p-2 rounded bg-muted/60 italic">
                          “{r.response}”
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {tab === "inbox" && r.status === "pending" ? (
                    <div className="space-y-2 pl-15">
                      <Textarea
                        placeholder="Optional one-line endorsement (max 280 chars)…"
                        maxLength={280}
                        value={drafts[r.id] ?? ""}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [r.id]: e.target.value }))
                        }
                        data-testid={`textarea-intro-${r.id}`}
                      />
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => respond(r.id, false)}
                          data-testid={`button-decline-${r.id}`}
                        >
                          Decline
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => respond(r.id, true)}
                          data-testid={`button-accept-${r.id}`}
                        >
                          Accept & endorse
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
