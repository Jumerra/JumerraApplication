import {
  useGetJob,
  useCreateApplication,
  useAiDraftCoverNote,
  useGetJobChallenge,
  useSubmitJobChallenge,
  getListApplicationsQueryKey,
  getGetCandidateDashboardQueryKey,
  getGetJobQueryKey,
  getGetJobChallengeQueryKey,
} from "@workspace/api-client-react";
import { Link, useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, MapPin, Banknote, Sparkles, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const formSchema = z.object({
  coverNote: z
    .string()
    .min(30, "Your cover note must be at least 30 characters long to make a good impression."),
});

export default function JobApply() {
  const { jobId } = useParams();
  const { userId, role } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const numericJobId = Number(jobId);
  const { data: job, isLoading } = useGetJob(numericJobId);
  // Probe for an attached challenge. Server returns 404 if none, so
  // we suppress retries and treat any error as "no challenge".
  const challengeQuery = useGetJobChallenge(numericJobId, {
    query: {
      retry: false,
      queryKey: getGetJobChallengeQueryKey(numericJobId),
    },
  });
  const applyMutation = useCreateApplication();
  const draftMutation = useAiDraftCoverNote();
  const submitChallenge = useSubmitJobChallenge();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { coverNote: "" },
  });

  // Indexed by question.index → chosen option index.
  const [answers, setAnswers] = useState<Record<number, number>>({});

  if (role !== "candidate") {
    return (
      <div className="container py-20 text-center text-muted-foreground">
        You must view as a Candidate to apply for jobs.
      </div>
    );
  }

  if (isLoading || challengeQuery.isLoading) {
    return (
      <div className="container py-12 px-4">
        <div className="animate-pulse h-64 bg-muted rounded-2xl" />
      </div>
    );
  }

  if (!job) return null;

  const challenge = challengeQuery.data ?? null;

  const onSubmitCoverNote = (values: z.infer<typeof formSchema>) => {
    if (!userId) return;
    applyMutation.mutate(
      {
        data: {
          jobId: numericJobId,
          candidateId: userId,
          coverNote: values.coverNote,
        },
      },
      {
        onSuccess: () => {
          toast.success("Application submitted successfully!");
          queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getGetCandidateDashboardQueryKey(userId),
          });
          queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(numericJobId) });
          setLocation("/dashboard/candidate");
        },
        onError: (err: unknown) => {
          // The server rejects cover-note applies with 409 +
          // `requiresChallenge: true` when a skill challenge is
          // attached. Surface that specifically — and refetch the
          // challenge so the page re-renders into the challenge
          // gate — instead of the generic "already applied" hint
          // that confused users.
          const apiErr = err as {
            status?: number;
            data?: { requiresChallenge?: boolean };
          };
          if (apiErr?.status === 409 && apiErr.data?.requiresChallenge) {
            toast.error(
              "This job now requires a skill challenge. Loading it for you…",
            );
            challengeQuery.refetch();
            return;
          }
          if (apiErr?.status === 409) {
            toast.error("You've already applied to this job.");
            return;
          }
          toast.error("Failed to submit application. Please try again.");
        },
      },
    );
  };

  const onSubmitChallenge = () => {
    if (!userId || !challenge) return;
    const ordered = challenge.questions.map((q) => answers[q.index] ?? -1);
    if (ordered.some((a) => a < 0)) {
      toast.error("Please answer every question before submitting.");
      return;
    }
    submitChallenge.mutate(
      { id: numericJobId, data: { answers: ordered } },
      {
        onSuccess: (resp) => {
          toast.success(
            resp.alreadySubmitted
              ? `Already submitted — score ${resp.score}/100`
              : `Submitted — score ${resp.score}/100`,
          );
          queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getGetCandidateDashboardQueryKey(userId),
          });
          queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(numericJobId) });
          setLocation("/dashboard/candidate");
        },
        onError: () => {
          toast.error("Couldn't submit your challenge. Please try again.");
        },
      },
    );
  };

  const onDraft = () => {
    if (!userId) return;
    const regenerate = (form.getValues("coverNote") ?? "").trim().length > 0;
    draftMutation.mutate(
      { id: userId, data: { jobId: numericJobId, regenerate } },
      {
        onSuccess: (resp) => {
          form.setValue("coverNote", resp.draft, {
            shouldValidate: true,
            shouldDirty: true,
          });
          toast.success(
            resp.fromCache
              ? "Loaded your saved AI draft"
              : "Draft ready — tweak it to make it yours.",
          );
        },
        onError: (err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Couldn't draft a cover note";
          toast.error(message);
        },
      },
    );
  };

  return (
    <div className="container px-4 py-8 max-w-3xl mx-auto">
      <Button
        variant="ghost"
        asChild
        className="mb-6 -ml-4 text-muted-foreground hover:text-foreground"
      >
        <Link href={`/jobs/${job.id}`}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to job
        </Link>
      </Button>

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Apply for Role</h1>
        <p className="text-muted-foreground">
          Submit your application to {job.employerName}
        </p>
      </div>

      <Card className="mb-8 border-primary/20 bg-primary/5 shadow-sm">
        <CardContent className="p-6 flex flex-col md:flex-row gap-6 items-start">
          <img
            src={job.employerLogoUrl}
            alt=""
            className="w-16 h-16 rounded-xl object-cover border bg-background"
          />
          <div>
            <h2 className="text-xl font-bold mb-1">{job.title}</h2>
            <p className="text-muted-foreground mb-3">{job.employerName}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="capitalize bg-background">
                {job.type.replace("_", " ")}
              </Badge>
              <Badge variant="outline" className="flex items-center gap-1 bg-background">
                <MapPin className="w-3 h-3" /> {job.remote ? "Remote" : job.location}
              </Badge>
              {job.salaryMin && (
                <Badge
                  variant="outline"
                  className="bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 border-green-200"
                >
                  <Banknote className="w-3 h-3 mr-1" />
                  {job.currency} {(job.salaryMin / 1000).toFixed(0)}k -{" "}
                  {(job.salaryMax! / 1000).toFixed(0)}k
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {challenge ? (
        <Card className="shadow-sm" data-testid="card-skill-challenge">
          <CardContent className="p-6 md:p-8 space-y-6">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                {challenge.title}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Answer the questions below — your score (0–100) is sent
                to the employer instead of a cover note. You can only
                submit once.
              </p>
              <div
                className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-primary"
                data-testid="text-challenge-duration"
              >
                <Badge variant="outline" className="bg-primary/5 border-primary/30">
                  Challenge: ~
                  {Math.max(1, Math.round(challenge.durationSeconds / 60))} min
                  · {challenge.questions.length} questions
                </Badge>
              </div>
            </div>

            <div className="space-y-6">
              {challenge.questions.map((q) => (
                <div key={q.index} className="space-y-2">
                  <div className="font-medium">
                    {q.index + 1}. {q.prompt}
                  </div>
                  <div className="space-y-1.5">
                    {q.options.map((opt, optIdx) => {
                      const checked = answers[q.index] === optIdx;
                      return (
                        <label
                          key={optIdx}
                          className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                            checked
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-muted/50"
                          }`}
                          data-testid={`option-${q.index}-${optIdx}`}
                        >
                          <input
                            type="radio"
                            name={`q-${q.index}`}
                            checked={checked}
                            onChange={() =>
                              setAnswers((prev) => ({ ...prev, [q.index]: optIdx }))
                            }
                            className="mt-1"
                          />
                          <span className="text-sm">{opt}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t flex justify-end">
              <Button
                size="lg"
                className="w-full md:w-auto"
                disabled={submitChallenge.isPending}
                onClick={onSubmitChallenge}
                data-testid="button-submit-challenge"
              >
                {submitChallenge.isPending
                  ? "Grading..."
                  : "Submit challenge & apply"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="p-6 md:p-8">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmitCoverNote)}
                className="space-y-6"
              >
                <FormField
                  control={form.control}
                  name="coverNote"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                          <FormLabel className="text-base font-semibold">
                            Cover Note
                          </FormLabel>
                          <p className="text-sm text-muted-foreground mt-1">
                            Why are you a great fit for this role? What makes you
                            excited about {job.employerName}?
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={onDraft}
                          disabled={draftMutation.isPending}
                          data-testid="button-ai-draft-cover-note"
                        >
                          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                          {draftMutation.isPending ? "Drafting..." : "Draft with AI"}
                        </Button>
                      </div>
                      <FormControl>
                        <Textarea
                          className="min-h-[250px] resize-y mt-3"
                          placeholder="I'm excited to apply for this role because..."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="pt-4 border-t flex justify-end">
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full md:w-auto"
                    disabled={applyMutation.isPending}
                  >
                    {applyMutation.isPending ? "Submitting..." : "Submit Application"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
