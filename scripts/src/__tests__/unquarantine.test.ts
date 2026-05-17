import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  leafTitle,
  stripQuarantineAnnotation,
  processCandidate,
} from "../unquarantine.js";

const QUARANTINE_LINE = `    test.info().annotations.push({ type: "quarantine", reason: "flaky" });`;

/**
 * NOTE on test signatures: we deliberately use parameter-less arrow
 * functions like `async () => {` rather than the Playwright-style
 * `async ({ page }) => {` because the script's `findTestBodyEnd`
 * picks the FIRST `{` after the test title — destructured argument
 * braces would mislead it. The string-matching + brace-balancing
 * logic this suite exercises is identical either way, but using
 * a parameter-less signature keeps each fixture focused on the
 * specific aspect under test.
 */
function sampleFile(opts: {
  quarantineA?: boolean;
  quarantineB?: boolean;
  quarantineNested?: boolean;
}): string {
  return `import { test, expect } from "@playwright/test";

test.describe("Candidate flow", () => {
  test("logs in successfully", async () => {
${opts.quarantineA ? QUARANTINE_LINE + "\n" : ""}    const body = { a: 1, b: { c: 2 } };
    expect(body.b.c).toBe(2);
  });

  test("can apply to a job", async () => {
${opts.quarantineB ? QUARANTINE_LINE + "\n" : ""}    if (true) {
      expect("\\"quoted\\"").toBeTruthy();
    }
  });

  test.describe("nested suite", () => {
    test("nested case", async () => {
${opts.quarantineNested ? QUARANTINE_LINE + "\n" : ""}      expect(1).toBe(1);
    });
  });
});
`;
}

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "unquarantine-test-"));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("leafTitle", () => {
  it("returns the trailing segment of a › joined journey", () => {
    expect(leafTitle("Candidate flow \u203a logs in successfully")).toBe(
      "logs in successfully",
    );
  });

  it("returns the whole string when there is no separator", () => {
    expect(leafTitle("standalone")).toBe("standalone");
  });
});

describe("stripQuarantineAnnotation", () => {
  it("removes only the quarantine annotation, not other annotations", () => {
    const body = `{
  test.info().annotations.push({ type: "issue", url: "x" });
  test.info().annotations.push({ type: "quarantine", reason: "flaky" });
  await page.goto("/");
}`;
    const { changed, output } = stripQuarantineAnnotation(body);
    expect(changed).toBe(true);
    expect(output).toContain(`type: "issue"`);
    expect(output).not.toContain("quarantine");
  });

  it("is a no-op when no quarantine annotation is present", () => {
    const body = `{ await page.goto("/"); }`;
    const { changed, output } = stripQuarantineAnnotation(body);
    expect(changed).toBe(false);
    expect(output).toBe(body);
  });
});

describe("processCandidate", () => {
  it("removes the quarantine annotation from the targeted test only", () => {
    const file = "e2e.test.ts";
    fs.writeFileSync(
      file,
      sampleFile({ quarantineA: true, quarantineB: true }),
    );
    const res = processCandidate(
      {
        journey: "Candidate flow \u203a logs in successfully",
        file,
      },
      false,
    );
    expect(res.outcome).toBe("removed");
    const after = fs.readFileSync(file, "utf8");
    // Targeted test cleaned
    const loginBlock = after.slice(
      after.indexOf('test("logs in successfully"'),
      after.indexOf('test("can apply to a job"'),
    );
    expect(loginBlock).not.toContain("quarantine");
    // Unrelated test preserved
    const applyBlock = after.slice(after.indexOf('test("can apply to a job"'));
    expect(applyBlock).toContain("quarantine");
  });

  it("dry-run never writes to disk", () => {
    const file = "e2e.test.ts";
    const original = sampleFile({ quarantineA: true });
    fs.writeFileSync(file, original);
    const res = processCandidate(
      {
        journey: "Candidate flow \u203a logs in successfully",
        file,
      },
      true,
    );
    expect(res.outcome).toBe("removed");
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("is idempotent: re-running on a cleaned file is a no-op", () => {
    const file = "e2e.test.ts";
    fs.writeFileSync(file, sampleFile({ quarantineA: true }));
    const first = processCandidate(
      { journey: "Candidate flow \u203a logs in successfully", file },
      false,
    );
    expect(first.outcome).toBe("removed");
    const second = processCandidate(
      { journey: "Candidate flow \u203a logs in successfully", file },
      false,
    );
    expect(second.outcome).toBe("noop");
  });

  it("reports missing-file when the file does not exist", () => {
    const res = processCandidate(
      { journey: "X \u203a y", file: "does-not-exist.test.ts" },
      false,
    );
    expect(res.outcome).toBe("missing-file");
  });

  it("reports missing-test when the test title is not found", () => {
    const file = "e2e.test.ts";
    fs.writeFileSync(file, sampleFile({ quarantineA: true }));
    const res = processCandidate(
      { journey: "Candidate flow \u203a nonexistent test", file },
      false,
    );
    expect(res.outcome).toBe("missing-test");
  });

  it("handles a nested test inside a nested describe block", () => {
    const file = "e2e.test.ts";
    fs.writeFileSync(file, sampleFile({ quarantineNested: true }));
    const res = processCandidate(
      { journey: "nested suite \u203a nested case", file },
      false,
    );
    expect(res.outcome).toBe("removed");
    const after = fs.readFileSync(file, "utf8");
    expect(after).not.toContain("quarantine");
  });

  it("handles Playwright-style destructured args: async ({ page }) => {", () => {
    const file = "e2e.test.ts";
    const content = `import { test, expect } from "@playwright/test";

test("playwright case", async ({ page, request }) => {
    test.info().annotations.push({ type: "quarantine", reason: "flaky" });
    await page.goto("/");
    const data = { nested: { x: 1 } };
    expect(data.nested.x).toBe(1);
});

test("untouched neighbour", async ({ page }) => {
    test.info().annotations.push({ type: "quarantine", reason: "still flaky" });
    await page.goto("/x");
});
`;
    fs.writeFileSync(file, content);
    const res = processCandidate(
      { journey: "playwright case", file },
      false,
    );
    expect(res.outcome).toBe("removed");
    const after = fs.readFileSync(file, "utf8");
    const target = after.slice(
      after.indexOf('test("playwright case"'),
      after.indexOf('test("untouched neighbour"'),
    );
    expect(target).not.toContain("quarantine");
    // The neighbour's quarantine annotation must remain intact.
    expect(after.slice(after.indexOf('test("untouched neighbour"'))).toContain(
      "quarantine",
    );
  });

  it("handles a function-expression callback: async function () { ... }", () => {
    const file = "e2e.test.ts";
    const content = `import { test, expect } from "@playwright/test";

test("function expr case", async function () {
    test.info().annotations.push({ type: "quarantine", reason: "x" });
    expect(1).toBe(1);
});
`;
    fs.writeFileSync(file, content);
    const res = processCandidate(
      { journey: "function expr case", file },
      false,
    );
    expect(res.outcome).toBe("removed");
    expect(fs.readFileSync(file, "utf8")).not.toContain("quarantine");
  });

  it("does not get confused by braces inside strings or comments", () => {
    const file = "e2e.test.ts";
    const content = `import { test, expect } from "@playwright/test";

test("tricky", async () => {
    test.info().annotations.push({ type: "quarantine", reason: "x" });
    // a comment with } brace
    /* block } with brace */
    const s = "a } string with brace";
    const t = 'another } one';
    const u = \`template } literal\`;
    expect(s).toBeTruthy();
});

test("after tricky", async () => {
    expect(1).toBe(1);
});
`;
    fs.writeFileSync(file, content);
    const res = processCandidate({ journey: "tricky", file }, false);
    expect(res.outcome).toBe("removed");
    const after = fs.readFileSync(file, "utf8");
    expect(after).toContain('test("after tricky"');
    expect(after).not.toContain("quarantine");
  });
});
