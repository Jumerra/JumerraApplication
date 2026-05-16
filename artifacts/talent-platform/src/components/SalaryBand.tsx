import {
  useGetSalaryBand,
  getGetSalaryBandQueryKey,
} from "@workspace/api-client-react";
import { Banknote, Info } from "lucide-react";

interface Props {
  jobId?: number;
  title?: string;
  currency?: string;
  institutionId?: number;
  label?: string;
}

/**
 * Renders an anonymised salary band derived from real hires for the
 * same role. The aggregate endpoint enforces a 3-hire privacy floor;
 * when the cohort is too small we show a neutral "Not enough data yet"
 * notice instead of a misleading number.
 */
export function SalaryBand({
  jobId,
  title,
  currency,
  institutionId,
  label,
}: Props) {
  const params = {
    ...(jobId ? { jobId } : {}),
    ...(title ? { title } : {}),
    ...(currency ? { currency } : {}),
    ...(institutionId ? { institutionId } : {}),
  };
  const enabled = Boolean(jobId || (title && title.length >= 2));
  const { data, isLoading } = useGetSalaryBand(params, {
    query: {
      queryKey: getGetSalaryBandQueryKey(params),
      retry: false,
      enabled,
    },
  });

  if (!enabled || isLoading || !data) return null;

  if (data.insufficient) {
    return (
      <div
        className="rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground flex items-start gap-2"
        data-testid="salary-band-insufficient"
      >
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <div className="font-medium text-foreground">
            {label ?? "Anonymous salary band"}
          </div>
          Not enough verified hires yet to show a band for this role
          {data.scope === "institution" ? " at this institution" : ""}.
          Banded once 3+ hires have reported.
        </div>
      </div>
    );
  }

  const fmt = (n: number) =>
    `${data.currency} ${n.toLocaleString()}`;

  return (
    <div
      className="rounded-md border bg-primary/5 border-primary/20 p-3 text-sm"
      data-testid="salary-band"
    >
      <div className="flex items-center gap-2 font-semibold text-primary">
        <Banknote className="w-4 h-4" />
        {label ??
          (data.scope === "institution"
            ? "Hires from this institution earned"
            : "Real hires in this role earned")}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-3 text-center">
        <Stat label="25th" value={fmt(data.p25 ?? 0)} />
        <Stat label="Median" value={fmt(data.p50 ?? 0)} highlight />
        <Stat label="75th" value={fmt(data.p75 ?? 0)} />
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        Based on {data.count} anonymous hires.
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={
          highlight ? "text-base font-bold text-primary" : "text-sm font-semibold"
        }
      >
        {value}
      </div>
    </div>
  );
}
