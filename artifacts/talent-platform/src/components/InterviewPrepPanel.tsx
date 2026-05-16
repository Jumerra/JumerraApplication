import { useState } from "react";
import { useAiInterviewPrep } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles, ChevronDown, ChevronUp } from "lucide-react";

export function InterviewPrepPanel({
  candidateId,
  jobId,
}: {
  candidateId: number;
  jobId: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const mutation = useAiInterviewPrep();

  const onGenerate = (regenerate = false) => {
    setError(null);
    mutation.mutate(
      { id: candidateId, data: { jobId, regenerate } },
      {
        onError: (err: unknown) => {
          setError(err instanceof Error ? err.message : "Couldn't generate prep");
        },
      },
    );
  };

  const data = mutation.data;

  return (
    <Card className="border-primary/15">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10 text-primary mt-0.5">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-base">Prep for this interview</h3>
            <p className="text-sm text-muted-foreground">
              Get 5 likely questions with a STAR scaffold to practise your
              answers.
            </p>
          </div>
          {!data && (
            <Button
              size="sm"
              onClick={() => onGenerate(false)}
              disabled={mutation.isPending}
              data-testid="button-interview-prep"
            >
              {mutation.isPending ? "Thinking..." : "Generate"}
            </Button>
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {data && (
          <div className="space-y-3 pt-2">
            {data.questions.map((q, idx) => (
              <PrepItem key={idx} index={idx} question={q.question} scaffold={q.scaffold} />
            ))}
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onGenerate(true)}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? "Thinking..." : "Regenerate"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PrepItem({
  index,
  question,
  scaffold,
}: {
  index: number;
  question: string;
  scaffold: { situation: string; task: string; action: string; result: string };
}) {
  const [open, setOpen] = useState(index === 0);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-2 hover:bg-muted/40 transition-colors"
      >
        <span className="text-xs font-bold text-primary mt-0.5">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="flex-1 font-medium text-sm">{question}</span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2 text-sm">
          <ScaffoldRow label="Situation" text={scaffold.situation} />
          <ScaffoldRow label="Task" text={scaffold.task} />
          <ScaffoldRow label="Action" text={scaffold.action} />
          <ScaffoldRow label="Result" text={scaffold.result} />
        </div>
      )}
    </div>
  );
}

function ScaffoldRow({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-0.5">
        {label}
      </span>
      <span className="text-sm text-foreground/90 leading-relaxed">{text}</span>
    </div>
  );
}
