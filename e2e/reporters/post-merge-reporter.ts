import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR =
  process.env.E2E_FAILURE_OUT_DIR ??
  path.resolve(process.cwd(), ".local/post-merge-logs");
const OUT_FILE = path.join(OUT_DIR, "e2e-failures.txt");

const REQUEST_ID_RE =
  /(?:x-request-id|request[-_]?id)[=:\s"]+([A-Za-z0-9_-]{8,})/i;

interface FailureRecord {
  journey: string;
  file: string;
  status: TestResult["status"];
  firstLine: string;
  requestId?: string;
}

export default class PostMergeReporter implements Reporter {
  private failures: FailureRecord[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "failed" && result.status !== "timedOut") return;

    const journey = test
      .titlePath()
      .filter((s) => s && s !== "")
      .join(" \u203a ");
    const file = path.relative(process.cwd(), test.location.file);
    const messages = [
      result.error?.message ?? "",
      ...result.errors.map((e) => e.message ?? ""),
    ].join("\n");
    const firstLine = (result.error?.message ?? "(no error message)")
      .split("\n")[0]
      .slice(0, 400);
    const requestId = messages.match(REQUEST_ID_RE)?.[1];

    this.failures.push({
      journey,
      file,
      status: result.status,
      firstLine,
      requestId,
    });
  }

  async onEnd(_result: FullResult): Promise<void> {
    if (this.failures.length === 0) return;

    const lines = this.failures.map((f) => {
      const head = `- [${f.status}] ${f.journey}`;
      const where = `  file: ${f.file}`;
      const msg = `  error: ${f.firstLine}`;
      const rid = f.requestId ? `  request-id: ${f.requestId}` : null;
      return [head, where, msg, rid].filter(Boolean).join("\n");
    });

    const body = `${lines.join("\n\n")}\n`;
    try {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(OUT_FILE, body);
    } catch {
      // ignore — stdout below is the canonical surface
    }
    process.stdout.write(
      `\nE2E suite: ${this.failures.length} failing journey(s)\n${body}`,
    );
  }
}
