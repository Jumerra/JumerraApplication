/**
 * Shared cursor-pagination helpers for hot list endpoints
 * (/candidates, /jobs, /applications, /institutions/:id/students).
 *
 * Contract:
 *   ?limit=NN   server-enforced maximum (DEFAULT_LIMIT/MAX_LIMIT)
 *   ?cursor=XX  opaque base64-url payload returned in the previous
 *               response's `X-Next-Cursor` header.
 *
 * The response shape stays a flat array for backward compatibility
 * with the React Query hooks generated from openapi.yaml. The next
 * page cursor is surfaced via the `X-Next-Cursor` response header
 * (CORS-exposed in app.ts).
 *
 * Cursors are opaque base64-url-encoded JSON blobs. Each endpoint
 * passes in its own sort-key shape (e.g. `{ts, id}` for time-ordered
 * lists, `{score, id}` for ranked lists). The decoder is permissive:
 * any malformed cursor is treated as "no cursor" so callers degrade
 * to the first page rather than 400ing on a stale bookmark.
 */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

export function parseLimit(raw: unknown): number {
  if (raw == null) return DEFAULT_LIMIT;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor<T extends Record<string, unknown>>(
  raw: unknown,
): T | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as T;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sets the `X-Next-Cursor` response header. Pass null/undefined when
 * there is no further page so the header is omitted (clients should
 * treat the absence of the header as end-of-list).
 */
export function setNextCursor(
  res: { setHeader: (n: string, v: string) => void },
  cursor: string | null,
): void {
  if (cursor) res.setHeader("X-Next-Cursor", cursor);
}
