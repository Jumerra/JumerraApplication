import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const API_PORT = Number(process.env.E2E_API_PORT ?? 8090);
export const API_URL =
  process.env.E2E_API_URL ?? `http://127.0.0.1:${API_PORT}`;
export const STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_e2e_test_secret";
export const PAYSTACK_SECRET_KEY =
  process.env.PAYSTACK_SECRET_KEY ?? "sk_test_paystack_e2e";

/** Where the per-run RUN_TAG is persisted. Written by globalSetup and
 *  read by every worker process + globalTeardown, so the test row
 *  tagging used by `tag` columns in the database is consistent across
 *  processes (workers are spawned independently of the setup process,
 *  so an in-memory `Date.now()` would yield different tags). */
const TAG_DIR = path.join(process.cwd(), ".playwright-cache");
const TAG_FILE = path.join(TAG_DIR, "run-tag");

function readOrCreateRunTag(): string {
  // Explicit env override always wins (CI orchestrators can pin it).
  const envTag = process.env.E2E_RUN_TAG;
  if (envTag) return `e2e-${envTag}`;
  // Reuse a previously-written tag if present (worker / teardown path).
  if (existsSync(TAG_FILE)) {
    const fromDisk = readFileSync(TAG_FILE, "utf8").trim();
    if (fromDisk) return fromDisk;
  }
  // First touch (globalSetup): mint + persist.
  const fresh = `e2e-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  try {
    mkdirSync(TAG_DIR, { recursive: true });
    writeFileSync(TAG_FILE, fresh, "utf8");
  } catch {
    /* worst case workers fall back to env-only; never throw at import time */
  }
  return fresh;
}

/** Unique tag for the current Playwright run — every fixture row is
 *  prefixed/suffixed with it so globalTeardown can clean up only what
 *  this run created, leaving any concurrent dev data intact. The tag
 *  is persisted to `.playwright-cache/run-tag` so worker processes
 *  and the teardown process all read the SAME value (Playwright runs
 *  setup, workers, and teardown in independent node processes). */
export const RUN_TAG = readOrCreateRunTag();
