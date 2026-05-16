import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Inbox, Send, Mail } from "lucide-react";
import { toast } from "sonner";

type Req = {
  id: number;
  direction: "incoming" | "outgoing";
  status: "pending" | "accepted" | "declined";
  message: string;
  institutionId: number;
  counterpart: {
    id: number;
    fullName: string;
    headline: string;
    avatarUrl: string;
    email: string | null;
  };
  createdAt: string;
  respondedAt: string | null;
};

export default function CandidateMentorRequestsPage() {
  const { userId, role } = useAuth();
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [tab, setTab] = useState<"incoming" | "outgoing">("incoming");

  const reload = async () => {
    if (!userId || role !== "candidate") return;
    const data = await customFetch<{ requests: Req[] }>(
      `/api/candidates/${userId}/mentor-requests`,
    );
    setReqs(data?.requests ?? []);
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, role]);

  const respond = async (id: number, status: "accepted" | "declined") => {
    try {
      await customFetch(`/api/mentor-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      toast.success(status === "accepted" ? "Accepted" : "Declined");
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (role !== "candidate") {
    return <div className="container py-12">Candidate-only.</div>;
  }

  const filtered = (reqs ?? []).filter((r) => r.direction === tab);

  return (
    <div className="container px-4 py-8 max-w-3xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold flex items-center gap-2">
        <Inbox className="w-7 h-7 text-primary" /> Mentor inbox
      </h1>
      <div className="flex gap-2">
        <Button
          variant={tab === "incoming" ? "default" : "outline"}
          onClick={() => setTab("incoming")}
        >
          Incoming
        </Button>
        <Button
          variant={tab === "outgoing" ? "default" : "outline"}
          onClick={() => setTab("outgoing")}
        >
          <Send className="w-4 h-4 mr-1" /> Sent
        </Button>
      </div>
      {reqs == null ? (
        <div className="animate-pulse h-48 bg-muted rounded-xl" />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No {tab} requests.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4 flex gap-4">
                <img
                  src={r.counterpart.avatarUrl || "/avatar-placeholder.png"}
                  alt=""
                  className="w-12 h-12 rounded-full bg-muted shrink-0 object-cover"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{r.counterpart.fullName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.counterpart.headline}
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
                    >
                      {r.status}
                    </Badge>
                  </div>
                  <p className="text-sm mt-2 whitespace-pre-wrap text-muted-foreground">
                    {r.message}
                  </p>
                  {r.status === "accepted" && r.counterpart.email && (
                    <a
                      href={`mailto:${r.counterpart.email}`}
                      className="mt-3 inline-flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <Mail className="w-4 h-4" /> {r.counterpart.email}
                    </a>
                  )}
                  {r.direction === "incoming" && r.status === "pending" && (
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" onClick={() => respond(r.id, "accepted")}>
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => respond(r.id, "declined")}
                      >
                        Decline
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
