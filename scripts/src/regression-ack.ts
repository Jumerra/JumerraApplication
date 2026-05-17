/**
 * Manage acknowledgements for already-triaged regressions so
 * `regression-report` / `regression-notify` stop pinging about them every
 * merge until someone fixes them. Entries are keyed by `file + journey`
 * and may carry an optional `--until YYYY-MM-DD` expiry so nothing stays
 * muted forever.
 *
 *   pnpm --filter @workspace/scripts run regression-ack -- \
 *     --journey "candidate can sign in" \
 *     --file e2e/auth.spec.ts \
 *     --until 2026-06-01 \
 *     --reason "tracked in JUM-123"
 *
 *   pnpm --filter @workspace/scripts run regression-ack -- --list
 *   pnpm --filter @workspace/scripts run regression-ack -- --remove \
 *     --journey "candidate can sign in" --file e2e/auth.spec.ts
 *
 * Flags:
 *   --journey "..."   journey name (required for add/remove)
 *   --file PATH       spec file the journey lives in (required for add/remove)
 *   --until DATE      optional ISO date (YYYY-MM-DD) when the ack expires
 *   --reason "..."    optional free-text note
 *   --remove          delete the matching ack (file+journey)
 *   --list            print all acks (active + expired) as a table
 *   --acks PATH       override the acks file (default .local/regression-acks.json)
 *   --json            machine-readable output for --list
 */
import path from "node:path";
import {
  defaultAcksPath,
  isExpired,
  isValidIsoDate,
  readAcksRaw,
  writeAcks,
  type RegressionAck,
} from "./lib/regression-acks.js";

interface Args {
  journey: string | null;
  file: string | null;
  until: string | null;
  reason: string | null;
  remove: boolean;
  list: boolean;
  acksPath: string;
  json: boolean;
}

function parseArgs(rawArgv: string[]): Args {
  const argv = rawArgv.filter((a) => a !== "--");
  const args: Args = {
    journey: null,
    file: null,
    until: null,
    reason: null,
    remove: false,
    list: false,
    acksPath: defaultAcksPath(),
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--journey") {
      args.journey = argv[++i] ?? null;
    } else if (a === "--file") {
      args.file = argv[++i] ?? null;
    } else if (a === "--until") {
      args.until = argv[++i] ?? null;
    } else if (a === "--reason") {
      args.reason = argv[++i] ?? null;
    } else if (a === "--remove") {
      args.remove = true;
    } else if (a === "--list") {
      args.list = true;
    } else if (a === "--acks") {
      args.acksPath = path.resolve(argv[++i] ?? "");
    } else if (a === "--json") {
      args.json = true;
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: regression-ack [--list [--json]] [--remove] " +
          "--journey \"...\" --file PATH [--until YYYY-MM-DD] [--reason \"...\"] " +
          "[--acks PATH]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

function listAcks(args: Args): void {
  const { acks } = readAcksRaw(args.acksPath);
  if (args.json) {
    const today = new Date().toISOString().slice(0, 10);
    process.stdout.write(
      `${JSON.stringify(
        {
          acksPath: args.acksPath,
          total: acks.length,
          acks: acks.map((a) => ({ ...a, expired: isExpired(a, today) })),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (acks.length === 0) {
    process.stdout.write(
      `No regression acks recorded (file: ${args.acksPath}).\n`,
    );
    return;
  }
  process.stdout.write(`Regression acks (${args.acksPath}):\n`);
  for (const a of acks) {
    const exp = isExpired(a) ? " [EXPIRED]" : "";
    const until = a.until ? ` until ${a.until}` : " (no expiry)";
    const reason = a.reason ? ` — ${a.reason}` : "";
    process.stdout.write(`  - ${a.journey}  (${a.file})${until}${exp}${reason}\n`);
  }
}

function upsertOrRemove(args: Args): void {
  if (!args.journey || !args.file) {
    throw new Error("--journey and --file are required");
  }
  if (args.until !== null && !isValidIsoDate(args.until)) {
    throw new Error(`--until expects an ISO date YYYY-MM-DD, got ${args.until}`);
  }
  const existing = readAcksRaw(args.acksPath);
  const matchIndex = existing.acks.findIndex(
    (a) => a.file === args.file && a.journey === args.journey,
  );

  if (args.remove) {
    if (matchIndex === -1) {
      process.stdout.write(
        `No matching ack to remove for "${args.journey}" in ${args.file}.\n`,
      );
      return;
    }
    existing.acks.splice(matchIndex, 1);
    writeAcks(args.acksPath, existing);
    process.stdout.write(
      `Removed ack for "${args.journey}" (${args.file}).\n`,
    );
    return;
  }

  const next: RegressionAck = {
    file: args.file,
    journey: args.journey,
  };
  if (args.until) next.until = args.until;
  if (args.reason) next.reason = args.reason;

  if (matchIndex === -1) {
    existing.acks.push(next);
  } else {
    existing.acks[matchIndex] = next;
  }
  writeAcks(args.acksPath, existing);
  const until = next.until ? ` until ${next.until}` : " (no expiry)";
  process.stdout.write(
    `${matchIndex === -1 ? "Added" : "Updated"} ack for "${next.journey}" (${next.file})${until}.\n`,
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    listAcks(args);
    return;
  }
  upsertOrRemove(args);
}

main();
