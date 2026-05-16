import { useState } from "react";
import { useAiCvCritique } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Sparkles, AlertCircle, AlertTriangle, Info } from "lucide-react";

const SEVERITY: Record<
  "info" | "suggestion" | "warning",
  { icon: typeof Info; className: string; label: string }
> = {
  info: { icon: Info, className: "text-blue-600 dark:text-blue-400 bg-blue-500/10", label: "Note" },
  suggestion: {
    icon: AlertCircle,
    className: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
    label: "Suggest",
  },
  warning: {
    icon: AlertTriangle,
    className: "text-rose-600 dark:text-rose-400 bg-rose-500/10",
    label: "Fix",
  },
};

export function CvCritiquePanel({ candidateId }: { candidateId: number }) {
  const [error, setError] = useState<string | null>(null);
  const mutation = useAiCvCritique();

  const onGenerate = () => {
    setError(null);
    mutation.mutate(
      { id: candidateId },
      {
        onError: (err: unknown) => {
          setError(err instanceof Error ? err.message : "Couldn't generate critique");
        },
      },
    );
  };

  const data = mutation.data;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> AI critique
            </CardTitle>
            <CardDescription>
              Section-by-section feedback on your profile. Caches per profile
              snapshot — edit your profile and re-run for fresh feedback.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={onGenerate}
            disabled={mutation.isPending}
            data-testid="button-cv-critique"
          >
            {mutation.isPending ? "Reviewing..." : data ? "Re-run" : "Get critique"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!data && !mutation.isPending && (
          <p className="text-sm text-muted-foreground">
            Click "Get critique" for honest, specific feedback on each section
            of your profile.
          </p>
        )}
        {data && (
          <>
            <div className="rounded-lg bg-primary/5 border border-primary/15 px-3 py-2 text-sm font-medium">
              {data.overall}
            </div>
            <div className="space-y-3">
              {data.sections.map((section) => (
                <div key={section.section} className="border rounded-lg p-4 space-y-2">
                  <h4 className="font-semibold text-sm">{section.section}</h4>
                  <ul className="space-y-2">
                    {section.items.map((item, i) => {
                      const sev = SEVERITY[item.severity] ?? SEVERITY.suggestion;
                      const Icon = sev.icon;
                      return (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span
                            className={`shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${sev.className}`}
                          >
                            <Icon className="w-3 h-3" /> {sev.label}
                          </span>
                          <div className="flex-1">
                            <p className="text-foreground">{item.message}</p>
                            {item.suggestion && (
                              <p className="text-muted-foreground mt-1">
                                <span className="font-medium text-foreground/80">Try: </span>
                                {item.suggestion}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
