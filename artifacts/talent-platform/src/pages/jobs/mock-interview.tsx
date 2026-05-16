/**
 * AI mock interview chat page for a specific job.
 *
 * Flow: start → answer each question → finalise. The page is
 * idempotent on start (server returns the existing in-progress row).
 * After finalise we show the score breakdown and a "Back to job" link.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import {
  useStartMockInterview,
  useAnswerMockInterview,
  useFinaliseMockInterview,
  useGetJob,
  type MockInterview,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Bot, Send, Sparkles, User2 } from "lucide-react";
import { toast } from "sonner";

export default function MockInterviewPage() {
  const { jobId: jobIdParam } = useParams<{ jobId: string }>();
  const jobId = Number(jobIdParam);
  const { role } = useAuth();
  const { data: job } = useGetJob(jobId);
  const [interview, setInterview] = useState<MockInterview | null>(null);
  const [draft, setDraft] = useState("");
  const startMutation = useStartMockInterview();
  const answerMutation = useAnswerMockInterview();
  const finaliseMutation = useFinaliseMockInterview();
  const startedRef = useRef(false);

  useEffect(() => {
    if (
      !startedRef.current &&
      role === "candidate" &&
      Number.isInteger(jobId) &&
      jobId > 0
    ) {
      startedRef.current = true;
      startMutation.mutate(
        { data: { jobId } },
        {
          onSuccess: (data) => setInterview(data),
          onError: (err: unknown) => {
            const msg =
              err instanceof Error ? err.message : "Could not start interview";
            toast.error(msg);
          },
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, role]);

  const questions = interview?.questions ?? [];
  const transcript = interview?.transcript ?? [];
  const answeredCount = transcript.length;
  const totalCount = questions.length;
  const currentQuestion = questions[answeredCount];
  const isFinalised = interview?.status === "finalised";
  const isLastAnswered = totalCount > 0 && answeredCount >= totalCount;

  const submitAnswer = () => {
    if (!interview || !currentQuestion) return;
    const text = draft.trim();
    if (text.length < 5) {
      toast.error("Type a longer answer (5+ characters)");
      return;
    }
    answerMutation.mutate(
      {
        id: interview.id,
        data: { questionIndex: answeredCount, answer: text },
      },
      {
        onSuccess: (resp) => {
          setInterview(resp.interview);
          setDraft("");
        },
        onError: (err: unknown) => {
          const msg =
            err instanceof Error ? err.message : "Could not score answer";
          toast.error(msg);
        },
      },
    );
  };

  const finalise = () => {
    if (!interview) return;
    finaliseMutation.mutate(
      { id: interview.id },
      {
        onSuccess: (data) => setInterview(data),
        onError: (err: unknown) => {
          const msg =
            err instanceof Error ? err.message : "Could not finalise";
          toast.error(msg);
        },
      },
    );
  };

  if (role && role !== "candidate") {
    return (
      <div className="container py-12 max-w-2xl mx-auto">
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Mock interviews are only for candidates.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-8 max-w-3xl mx-auto space-y-6">
      <Link
        href={`/jobs/${jobId}`}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> Back to job
      </Link>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="w-4 h-4 text-primary" /> AI Mock Interview
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {job?.title ?? "Loading…"}
        </h1>
        {job?.employerName ? (
          <p className="text-muted-foreground">{job.employerName}</p>
        ) : null}
      </div>

      {totalCount > 0 ? (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              Question {Math.min(answeredCount + (isFinalised ? 0 : 1), totalCount)} of {totalCount}
            </span>
            <span className="font-medium">
              {Math.round((answeredCount / totalCount) * 100)}%
            </span>
          </div>
          <Progress value={(answeredCount / totalCount) * 100} />
        </div>
      ) : null}

      {startMutation.isPending && !interview ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Generating questions tuned to this role…
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-4">
        {questions.map((q, idx) => {
          const answered = transcript[idx];
          if (idx > answeredCount) return null;
          return (
            <div key={q.id} className="space-y-3">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="flex-1 space-y-2">
                  <Badge variant="outline" className="capitalize">
                    {q.focus}
                  </Badge>
                  <Card>
                    <CardContent className="p-4 text-sm leading-relaxed">
                      {q.text}
                    </CardContent>
                  </Card>
                </div>
              </div>
              {answered ? (
                <>
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted text-foreground flex items-center justify-center shrink-0">
                      <User2 className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <Card className="bg-muted/40">
                        <CardContent className="p-4 text-sm whitespace-pre-wrap">
                          {answered.answer}
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                  <div className="ml-11 space-y-2">
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">
                        Tech {answered.scores.technical}
                      </Badge>
                      <Badge variant="secondary">
                        Comm {answered.scores.communication}
                      </Badge>
                      <Badge variant="secondary">
                        Culture {answered.scores.culture}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground italic">
                      {answered.feedback}
                    </p>
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      {!isFinalised && currentQuestion ? (
        <Card>
          <CardContent className="p-4 space-y-3">
            <Textarea
              placeholder="Type your answer…"
              rows={5}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              data-testid="textarea-mock-interview-answer"
            />
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">
                {draft.length}/6000 characters
              </span>
              <Button
                onClick={submitAnswer}
                disabled={answerMutation.isPending || draft.trim().length < 5}
                data-testid="button-mock-interview-submit"
              >
                <Send className="w-4 h-4 mr-2" />
                {answerMutation.isPending ? "Scoring…" : "Submit answer"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!isFinalised && isLastAnswered ? (
        <div className="flex justify-end">
          <Button
            onClick={finalise}
            disabled={finaliseMutation.isPending}
            data-testid="button-mock-interview-finalise"
          >
            {finaliseMutation.isPending ? "Scoring…" : "Finish interview"}
          </Button>
        </div>
      ) : null}

      {isFinalised && interview ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Your score</h2>
              <Badge className="text-base px-3 py-1 bg-primary text-primary-foreground">
                {interview.scoreOverall ?? 0}/100
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <ScoreTile label="Technical" value={interview.scoreTechnical} />
              <ScoreTile
                label="Communication"
                value={interview.scoreCommunication}
              />
              <ScoreTile label="Culture" value={interview.scoreCulture} />
            </div>
            {interview.summary ? (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {interview.summary}
              </p>
            ) : null}
            <div className="flex gap-3">
              <Button asChild variant="outline">
                <Link href={`/jobs/${jobId}`}>Back to job</Link>
              </Button>
              <Button asChild>
                <Link href={`/apply/${jobId}`}>Apply with this score</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ScoreTile({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div className="rounded-lg border bg-background p-3 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value ?? "—"}</div>
    </div>
  );
}

// Fallback: also support hash-style /jobs/:id/mock-interview deeplinks
// from places that already have just the job id (we re-export so the
// app router can use either name).
export { MockInterviewPage };
