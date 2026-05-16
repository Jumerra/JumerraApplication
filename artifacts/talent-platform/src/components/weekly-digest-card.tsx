import {
  useGetCandidateWeeklyDigest,
  getGetCandidateWeeklyDigestQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarRange, Eye, Send, Calendar, Target } from "lucide-react";
import { Link } from "wouter";

export function WeeklyDigestCard({ candidateId }: { candidateId: number }) {
  const { data } = useGetCandidateWeeklyDigest(candidateId, {
    query: {
      queryKey: getGetCandidateWeeklyDigestQueryKey(candidateId),
      enabled: candidateId > 0,
    },
  });

  const digest = data?.digest ?? null;

  if (!digest) {
    return (
      <Card className="shadow-sm border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange className="w-4 h-4 text-primary" /> Your week on Jumerra
          </CardTitle>
          <CardDescription>
            We send a fresh weekly digest every Monday. Your first one will land within a week.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const stats = [
    { label: "Profile views", value: digest.profileViews, icon: Eye },
    { label: "Applications sent", value: digest.applicationsSent, icon: Send },
    { label: "Interviews", value: digest.interviewsScheduled, icon: Calendar },
  ];

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="w-4 h-4 text-primary" /> Your week on Jumerra
        </CardTitle>
        <CardDescription>
          Week of {new Date(digest.weekStart).toLocaleDateString(undefined, { month: "long", day: "numeric" })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {stats.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-lg bg-muted/40 p-3 text-center">
              <Icon className="w-4 h-4 mx-auto text-muted-foreground" />
              <p className="text-2xl font-bold mt-1">{value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{label}</p>
            </div>
          ))}
        </div>
        {digest.newMatches.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Target className="w-3 h-3" /> New matches this week
            </p>
            <ul className="space-y-1.5">
              {digest.newMatches.slice(0, 3).map((m) => (
                <li key={m.jobId}>
                  <Link
                    to={`/jobs/${m.jobId}`}
                    className="flex items-center justify-between gap-3 rounded-md p-2 hover:bg-accent text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{m.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{m.employerName}</p>
                    </div>
                    <span className="text-xs font-semibold text-primary whitespace-nowrap">
                      {m.matchScore}% match
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
