import {
  useGetCandidateScoreBreakdown,
  getGetCandidateScoreBreakdownQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ArrowRight, TrendingUp } from "lucide-react";
import { Link } from "wouter";

export function TalentScoreBreakdown({ candidateId }: { candidateId: number }) {
  const { data, isLoading } = useGetCandidateScoreBreakdown(candidateId, {
    query: {
      queryKey: getGetCandidateScoreBreakdownQueryKey(candidateId),
      enabled: candidateId > 0,
    },
  });

  if (isLoading || !data) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-6">
          <div className="h-40 animate-pulse bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" /> How your Talent Score is built
            </CardTitle>
            <CardDescription>Five inputs feed your score. Improve any of them to climb the rankings.</CardDescription>
          </div>
          <div className="text-right">
            <p className="text-3xl font-extrabold text-primary leading-none">{data.score}</p>
            <p className="text-xs text-muted-foreground mt-1">/ 100</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          {data.components.map((c) => (
            <div key={c.key} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground">
                  {c.contribution} / {c.weight} pts
                </span>
              </div>
              <Progress value={c.score} className="h-2" />
            </div>
          ))}
        </div>

        {data.suggestions.length > 0 ? (
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Next actions
            </p>
            <ul className="space-y-2">
              {data.suggestions.map((s) => (
                <li key={s.key}>
                  <Link
                    to={s.link}
                    className="group flex items-start gap-3 rounded-lg border border-border/60 p-3 hover:border-primary/60 hover:bg-accent transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm group-hover:text-primary">{s.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                    </div>
                    <Badge variant="secondary" className="bg-primary/10 text-primary whitespace-nowrap">
                      +{s.impact} pts
                    </Badge>
                    <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary mt-1" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground border-t pt-4">
            You're maxed out on every input — keep applying to stay top of mind.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
