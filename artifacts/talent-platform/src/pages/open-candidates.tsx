import { useState } from "react";
import { Link } from "wouter";
import {
  useListOpenCandidates,
  type OpenCandidateCard,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { Sparkles, GraduationCap, MapPin, Clock, Lock } from "lucide-react";

function timeLeft(closesAt: string): string {
  const diff = new Date(closesAt).getTime() - Date.now();
  if (diff <= 0) return "Closed";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h left`;
  return `${hours}h left`;
}

function PublicCard({ card }: { card: OpenCandidateCard }) {
  return (
    <Card className="shadow-sm flex flex-col" data-testid={`card-public-open-${card.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{card.headline}</CardTitle>
          <Badge variant="secondary" className="shrink-0">
            <Clock className="w-3 h-3 mr-1" />
            {timeLeft(card.closesAt)}
          </Badge>
        </div>
        <CardDescription className="flex items-center gap-1.5 text-xs">
          <MapPin className="w-3 h-3" /> {card.location} · {card.yearsExperience}y experience
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        {card.institutionName && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <GraduationCap className="w-3.5 h-3.5" /> {card.institutionName}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Badge className="bg-primary/10 text-primary border-primary/20">Talent {card.talentScore}</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {card.skills.slice(0, 6).map((s) => (
            <Badge key={s} variant="outline" className="text-xs font-normal">
              {s}
            </Badge>
          ))}
          {card.skills.length > 6 && (
            <Badge variant="outline" className="text-xs font-normal">
              +{card.skills.length - 6}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PublicOpenCandidatesPage() {
  const [skill, setSkill] = useState("");
  const { data: rows, isLoading } = useListOpenCandidates(skill ? { skill } : undefined);
  const { sessionUser } = useAuth();
  const isEmployer = sessionUser?.role === "employer";

  return (
    <div className="container px-4 py-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Open candidates</h1>
          <p className="text-sm text-muted-foreground">
            Anonymised candidates with active auction windows. Identities reveal only after an offer is accepted.
          </p>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-wrap gap-3 items-end justify-between">
          <div className="space-y-1.5 flex-1 min-w-[200px]">
            <Label htmlFor="skill">Filter by skill</Label>
            <Input
              id="skill"
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
              placeholder="e.g. React"
            />
          </div>
          {isEmployer ? (
            <Link href="/dashboard/employer/open-candidates">
              <Button>Go to employer board to send offers</Button>
            </Link>
          ) : (
            <Link href="/login">
              <Button variant="outline">
                <Lock className="w-4 h-4 mr-1.5" /> Sign in as employer to send offers
              </Button>
            </Link>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="animate-pulse h-[300px] bg-muted rounded-2xl" />
      ) : !rows || rows.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="p-10 text-center text-muted-foreground">
            <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No open candidates right now</p>
            <p className="text-sm mt-1">Check back as candidates open their auction windows.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((card) => (
            <PublicCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
