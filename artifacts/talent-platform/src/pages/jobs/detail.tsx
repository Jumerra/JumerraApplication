import {
  useGetJob,
  useGetJobMatches,
  useGetJobChallenge,
  useGetCandidate,
  getGetJobMatchesQueryKey,
  getGetJobChallengeQueryKey,
  getGetCandidateQueryKey,
} from "@workspace/api-client-react";
import { Link, useParams } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Building2, Calendar, Banknote, CheckCircle2, UserCircle, Star, Megaphone, Clock } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { InterviewPrepPanel } from "@/components/InterviewPrepPanel";
import { SalaryBand } from "@/components/SalaryBand";

export default function JobDetail() {
  const { id } = useParams();
  const { role, userId } = useAuth();
  
  const { data: job, isLoading } = useGetJob(Number(id));
  const { data: matches } = useGetJobMatches(Number(id), {
    query: {
      queryKey: getGetJobMatchesQueryKey(Number(id)),
      enabled: role === "employer" && !!id,
    },
  });
  // Show "Challenge: ~N min" badge and sample-preview when one is
  // attached. retry: false because /jobs/:id/challenge returns 404
  // for jobs without one and we don't want to spam.
  const { data: challenge } = useGetJobChallenge(Number(id), {
    query: {
      queryKey: getGetJobChallengeQueryKey(Number(id)),
      retry: false,
      enabled: !!id,
    },
  });
  const [showSample, setShowSample] = useState(false);
  // For signed-in candidates, fetch their primary institution so the
  // job-detail page can also show a "Hires from your school earned…"
  // band scoped to that institution alongside the platform-wide band.
  const { data: candidate } = useGetCandidate(userId ?? 0, {
    query: {
      queryKey: getGetCandidateQueryKey(userId ?? 0),
      enabled: role === "candidate" && !!userId,
    },
  });
  const candidateInstitutionId =
    candidate?.institutions?.find((i) => i.isPrimary)?.id ??
    candidate?.institutions?.[0]?.id ??
    candidate?.institutionId ??
    undefined;

  if (isLoading) {
    return <div className="container py-12"><div className="animate-pulse h-96 bg-muted rounded-xl" /></div>;
  }

  if (!job) return null;

  return (
    <div className="container py-8 max-w-5xl mx-auto">
      <div className="flex gap-4 items-center text-sm text-muted-foreground mb-8">
        <Link href="/jobs" className="hover:text-foreground transition-colors">Jobs</Link>
        <span>/</span>
        <Link href={`/employers/${job.employerId}`} className="hover:text-foreground transition-colors">{job.employerName}</Link>
        <span>/</span>
        <span className="text-foreground">{job.title}</span>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div>
            <div className="flex items-center gap-4 mb-6">
              <img src={job.employerLogoUrl} alt="" className="w-20 h-20 rounded-xl object-cover border" />
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <h1 className="text-3xl font-bold tracking-tight">{job.title}</h1>
                  {job.tier === "sponsored" && (
                    <Badge
                      data-testid="badge-tier-sponsored"
                      className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                    >
                      <Star className="w-3 h-3 mr-1" /> Sponsored
                    </Badge>
                  )}
                  {job.tier === "promoted" && (
                    <Badge
                      data-testid="badge-tier-promoted"
                      className="bg-primary/15 text-primary border-primary/30"
                    >
                      <Megaphone className="w-3 h-3 mr-1" /> Promoted
                    </Badge>
                  )}
                </div>
                <p className="text-lg text-muted-foreground">{job.employerName}</p>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-3 mb-8">
              <Badge variant="secondary" className="px-3 py-1 text-sm font-medium capitalize">
                {job.type.replace('_', ' ')}
              </Badge>
              <Badge variant="outline" className="px-3 py-1 text-sm font-medium">
                <MapPin className="w-4 h-4 mr-2" />
                {job.remote ? "Remote" : job.location}
              </Badge>
              {job.salaryMin && (
                <Badge variant="outline" className="px-3 py-1 text-sm font-medium bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 border-green-200 dark:border-green-500/20">
                  <Banknote className="w-4 h-4 mr-2" />
                  {job.currency} {job.salaryMin.toLocaleString()} - {job.salaryMax?.toLocaleString()}
                </Badge>
              )}
              {challenge ? (
                <Badge
                  variant="outline"
                  className="px-3 py-1 text-sm font-medium bg-primary/5 text-primary border-primary/30"
                  data-testid="badge-job-challenge"
                >
                  <Clock className="w-4 h-4 mr-2" />
                  Challenge: ~
                  {Math.max(1, Math.round(challenge.durationSeconds / 60))} min
                </Badge>
              ) : null}
            </div>

            {challenge && (role === "candidate" || !role) ? (
              <div
                className="mb-8 rounded-xl border border-primary/20 bg-primary/5 p-4"
                data-testid="panel-challenge-info"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-semibold text-primary">
                      This role uses a skill challenge instead of a cover note
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      A short multiple-choice quiz built from this job's skills.
                      You'll get a 0–100 score the employer sees on your
                      application.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setShowSample((v) => !v)}
                    data-testid="button-sample-challenge"
                  >
                    {showSample ? "Hide sample" : "Preview a sample question"}
                  </Button>
                </div>
                {showSample && challenge.questions.length > 0 ? (
                  <div
                    className="mt-3 rounded-md border bg-background p-3"
                    data-testid="sample-challenge-question"
                  >
                    <div className="text-sm font-medium">
                      {challenge.questions[0]!.prompt}
                    </div>
                    <ul className="mt-2 ml-5 list-disc text-sm text-muted-foreground">
                      {challenge.questions[0]!.options.map((opt, i) => (
                        <li key={i}>{opt}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="prose dark:prose-invert max-w-none">
              <h2 className="text-xl font-semibold mb-4">About the Role</h2>
              <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {job.description}
              </p>

              <h2 className="text-xl font-semibold mt-8 mb-4">Responsibilities</h2>
              <ul className="space-y-2">
                {job.responsibilities.map((req, i) => (
                  <li key={i} className="flex gap-3 text-muted-foreground">
                    <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <span>{req}</span>
                  </li>
                ))}
              </ul>

              <h2 className="text-xl font-semibold mt-8 mb-4">Requirements</h2>
              <ul className="space-y-2">
                {job.requirements.map((req, i) => (
                  <li key={i} className="flex gap-3 text-muted-foreground">
                    <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <span>{req}</span>
                  </li>
                ))}
              </ul>
              
              {role === "candidate" && userId && job.id && (
                <div className="mt-8 not-prose">
                  <InterviewPrepPanel candidateId={userId} jobId={job.id} />
                </div>
              )}

              {job.benefits?.length > 0 && (
                <>
                  <h2 className="text-xl font-semibold mt-8 mb-4">Benefits</h2>
                  <ul className="space-y-2">
                    {job.benefits.map((req, i) => (
                      <li key={i} className="flex gap-3 text-muted-foreground">
                        <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                        <span>{req}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <Card className="sticky top-24 shadow-md border-primary/10">
            <CardContent className="p-6">
              <div className="space-y-6">
                {role === "candidate" || !role ? (
                  <div className="space-y-2">
                    <Button className="w-full h-12 text-lg font-medium" asChild>
                      <Link href={`/apply/${job.id}`}>Apply Now</Link>
                    </Button>
                    {role === "candidate" ? (
                      <Button
                        variant="outline"
                        className="w-full h-11"
                        asChild
                        data-testid="button-mock-interview-cta"
                      >
                        <Link href={`/jobs/${job.id}/mock-interview`}>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Take AI mock interview
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 p-3 text-center text-sm text-muted-foreground">
                    Only candidates can apply for jobs. You're signed in as
                    a {role}.
                  </div>
                )}
                
                <div className="pt-6 border-t space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2"><Calendar className="w-4 h-4"/> Posted</span>
                    <span className="font-medium">{new Date(job.postedAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2"><UserCircle className="w-4 h-4"/> Applicants</span>
                    <span className="font-medium">{job.applicationsCount}</span>
                  </div>
                </div>

                {job.id ? (
                  <div className="pt-6 border-t space-y-3">
                    <SalaryBand jobId={job.id} />
                    {candidateInstitutionId ? (
                      <SalaryBand
                        jobId={job.id}
                        institutionId={candidateInstitutionId}
                      />
                    ) : null}
                  </div>
                ) : null}

                <div className="pt-6 border-t">
                  <h4 className="text-sm font-semibold mb-3">Required Skills</h4>
                  <div className="flex flex-wrap gap-2">
                    {job.skills.map(skill => (
                      <Badge key={skill} variant="secondary" className="bg-primary/5 text-primary border-transparent">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {role === "employer" && matches && matches.length > 0 && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Top AI Matches
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                {matches.slice(0,3).map(match => (
                  <Link key={match.candidateId} href={`/candidates/${match.candidateId}`}>
                    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-background/80 transition-colors cursor-pointer border border-transparent hover:border-border">
                      <img src={match.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{match.fullName}</p>
                        <p className="text-xs text-muted-foreground truncate">{match.headline}</p>
                      </div>
                      <Badge variant="secondary" className="bg-primary/10 text-primary shrink-0">
                        {match.matchScore}%
                      </Badge>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
import { Sparkles } from "lucide-react";
