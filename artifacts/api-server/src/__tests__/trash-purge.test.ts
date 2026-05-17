import { describe, it, expect, afterEach } from "vitest";
import { getTrashRetentionDays } from "../lib/trash-purge-worker";

const originalRetention = process.env.TRASH_RETENTION_DAYS;

afterEach(() => {
  if (originalRetention === undefined) {
    delete process.env.TRASH_RETENTION_DAYS;
  } else {
    process.env.TRASH_RETENTION_DAYS = originalRetention;
  }
});

describe("getTrashRetentionDays", () => {
  it("defaults to 30 when the env var is unset", () => {
    delete process.env.TRASH_RETENTION_DAYS;
    expect(getTrashRetentionDays()).toBe(30);
  });

  it("defaults to 30 when the env var is empty or whitespace", () => {
    process.env.TRASH_RETENTION_DAYS = "";
    expect(getTrashRetentionDays()).toBe(30);
    process.env.TRASH_RETENTION_DAYS = "   ";
    expect(getTrashRetentionDays()).toBe(30);
  });

  it("uses a valid positive integer override", () => {
    process.env.TRASH_RETENTION_DAYS = "60";
    expect(getTrashRetentionDays()).toBe(60);
  });

  it("floors valid decimals", () => {
    process.env.TRASH_RETENTION_DAYS = "7.9";
    expect(getTrashRetentionDays()).toBe(7);
  });

  it("clamps positive values below 1 up to 1", () => {
    process.env.TRASH_RETENTION_DAYS = "0.4";
    expect(getTrashRetentionDays()).toBe(1);
  });

  it("clamps zero and negative numbers up to 1", () => {
    process.env.TRASH_RETENTION_DAYS = "0";
    expect(getTrashRetentionDays()).toBe(1);
    process.env.TRASH_RETENTION_DAYS = "-5";
    expect(getTrashRetentionDays()).toBe(1);
  });

  it("fails safe to 30 for non-numeric strings (typo like '30d')", () => {
    // The critical fail-safe: a typo like "30d" must NOT collapse the
    // retention window to 1 day, since that would hard-delete most of
    // the trash on the next sweep.
    process.env.TRASH_RETENTION_DAYS = "30d";
    expect(getTrashRetentionDays()).toBe(30);
    process.env.TRASH_RETENTION_DAYS = "thirty";
    expect(getTrashRetentionDays()).toBe(30);
  });
});
