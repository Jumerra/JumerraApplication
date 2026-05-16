import { useRef, useState } from "react";
import Papa from "papaparse";
import {
  useBulkVerifyInstitutionStudents,
  type BulkVerifyResponse,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, CheckCircle2, AlertCircle, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import {
  PremiumGate,
  ProBadge,
  useInstitutionPremium,
} from "@/lib/institution-premium";
import { Link } from "wouter";

type ParsedRow = { email: string };

export default function InstitutionBulkVerifyPage() {
  const { sessionUser } = useAuth();
  const institutionId =
    sessionUser?.role === "institution" ? sessionUser.institutionId : null;
  const premium = useInstitutionPremium();

  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [result, setResult] = useState<BulkVerifyResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mutation = useBulkVerifyInstitutionStudents({
    mutation: {
      onSuccess: (data) => {
        setResult(data);
        toast.success(
          `Verified ${data.summary.matched} of ${data.summary.total} students`,
        );
      },
      onError: (err: unknown) => {
        const msg =
          err instanceof Error ? err.message : "Bulk verification failed";
        toast.error(msg);
      },
    },
  });

  function handleFile(file: File) {
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => {
        const seen = new Set<string>();
        const out: ParsedRow[] = [];
        let dropped = 0;
        for (const r of parsed.data) {
          // Accept "email", "Email", or "e-mail" headers — be forgiving.
          const raw =
            r["email"] ?? r["Email"] ?? r["EMAIL"] ?? r["e-mail"] ?? "";
          const email = String(raw).trim().toLowerCase();
          if (!email || !email.includes("@") || seen.has(email)) {
            if (email && seen.has(email)) dropped += 1;
            else if (!email) dropped += 1;
            else dropped += 1;
            continue;
          }
          seen.add(email);
          out.push({ email });
        }
        setRows(out);
        setSkipped(dropped);
        if (out.length === 0) {
          toast.error("No valid emails found. Ensure a column named 'email'.");
        }
      },
      error: (err) => toast.error(`Could not parse CSV: ${err.message}`),
    });
  }

  if (!institutionId) {
    return (
      <div className="container max-w-md py-16">
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Sign in with an institution account to bulk-verify students.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl space-y-6 py-8">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">
            Bulk-verify students
          </h1>
          <ProBadge />
        </div>
        <p className="text-sm text-muted-foreground">
          Upload a CSV with an <code className="font-mono">email</code> column.
          We&apos;ll match against existing candidate accounts and verify each
          one in one shot.
        </p>
      </div>

      <PremiumGate feature="Bulk roster verification">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Upload roster CSV
            </CardTitle>
            <CardDescription>
              Maximum 1000 rows per upload. Header row required; only the{" "}
              <code className="font-mono">email</code> column is read.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-choose-csv"
              >
                <Upload className="mr-2 h-4 w-4" />
                Choose CSV
              </Button>
              {rows.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {rows.length} valid {rows.length === 1 ? "row" : "rows"}
                  {skipped > 0 && ` · ${skipped} skipped`}
                </span>
              )}
            </div>

            {rows.length > 0 && (
              <>
                <div className="max-h-64 overflow-auto rounded-md border">
                  <ul className="divide-y text-sm">
                    {rows.slice(0, 50).map((r) => (
                      <li key={r.email} className="px-3 py-2 font-mono">
                        {r.email}
                      </li>
                    ))}
                  </ul>
                  {rows.length > 50 && (
                    <p className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      Showing first 50 of {rows.length}.
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() =>
                      mutation.mutate({ id: institutionId, data: { rows } })
                    }
                    disabled={mutation.isPending || rows.length > 1000}
                    data-testid="button-confirm-bulk-verify"
                  >
                    {mutation.isPending
                      ? "Verifying..."
                      : `Verify ${rows.length} students`}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setRows([]);
                      setSkipped(0);
                      setResult(null);
                    }}
                  >
                    Clear
                  </Button>
                </div>
                {rows.length > 1000 && (
                  <p className="text-sm text-destructive">
                    Maximum 1000 rows per upload. Please split the file.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <CardTitle>Result</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {result.summary.matched} verified
                </Badge>
                <Badge variant="secondary" className="gap-1">
                  {result.summary.alreadyVerified} already verified
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {result.summary.unmatched} not found
                </Badge>
              </div>
              {result.unmatched.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">
                    Show emails without a candidate account
                  </summary>
                  <ul className="mt-2 max-h-48 overflow-auto rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs">
                    {result.unmatched.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
              <Button variant="outline" asChild>
                <Link href="/dashboard/institution">Back to dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </PremiumGate>

      {!premium.isPremium && (
        <Card className="border-dashed">
          <CardContent className="p-6 text-sm text-muted-foreground">
            On Starter, students are verified one at a time from the dashboard.
            Upgrade to Pro to import an entire roster from your SIS in seconds.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
