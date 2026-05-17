/**
 * Regression notifier — runs `regression-report --json` and, when it
 * finds at least one regression, posts a summary to a Slack webhook
 * and/or sends an email via Resend so the team finds out the day a
 * previously-stable test starts failing instead of the day someone
 * happens to look at the report.
 *
 *   pnpm --filter @workspace/scripts run regression-notify
 *
 * Env (all optional — anything unset is silently skipped):
 *   SLACK_REGRESSION_WEBHOOK_URL   incoming-webhook URL
 *   REGRESSION_ALERT_EMAIL         comma-separated recipient list
 *   RESEND_API_KEY                 needed for the email channel
 *   EMAIL_DEFAULT_FROM             defaults to "Jumerra <onboarding@resend.dev>"
 *
 * Flags forwarded to regression-report:
 *   --fails N      consecutive failing runs at the tail (default 2)
 *   --streak M     min length of the clean pass streak (default 10)
 *   --history PATH override the JSONL location
 *
 * Best-effort: never exits non-zero on a notification failure (the
 * post-merge pipeline calls us with `|| true`, but we belt-and-brace it
 * here so a Slack/Resend outage cannot block a green merge). Errors are
 * written to stderr.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface Regression {
  journey: string;
  file: string;
  brokeAt: string;
  brokeRunId: string;
  streakLength: number;
  failingRuns: number;
  lastStatus: string;
  lastReason?: string;
}

interface ReportPayload {
  criteria: { fails: number; streak: number };
  historyPath: string;
  includeArchive: boolean;
  totalRegressions: number;
  regressions: Regression[];
}

function runReport(forwardedArgs: string[]): ReportPayload | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const reportScript = path.join(here, "regression-report.ts");
  // We invoke the tsx binary directly (rather than `pnpm exec tsx`) so
  // we don't depend on the caller's cwd resolving to a workspace —
  // and so we don't disturb the cwd at all, which keeps
  // `regression-report`'s `defaultHistoryPath()` (which is anchored to
  // `process.cwd()`) honest. In the post-merge.sh flow we pass an
  // explicit `--history` anyway, but inheriting cwd here is the second
  // layer of belt-and-braces: if a future caller forgets `--history`,
  // the spawned report still reads from the same place we would.
  const tsxBin = path.resolve(
    here,
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  );
  const proc = spawnSync(
    tsxBin,
    [reportScript, "--json", ...forwardedArgs],
    { encoding: "utf8" },
  );
  if (proc.status !== 0) {
    process.stderr.write(
      `regression-notify: regression-report exited ${proc.status}\n${proc.stderr ?? ""}\n`,
    );
    return null;
  }
  try {
    return JSON.parse(proc.stdout) as ReportPayload;
  } catch (err) {
    process.stderr.write(
      `regression-notify: failed to parse regression-report JSON: ${(err as Error).message}\n`,
    );
    return null;
  }
}

function summariseForSlack(payload: ReportPayload): {
  text: string;
  blocks: unknown[];
} {
  const sorted = [...payload.regressions].sort((a, b) =>
    b.brokeAt.localeCompare(a.brokeAt),
  );
  const headline =
    sorted.length === 1
      ? `:rotating_light: 1 previously-stable e2e journey just regressed`
      : `:rotating_light: ${sorted.length} previously-stable e2e journeys just regressed`;
  const lines = sorted.slice(0, 10).map((r) => {
    const reason = r.lastReason ? ` — ${r.lastReason}` : "";
    return `• *${r.journey}* (\`${r.file}\`) — broke ${r.brokeAt} after ${r.streakLength} clean runs, ${r.failingRuns} failing run${r.failingRuns === 1 ? "" : "s"}${reason}`;
  });
  if (sorted.length > 10) {
    lines.push(`…and ${sorted.length - 10} more`);
  }
  const text = `${headline}\n${lines.join("\n")}`;
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: headline.replace(/:[^:]+:\s*/, "") },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `Criteria: \u2265 ${payload.criteria.streak} clean runs then \u2265 ${payload.criteria.fails} consecutive failures.\n\n` +
          lines.join("\n"),
      },
    },
  ];
  return { text, blocks };
}

async function postSlack(payload: ReportPayload): Promise<void> {
  const url = process.env.SLACK_REGRESSION_WEBHOOK_URL;
  if (!url) return;
  const body = summariseForSlack(payload);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      process.stderr.write(
        `regression-notify: Slack webhook returned ${res.status}: ${txt}\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `regression-notify: Slack post threw: ${(err as Error).message}\n`,
    );
  }
}

function summariseForEmail(payload: ReportPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const sorted = [...payload.regressions].sort((a, b) =>
    b.brokeAt.localeCompare(a.brokeAt),
  );
  const n = sorted.length;
  const subject =
    n === 1
      ? `[Jumerra e2e] 1 stable journey regressed`
      : `[Jumerra e2e] ${n} stable journeys regressed`;
  const rows = sorted
    .map(
      (r) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${escapeHtml(r.brokeAt)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;"><strong>${escapeHtml(r.journey)}</strong><br/><span style="color:#64748b;font-size:12px;">${escapeHtml(r.file)}</span></td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${r.streakLength}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${r.failingRuns}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${escapeHtml(r.lastReason ?? "")}</td></tr>`,
    )
    .join("");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;">
<h2 style="color:#0d9488;margin-bottom:4px;">${escapeHtml(subject)}</h2>
<p style="color:#475569;margin-top:0;">Criteria: at least ${payload.criteria.streak} clean runs followed by at least ${payload.criteria.fails} consecutive failures.</p>
<table style="border-collapse:collapse;width:100%;font-size:14px;">
<thead><tr style="background:#f1f5f9;text-align:left;"><th style="padding:6px 10px;">Broke at (UTC)</th><th style="padding:6px 10px;">Journey</th><th style="padding:6px 10px;text-align:right;">Prior streak</th><th style="padding:6px 10px;text-align:right;">Failing runs</th><th style="padding:6px 10px;">Reason</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</div>`;
  const textLines = [
    subject,
    `Criteria: >= ${payload.criteria.streak} clean runs then >= ${payload.criteria.fails} consecutive failures.`,
    "",
    ...sorted.map(
      (r) =>
        `- ${r.brokeAt}  ${r.journey}  (${r.file})  streak=${r.streakLength}  failing=${r.failingRuns}${r.lastReason ? `  reason=${r.lastReason}` : ""}`,
    ),
  ];
  return { subject, html, text: textLines.join("\n") };
}

async function sendEmail(payload: ReportPayload): Promise<void> {
  const to = process.env.REGRESSION_ALERT_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!to) return;
  if (!apiKey) {
    process.stderr.write(
      "regression-notify: REGRESSION_ALERT_EMAIL set but RESEND_API_KEY missing — skipping email.\n",
    );
    return;
  }
  const recipients = to
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (recipients.length === 0) return;
  const from =
    process.env.EMAIL_DEFAULT_FROM ?? "Jumerra <onboarding@resend.dev>";
  const { subject, html, text } = summariseForEmail(payload);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to: recipients, subject, html, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      process.stderr.write(
        `regression-notify: Resend returned ${res.status}: ${body}\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `regression-notify: Resend post threw: ${(err as Error).message}\n`,
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function main(): Promise<void> {
  const forwarded = process.argv.slice(2).filter((a) => a !== "--");
  const payload = runReport(forwarded);
  if (!payload) return;
  if (payload.totalRegressions === 0) {
    process.stdout.write(
      "regression-notify: no regressions detected — nothing to send.\n",
    );
    return;
  }
  process.stdout.write(
    `regression-notify: ${payload.totalRegressions} regression${payload.totalRegressions === 1 ? "" : "s"} detected — dispatching notifications.\n`,
  );
  const hasSlack = !!process.env.SLACK_REGRESSION_WEBHOOK_URL;
  const hasEmail = !!process.env.REGRESSION_ALERT_EMAIL;
  if (!hasSlack && !hasEmail) {
    process.stdout.write(
      "regression-notify: no notification channels configured (set SLACK_REGRESSION_WEBHOOK_URL and/or REGRESSION_ALERT_EMAIL).\n",
    );
    return;
  }
  await Promise.all([postSlack(payload), sendEmail(payload)]);
}

main().catch((err) => {
  process.stderr.write(
    `regression-notify: fatal: ${(err as Error).message}\n`,
  );
});
