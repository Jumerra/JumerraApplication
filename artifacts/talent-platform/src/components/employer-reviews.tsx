import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Star, MessageSquare, GraduationCap } from "lucide-react";
import { toast } from "sonner";

type Review = {
  id: number;
  rating: number;
  body: string;
  createdAt: string;
  candidate: { id: number; fullName: string; avatarUrl: string; headline: string };
  institution: { id: number; name: string; logoUrl: string };
};

export function EmployerReviews({ employerId }: { employerId: number }) {
  const { userId, role } = useAuth();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [institutionId, setInstitutionId] = useState<number | null>(null);
  const [myInsts, setMyInsts] = useState<{ id: number; name: string }[]>([]);
  const [canReview, setCanReview] = useState(false);

  const reload = async () => {
    const data = await customFetch<{ reviews: Review[] }>(
      `/api/employers/${employerId}/reviews`,
    );
    setReviews(data?.reviews ?? []);
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employerId]);

  // Only verified hires of THIS employer can write a review. The server
  // is the source of truth — it returns the candidate's verified
  // institutions only when they actually have a hired application here.
  useEffect(() => {
    if (role !== "candidate" || !userId) return;
    customFetch<{
      canReview: boolean;
      institutions: { id: number; name: string }[];
    }>(`/api/employers/${employerId}/reviews/eligibility`)
      .then((data) => {
        setCanReview(!!data?.canReview);
        const insts = data?.institutions ?? [];
        setMyInsts(insts);
        if (insts.length > 0) setInstitutionId(insts[0].id);
      })
      .catch(() => setCanReview(false));
  }, [role, userId, employerId]);

  const grouped = (reviews ?? []).reduce<Record<string, Review[]>>((acc, r) => {
    const k = r.institution.name;
    (acc[k] ||= []).push(r);
    return acc;
  }, {});

  const submit = async () => {
    if (body.trim().length < 20) {
      toast.error("Reviews must be at least 20 characters.");
      return;
    }
    if (institutionId == null) {
      toast.error("Select your verified institution.");
      return;
    }
    try {
      await customFetch(`/api/employers/${employerId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, body: body.trim(), institutionId }),
      });
      toast.success("Review submitted! It'll appear here once approved.");
      setOpen(false);
      setBody("");
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2 text-xl">
          <MessageSquare className="w-5 h-5" /> Employee reviews
        </CardTitle>
        {role === "candidate" && canReview && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Write review</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Share your experience</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Rating</label>
                  <div className="flex gap-1 mt-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setRating(n)}
                        className="p-1"
                      >
                        <Star
                          className={`w-6 h-6 ${n <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
                        />
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Reviewing as alumni of</label>
                  <select
                    value={institutionId ?? ""}
                    onChange={(e) => setInstitutionId(Number(e.target.value))}
                    className="w-full mt-1 px-3 py-2 border rounded-md bg-background"
                  >
                    {myInsts.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  placeholder="What was the work culture, growth, day-to-day actually like?"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={submit}>Submit for review</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {reviews == null ? (
          <div className="animate-pulse h-32 bg-muted rounded-xl" />
        ) : reviews.length === 0 ? (
          <p className="text-muted-foreground">
            No reviews yet — only verified hires can post.
          </p>
        ) : (
          Object.entries(grouped).map(([instName, list]) => (
            <div key={instName}>
              <h4 className="text-sm font-semibold mb-3 inline-flex items-center gap-2 text-muted-foreground">
                <GraduationCap className="w-4 h-4" /> Reviews from {instName}{" "}
                alumni
              </h4>
              <div className="space-y-3">
                {list.map((r) => (
                  <div key={r.id} className="border rounded-xl p-4">
                    <div className="flex items-center gap-3">
                      <img
                        src={r.candidate.avatarUrl || "/avatar-placeholder.png"}
                        alt=""
                        className="w-10 h-10 rounded-full bg-muted"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">
                          {r.candidate.fullName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {r.candidate.headline}
                        </p>
                      </div>
                      <div className="flex items-center">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star
                            key={n}
                            className={`w-4 h-4 ${n <= r.rating ? "fill-yellow-400 text-yellow-400" : "text-muted"}`}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="text-sm mt-3 whitespace-pre-wrap">{r.body}</p>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
