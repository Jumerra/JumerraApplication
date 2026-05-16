import { useState } from "react";
import {
  useReportApplicationSalary,
  getListApplicationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Banknote } from "lucide-react";
import { toast } from "sonner";

interface Props {
  applicationId: number;
  candidateId: number;
  alreadyReported: boolean;
  defaultCurrency?: string;
}

/**
 * Candidate-facing card that appears on hired applications. The value
 * is sent to a candidate-only endpoint and is never echoed per-row to
 * other viewers — it only contributes to the aggregate /salary-insights
 * band, which itself enforces a 3-hire floor before returning numbers.
 */
export function ReportSalaryCard({
  applicationId,
  candidateId,
  alreadyReported,
  defaultCurrency = "GHS",
}: Props) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const qc = useQueryClient();
  const mut = useReportApplicationSalary({
    mutation: {
      onSuccess: () => {
        toast.success("Thanks — your data helps everyone negotiate fairly.");
        qc.invalidateQueries({
          queryKey: getListApplicationsQueryKey({ candidateId }),
        });
      },
      onError: () => toast.error("Could not save. Try again."),
    },
  });

  if (alreadyReported) {
    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Salary reported
          </CardTitle>
          <Badge className="bg-emerald-600 text-white">Anonymous</Badge>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Thanks — this is anonymised and only contributes to the aggregate
          band shown on job posts.
        </CardContent>
      </Card>
    );
  }

  const num = Number(amount.replace(/[^0-9]/g, ""));
  const valid = num > 0 && currency.length >= 2;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Banknote className="w-4 h-4 text-primary" />
          Share what you earned (anonymous)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          You're hired — congrats! Share your accepted salary so future
          candidates can negotiate from data, not guesswork. We never show
          your number on its own; it only feeds an aggregate band once at
          least 3 hires have reported.
        </p>
        <div className="flex gap-2">
          <Input
            data-testid="input-salary-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            className="w-24"
            maxLength={6}
          />
          <Input
            data-testid="input-salary-amount"
            type="text"
            inputMode="numeric"
            placeholder="Annual amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="flex-1"
          />
        </div>
        <Button
          data-testid="button-submit-salary"
          disabled={!valid || mut.isPending}
          onClick={() =>
            mut.mutate({
              id: applicationId,
              data: { reportedSalary: num, reportedCurrency: currency },
            })
          }
        >
          {mut.isPending ? "Saving…" : "Share anonymously"}
        </Button>
      </CardContent>
    </Card>
  );
}
