import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Sparkles, GraduationCap, MapPin, Briefcase, Inbox } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

type Mentor = {
  id: number;
  fullName: string;
  headline: string;
  bio: string;
  avatarUrl: string;
  location: string;
  yearsExperience: number;
  skills: string[];
  institutions: { id: number; name: string; logoUrl: string }[];
  requestStatus: "pending" | "accepted" | "declined" | null;
};

export default function CandidateMentorsPage() {
  const { userId, role } = useAuth();
  const [mentors, setMentors] = useState<Mentor[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    if (!userId || role !== "candidate") return;
    const data = await customFetch<{ mentors: Mentor[] }>(
      `/api/candidates/${userId}/mentors`,
    );
    setMentors(data?.mentors ?? []);
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, role]);

  if (role !== "candidate") {
    return (
      <div className="container py-12">
        Only candidates can access mentorship.
      </div>
    );
  }

  return (
    <div className="container px-4 py-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-primary" /> Find a mentor
          </h1>
          <p className="text-muted-foreground mt-1">
            Alumni from your institution who are open to mentoring early-career
            talent.
          </p>
        </div>
        <Button asChild variant="outline" className="gap-2">
          <Link href="/dashboard/candidate/mentor-requests">
            <Inbox className="w-4 h-4" /> My requests
          </Link>
        </Button>
      </div>

      {mentors == null ? (
        <div className="animate-pulse h-48 bg-muted rounded-xl" />
      ) : mentors.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No alumni mentors are available yet at your verified institution(s).
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {mentors.map((m) => (
            <MentorCard
              key={m.id}
              mentor={m}
              candidateId={userId!}
              disabled={busy}
              onAfterRequest={() => {
                setBusy(false);
                reload();
              }}
              onBeforeRequest={() => setBusy(true)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MentorCard({
  mentor,
  candidateId,
  disabled,
  onBeforeRequest,
  onAfterRequest,
}: {
  mentor: Mentor;
  candidateId: number;
  disabled: boolean;
  onBeforeRequest: () => void;
  onAfterRequest: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const sent = mentor.requestStatus != null;

  const submit = async () => {
    if (message.trim().length < 10) {
      toast.error("Add a short note (10+ chars).");
      return;
    }
    onBeforeRequest();
    try {
      await customFetch(`/api/candidates/${candidateId}/mentor-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mentorCandidateId: mentor.id,
          message: message.trim(),
        }),
      });
      toast.success("Request sent!");
      setOpen(false);
      setMessage("");
    } catch (err) {
      toast.error((err as Error).message || "Could not send request");
    } finally {
      onAfterRequest();
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader>
        <div className="flex gap-4">
          <img
            src={mentor.avatarUrl || "/avatar-placeholder.png"}
            alt=""
            className="w-14 h-14 rounded-full object-cover bg-muted shrink-0"
          />
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{mentor.fullName}</CardTitle>
            <CardDescription className="truncate">
              {mentor.headline || "—"}
            </CardDescription>
            <div className="flex flex-wrap gap-2 mt-2">
              {mentor.location && (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {mentor.location}
                </span>
              )}
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Briefcase className="w-3 h-3" /> {mentor.yearsExperience}y exp
              </span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {mentor.bio && (
          <p className="text-sm text-muted-foreground line-clamp-3">{mentor.bio}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {mentor.institutions.map((i) => (
            <Badge
              key={i.id}
              variant="secondary"
              className="bg-primary/5 text-primary text-[11px] inline-flex items-center gap-1"
            >
              <GraduationCap className="w-3 h-3" /> {i.name}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {mentor.skills?.slice(0, 5).map((s) => (
            <Badge key={s} variant="outline" className="text-[10px]">
              {s}
            </Badge>
          ))}
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={sent || disabled} className="w-full" variant={sent ? "secondary" : "default"}>
              {sent
                ? mentor.requestStatus === "pending"
                  ? "Request pending"
                  : mentor.requestStatus === "accepted"
                    ? "Accepted — check inbox"
                    : "Declined"
                : "Request intro"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reach out to {mentor.fullName}</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                One short note. If they accept, you'll both see each other's
                emails to take it from there.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              placeholder="Hi! I'm a final-year CS student, would love your perspective on…"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={disabled}>
                Send request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

