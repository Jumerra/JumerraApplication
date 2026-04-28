export function formatSalary(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | undefined,
): string | null {
  if (!min && !max) return null;
  const minK = min ? Math.round(min / 1000) : null;
  const maxK = max ? Math.round(max / 1000) : null;
  let label: string;
  if (minK != null && maxK != null) {
    label = `$${minK}k - $${maxK}k`;
  } else if (minK != null) {
    label = `$${minK}k+`;
  } else {
    label = `Up to $${maxK}k`;
  }
  if (currency && currency.toUpperCase() !== "USD") {
    label += ` ${currency.toUpperCase()}`;
  }
  return label;
}

export function relativeTime(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return "";
  const sec = Math.max(1, Math.floor(diff / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

export function formatJobType(type: string): string {
  switch (type) {
    case "full_time":
      return "Full time";
    case "part_time":
      return "Part time";
    case "internship":
      return "Internship";
    case "contract":
      return "Contract";
    case "remote":
      return "Remote";
    default:
      return type;
  }
}

export function formatStatus(status: string): string {
  if (!status) return "";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
