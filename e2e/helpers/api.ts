import type { APIRequestContext, APIResponse } from "@playwright/test";

export interface ApiClient {
  request: APIRequestContext;
}

export async function ok<T = unknown>(
  res: APIResponse,
  label: string,
): Promise<T> {
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `${label} failed: ${res.status()} ${res.statusText()} — ${body.slice(0, 500)}`,
    );
  }
  const ct = res.headers()["content-type"] ?? "";
  if (!ct.includes("application/json")) {
    return undefined as unknown as T;
  }
  return (await res.json()) as T;
}

export async function login(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  const res = await request.post("/api/auth/login", {
    data: { email, password },
  });
  await ok(res, `login(${email})`);
}

export async function logout(request: APIRequestContext): Promise<void> {
  await request.post("/api/auth/logout");
}

export async function me(
  request: APIRequestContext,
): Promise<{ user: { id: number; role: string; candidateId?: number; employerId?: number; institutionId?: number } | null }> {
  const res = await request.get("/api/auth/me");
  return ok(res, "me");
}
