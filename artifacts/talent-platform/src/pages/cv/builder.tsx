import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCandidateCv,
  useGenerateCandidateCv,
  getGetCandidateCvQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  FileText,
  Sparkles,
  Copy,
  Download,
  Lock,
  AlertCircle,
} from "lucide-react";
import { CvCritiquePanel } from "@/components/CvCritiquePanel";

export default function CvBuilderPage() {
  const { userId, role, sessionUser } = useAuth();
  // The auth hook in this app uses `userId` as the candidateId for
  // candidate-role users (per other dashboards). We respect that.
  const candidateId = userId || 0;
  const queryClient = useQueryClient();
  const { data: cv, isLoading } = useGetCandidateCv(candidateId, {
    query: {
      enabled: candidateId > 0,
      queryKey: getGetCandidateCvQueryKey(candidateId),
    },
  });
  const generate = useGenerateCandidateCv();
  const [focus, setFocus] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [error, setError] = useState<string | null>(null);

  const onGenerate = async () => {
    setError(null);
    try {
      await generate.mutateAsync({
        id: candidateId,
        data: { focus: focus.trim().length > 0 ? focus.trim() : null },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetCandidateCvQueryKey(candidateId),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate CV");
    }
  };

  const onCopy = async () => {
    if (!cv?.cvText) return;
    try {
      await navigator.clipboard.writeText(cv.cvText);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setError("Couldn't copy to clipboard");
    }
  };

  const onDownload = () => {
    if (!cv?.cvText) return;
    const blob = new Blob([cv.cvText], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cv-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!sessionUser || role !== "candidate") {
    return (
      <div className="container mx-auto px-4 py-16 max-w-xl text-center space-y-4">
        <Lock className="w-10 h-10 mx-auto text-muted-foreground" />
        <h1 className="text-2xl font-bold">Sign in as a candidate</h1>
        <p className="text-muted-foreground">
          The AI CV Builder is available to candidate accounts.
        </p>
        <Button asChild>
          <Link href="/auth/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <div className="animate-pulse h-72 bg-muted rounded-2xl" />
      </div>
    );
  }

  if (!cv?.unlocked) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-xl text-center space-y-4">
        <Lock className="w-10 h-10 mx-auto text-muted-foreground" />
        <h1 className="text-2xl font-bold">AI CV Builder is locked</h1>
        <p className="text-muted-foreground">
          Unlock the AI CV Builder from your dashboard to generate a polished
          CV in seconds.
        </p>
        <Button asChild>
          <Link href="/dashboard/candidate">Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <FileText className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI CV Builder</h1>
          <p className="text-muted-foreground mt-1">
            Generate a polished, ATS-friendly CV from your profile.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Generate</CardTitle>
          <CardDescription>
            Optionally tell the AI what to focus on. Leaving this blank
            produces a balanced general-purpose CV.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cv-focus">Focus (optional)</Label>
            <Textarea
              id="cv-focus"
              placeholder="e.g. Target senior backend engineering roles in fintech"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              rows={3}
              maxLength={500}
              data-testid="textarea-cv-focus"
            />
          </div>
          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex justify-end">
            <Button
              onClick={onGenerate}
              disabled={generate.isPending}
              data-testid="button-generate-cv"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {generate.isPending
                ? "Generating..."
                : cv?.cvText
                  ? "Regenerate"
                  : "Generate CV"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <CvCritiquePanel candidateId={candidateId} />

      {cv?.cvText && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Your CV</CardTitle>
              <CardDescription>
                Generated {cv.generatedAt
                  ? new Date(cv.generatedAt).toLocaleString()
                  : "just now"}
                . Markdown formatted.
              </CardDescription>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={onCopy}
                data-testid="button-copy-cv"
              >
                <Copy className="w-4 h-4 mr-2" />
                {copyState === "copied" ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDownload}
                data-testid="button-download-cv"
              >
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed bg-muted/40 rounded-lg p-4 border">
              {cv.cvText}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
