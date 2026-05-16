/**
 * Tiny autocannon smoke test for the hardened list endpoints.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run loadtest
 *   pnpm --filter @workspace/scripts run loadtest -- --duration 10
 *
 * Goal: catch regressions in p95 / p99 latency on the four hot
 * read paths (/candidates, /jobs, /applications, /institutions/1/
 * students) before they ship. Unauthenticated runs exercise the
 * rate limiter + cursor parsing; authenticated runs require a
 * `SESSION_COOKIE` env var (paste a `talentlink.sid=...` cookie
 * from a logged-in browser session).
 *
 * NB: applications and institutions/:id/students require auth; the
 * smoke test still hits them so we can verify the 401 path is cheap.
 */
import autocannon from "autocannon";

interface Target {
  name: string;
  path: string;
}

const TARGETS: Target[] = [
  { name: "GET /candidates",                path: "/api/candidates?limit=20" },
  { name: "GET /jobs",                      path: "/api/jobs?limit=20" },
  { name: "GET /applications",              path: "/api/applications?limit=20" },
  { name: "GET /institutions/1/students",   path: "/api/institutions/1/students?limit=20" },
];

function parseArgs(): { base: string; duration: number; connections: number } {
  const args = process.argv.slice(2);
  let base = process.env.LOADTEST_BASE_URL ?? "http://localhost:80";
  let duration = 10;
  let connections = 10;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--base") base = args[++i] ?? base;
    else if (a === "--duration") duration = Number(args[++i] ?? duration);
    else if (a === "--connections")
      connections = Number(args[++i] ?? connections);
  }
  return { base, duration, connections };
}

async function runOne(
  t: Target,
  base: string,
  duration: number,
  connections: number,
  cookie: string | undefined,
): Promise<void> {
  const result = await autocannon({
    url: `${base}${t.path}`,
    duration,
    connections,
    headers: cookie ? { cookie } : undefined,
  });
  // eslint-disable-next-line no-console
  console.log(
    `\n=== ${t.name} ===\n` +
      `  rps:      avg=${result.requests.average.toFixed(1)} ` +
      `p99=${result.requests.p99 ?? "-"}\n` +
      `  latency:  p50=${result.latency.p50}ms ` +
      `p95=${result.latency.p97_5}ms ` +
      `p99=${result.latency.p99}ms ` +
      `max=${result.latency.max}ms\n` +
      `  status:   2xx=${result["2xx"]} 4xx=${result.non2xx} errors=${result.errors}`,
  );
}

async function main(): Promise<void> {
  const { base, duration, connections } = parseArgs();
  const cookie = process.env.SESSION_COOKIE;
  // eslint-disable-next-line no-console
  console.log(
    `[loadtest] base=${base} duration=${duration}s conn=${connections} ` +
      `auth=${cookie ? "yes" : "no"}`,
  );
  for (const t of TARGETS) {
    await runOne(t, base, duration, connections, cookie);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
