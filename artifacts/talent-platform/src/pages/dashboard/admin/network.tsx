import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Star } from "lucide-react";
import { toast } from "sonner";

type ReviewItem = {
  id: number;
  rating: number;
  body: string;
  status: string;
  createdAt: string;
  candidate: { id: number; fullName: string; avatarUrl: string };
  employer: { id: number; name: string; logoUrl: string };
  institution: { id: number; name: string };
};

type StoryItem = {
  id: number;
  quote: string;
  photoUrl: string | null;
  status: string;
  sortOrder: number;
  createdAt: string;
  candidate: { id: number; fullName: string; avatarUrl: string };
  employer: { id: number; name: string; logoUrl: string };
};

export default function AdminNetworkPage() {
  const [reviews, setReviews] = useState<ReviewItem[] | null>(null);
  const [stories, setStories] = useState<StoryItem[] | null>(null);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");

  const reload = async () => {
    const [r, s] = await Promise.all([
      customFetch<{ reviews: ReviewItem[] }>(
        `/api/admin/employer-reviews?status=${filter}`,
      ),
      customFetch<{ stories: StoryItem[] }>(
        `/api/admin/placement-stories?status=${filter}`,
      ),
    ]);
    setReviews(r?.reviews ?? []);
    setStories(s?.stories ?? []);
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const moderateReview = async (id: number, status: "approved" | "rejected") => {
    try {
      await customFetch(`/api/admin/employer-reviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      toast.success(status);
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const moderateStory = async (
    id: number,
    status: "approved" | "rejected",
    sortOrder?: number,
  ) => {
    try {
      await customFetch(`/api/admin/placement-stories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          ...(sortOrder != null ? { sortOrder } : {}),
        }),
      });
      toast.success(status);
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="container px-4 py-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ShieldCheck className="w-7 h-7 text-primary" /> Community moderation
        </h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="px-3 py-2 border rounded-md bg-background"
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Employer reviews</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {reviews == null ? (
            <div className="animate-pulse h-24 bg-muted rounded" />
          ) : reviews.length === 0 ? (
            <p className="text-muted-foreground">Nothing here.</p>
          ) : (
            reviews.map((r) => (
              <div key={r.id} className="border rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={r.candidate.avatarUrl || "/avatar-placeholder.png"}
                      alt=""
                      className="w-10 h-10 rounded-full bg-muted"
                    />
                    <div>
                      <p className="font-semibold text-sm">
                        {r.candidate.fullName} → {r.employer.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Alumni of {r.institution.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          className={`w-4 h-4 ${n <= r.rating ? "fill-yellow-400 text-yellow-400" : "text-muted"}`}
                        />
                      ))}
                    </div>
                    <Badge variant="outline">{r.status}</Badge>
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap">{r.body}</p>
                {r.status === "pending" && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => moderateReview(r.id, "approved")}>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => moderateReview(r.id, "rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Placement stories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {stories == null ? (
            <div className="animate-pulse h-24 bg-muted rounded" />
          ) : stories.length === 0 ? (
            <p className="text-muted-foreground">Nothing here.</p>
          ) : (
            stories.map((s) => (
              <div key={s.id} className="border rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={s.candidate.avatarUrl || "/avatar-placeholder.png"}
                      alt=""
                      className="w-10 h-10 rounded-full bg-muted"
                    />
                    <div>
                      <p className="font-semibold text-sm">
                        {s.candidate.fullName} → {s.employer.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Order: {s.sortOrder}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline">{s.status}</Badge>
                </div>
                <p className="text-sm italic">"{s.quote}"</p>
                {s.status === "pending" && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => moderateStory(s.id, "approved", 100)}>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => moderateStory(s.id, "rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
