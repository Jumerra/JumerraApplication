/**
 * Autocannon smoke test for the hardened list endpoints.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run loadtest
 *   pnpm --filter @workspace/scripts run loadtest -- --duration 30 --max-p95-ms 300
 *
 * Goal: catch regressions in p95 / p99 latency on the four hot
 * read paths (/candidates, /jobs, /applications, /institutions/1/
 * students) before they ship. Unauthenticated runs exercise the
 * rate-limiter + cursor-parse + requireAuth path (which is what
 * we're hardening against scrapers and accidental hot polling);
 * authenticated runs require a `SESSION_COOKIE` env var.
 *
 * Threshold gate: `--max-p95-ms <N>` exits non-zero if any
 * endpoint's p95 latency exceeds N ms. Defaults to no gate so
 * local exploratory runs stay informational. CI / pre-deploy
 * runs should set the gate (e.g. 300 ms) to fail loudly on
 * regressions.
 *
 * Seeding: by default this hits whatever data the dev DB has.
 * To exercise the full keyset-pagination + filter path against
 * a known-size dataset, set up a fixture separately (see
 * scripts/seed-*.ts) — the loadtest deliberately doesn't own
 * data lifecycle so it can be run safely against any env.
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

interface Args {
  base: string;
  duration: number;
  connections: number;
  maxP95Ms: number | null;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let base = process.env.LOADTEST_BASE_URL ?? "http://localhost:80";
  let duration = 30;
  let connections = 10;
  let maxP95Ms: number | null = process.env.LOADTEST_MAX_P95_MS
    ? Number(process.env.LOADTEST_MAX_P95_MS)
    : null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--base") base = args[++i] ?? base;
    else if (a === "--duration") duration = Number(args[++i] ?? duration);
    else if (a === "--connections")
      connections = Number(args[++i] ?? connections);
    else if (a === "--max-p95-ms")
      maxP95Ms = Number(args[++i] ?? maxP95Ms);
  }
  return { base, duration, connections, maxP95Ms };
}

interface RunResult {
  name: string;
  p95: number;
  p99: number;
  rps: number;
  errors: number;
}

async function runOne(
  t: Target,
  base: string,
  duration: number,
  connections: number,
  cookie: string | undefined,
): Promise<RunResult> {
  const result = await autocannon({
    url: `${base}${t.path}`,
    duration,
    connections,
    headers: cookie ? { cookie } : undefined,
  });
  const p95 = result.latency.p97_5;
  const p99 = result.latency.p99;
  // eslint-disable-next-line no-console
  console.log(
    `\n=== ${t.name} ===\n` +
      `  rps:      avg=${result.requests.average.toFixed(1)} ` +
      `p99=${result.requests.p99 ?? "-"}\n` +
      `  latency:  p50=${result.latency.p50}ms ` +
      `p95=${p95}ms ` +
      `p99=${p99}ms ` +
      `max=${result.latency.max}ms\n` +
      `  status:   2xx=${result["2xx"]} 4xx=${result.non2xx} errors=${result.errors}`,
  );
  return {
    name: t.name,
    p95,
    p99,
    rps: result.requests.average,
    errors: result.errors,
  };
}

async function main(): Promise<void> {
  const { base, duration, connections, maxP95Ms } = parseArgs();
  const cookie = process.env.SESSION_COOKIE;
  // eslint-disable-next-line no-console
  console.log(
    `[loadtest] base=${base} duration=${duration}s conn=${connections} ` +
      `auth=${cookie ? "yes" : "no"} ` +
      `gate=${maxP95Ms != null ? `p95<=${maxP95Ms}ms` : "off"}`,
  );

  const results: RunResult[] = [];
  for (const t of TARGETS) {
    results.push(await runOne(t, base, duration, connections, cookie));
  }

  if (maxP95Ms != null) {
    const breaches = results.filter((r) => r.p95 > maxP95Ms);
    // eslint-disable-next-line no-console
    console.log(`\n[loadtest] threshold: p95<=${maxP95Ms}ms`);
    if (breaches.length > 0) {
      for (const b of breaches) {
        // eslint-disable-next-line no-console
        console.error(
          `[loadtest] FAIL ${b.name} p95=${b.p95}ms > ${maxP95Ms}ms`,
        );
      }
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`[loadtest] PASS — all endpoints under threshold`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
