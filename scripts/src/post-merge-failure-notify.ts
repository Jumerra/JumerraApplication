/**
 * Post-merge hard-failure notifier — sibling of `regression-notify`.
 *
 * The regression notifier only fires when a previously-stable journey
 * starts failing. It stays silent when the suite never executed at all
 * (DB unreachable, e2e crash before any test ran, unit suite blew up
 * on import). This notifier closes that blind spot: any time
 * `scripts/post-merge.sh` exits non-zero (unit failed OR hard e2e
 * failure), invoke this script with the run id, which suite(s) failed,
 * and the path to the file containing the structured failure summary
 * block that the shell already prints at the end of the run. It posts
 * to the same Slack/email destinations used by `regression-notify`.
 *
 *   pnpm --filter @workspace/scripts run post-merge-failure-notify -- \
 *     --run-id "$RUN_ID" \
 *     --unit-status "$UNIT_STATUS" \
 *     --e2e-status "$E2E_STATUS" \
 *     --summary-file "$LOG_DIR/failure-summary.txt"
 *
 * Env (all optional — anything unset is silently skipped):
 *   SLACK_REGRESSION_WEBHOOK_URL   incoming-webhook URL
 *   REGRESSION_ALERT_EMAIL         comma-separated recipient list
 *   RESEND_API_KEY                 needed for the email channel
 *   EMAIL_DEFAULT_FROM             defaults to "Jumerra <onboarding@resend.dev>"
 *
 * Best-effort: never exits non-zero on a notification failure (the
 * post-merge pipeline calls us with `|| true`, but we belt-and-brace
 * it here so a Slack/Resend outage cannot mask the underlying suite
 * failure). Errors are written to stderr.
 */
import fs from "node:fs";

interface Args {
  runId: string;
  unitStatus: number;
  e2eStatus: number;
  summaryFile: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    runId: "",
    unitStatus: 0,
    e2eStatus: 0,
    summaryFile: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--run-id":
        args.runId = next ?? "";
        i += 1;
        break;
      case "--unit-status":
        args.unitStatus = Number.parseInt(next ?? "0", 10) || 0;
        i += 1;
        break;
      case "--e2e-status":
        args.e2eStatus = Number.parseInt(next ?? "0", 10) || 0;
        i += 1;
        break;
      case "--summary-file":
        args.summaryFile = next ?? null;
        i += 1;
        break;
      default:
        break;
    }
  }
  return args;
}

function readSummary(path: string | null): string {
  if (!path) return "";
  try {
    return fs.readFileSync(path, "utf8").trimEnd();
  } catch (err) {
    process.stderr.write(
      `post-merge-failure-notify: could not read summary file ${path}: ${(err as Error).message}\n`,
    );
    return "";
  }
}

function failedSuites(args: Args): string[] {
  const suites: string[] = [];
  if (args.unitStatus !== 0) suites.push("unit");
  if (args.e2eStatus !== 0) suites.push("e2e");
  return suites;
}

function headline(args: Args): string {
  const suites = failedSuites(args);
  if (suites.length === 0) {
    // Caller invoked us on a green run — degrade gracefully rather
    // than spamming "0 suites failed" to oncall.
    return `Post-merge run ${args.runId} reported a failure with no failing suites`;
  }
  const label = suites.join(" + ");
  return `Post-merge run ${args.runId} failed (${label})`;
}

function summariseForSlack(args: Args, summary: string): {
  text: string;
  blocks: unknown[];
} {
  const head = `:rotating_light: ${headline(args)}`;
  // Slack section text caps at 3000 chars. Keep the tail well under.
  const trimmedSummary = summary.length > 2500
    ? `${summary.slice(-2500)}\n…(truncated)`
    : summary;
  const body = trimmedSummary
    ? `\n\`\`\`\n${trimmedSummary}\n\`\`\``
    : "\n(no failure summary captured — check the post-merge logs)";
  const text = `${head}${body}`;
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: headline(args) },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Run id:* \`${args.runId}\`\n*Failing suites:* ${failedSuites(args).join(", ") || "(none reported)"}\n*Unit exit:* ${args.unitStatus}  *E2E exit:* ${args.e2eStatus}`,
      },
    },
  ];
  if (trimmedSummary) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `\`\`\`\n${trimmedSummary}\n\`\`\``,
      },
    });
  }
  return { text, blocks };
}

async function postSlack(args: Args, summary: string): Promise<void> {
  const url = process.env.SLACK_REGRESSION_WEBHOOK_URL;
  if (!url) return;
  const body = summariseForSlack(args, summary);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      process.stderr.write(
        `post-merge-failure-notify: Slack webhook returned ${res.status}: ${txt}\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `post-merge-failure-notify: Slack post threw: ${(err as Error).message}\n`,
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

function summariseForEmail(args: Args, summary: string): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `[Jumerra e2e] ${headline(args)}`;
  const summaryBlock = summary
    ? `<pre style="background:#0f172a;color:#e2e8f0;padding:12px;border-radius:6px;font-size:12px;overflow:auto;">${escapeHtml(summary)}</pre>`
    : `<p style="color:#64748b;">No failure summary captured — check the post-merge logs.</p>`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;">
<h2 style="color:#0d9488;margin-bottom:4px;">${escapeHtml(headline(args))}</h2>
<p style="color:#475569;margin-top:0;">Run id: <code>${escapeHtml(args.runId)}</code><br/>Unit exit: ${args.unitStatus} &nbsp; E2E exit: ${args.e2eStatus}</p>
${summaryBlock}
</div>`;
  const text = [
    headline(args),
    `Run id: ${args.runId}`,
    `Unit exit: ${args.unitStatus}  E2E exit: ${args.e2eStatus}`,
    "",
    summary || "(no failure summary captured)",
  ].join("\n");
  return { subject, html, text };
}

async function sendEmail(args: Args, summary: string): Promise<void> {
  const to = process.env.REGRESSION_ALERT_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  if (!to) return;
  if (!apiKey) {
    process.stderr.write(
      "post-merge-failure-notify: REGRESSION_ALERT_EMAIL set but RESEND_API_KEY missing — skipping email.\n",
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
  const { subject, html, text } = summariseForEmail(args, summary);
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
        `post-merge-failure-notify: Resend returned ${res.status}: ${body}\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `post-merge-failure-notify: Resend post threw: ${(err as Error).message}\n`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2).filter((a) => a !== "--"));
  if (!args.runId) {
    process.stderr.write(
      "post-merge-failure-notify: --run-id is required; nothing sent.\n",
    );
    return;
  }
  if (args.unitStatus === 0 && args.e2eStatus === 0) {
    // Defensive: caller should only invoke us on hard failure. If they
    // didn't pass either suite as failed, skip silently so a future
    // misuse doesn't page oncall on every merge.
    process.stdout.write(
      "post-merge-failure-notify: no failing suites reported — nothing to send.\n",
    );
    return;
  }
  const hasSlack = !!process.env.SLACK_REGRESSION_WEBHOOK_URL;
  const hasEmail = !!process.env.REGRESSION_ALERT_EMAIL;
  if (!hasSlack && !hasEmail) {
    process.stdout.write(
      "post-merge-failure-notify: no notification channels configured (set SLACK_REGRESSION_WEBHOOK_URL and/or REGRESSION_ALERT_EMAIL).\n",
    );
    return;
  }
  const summary = readSummary(args.summaryFile);
  process.stdout.write(
    `post-merge-failure-notify: dispatching hard-failure alert for run ${args.runId} (${failedSuites(args).join("+")}).\n`,
  );
  await Promise.all([postSlack(args, summary), sendEmail(args, summary)]);
}

main().catch((err) => {
  process.stderr.write(
    `post-merge-failure-notify: fatal: ${(err as Error).message}\n`,
  );
});
