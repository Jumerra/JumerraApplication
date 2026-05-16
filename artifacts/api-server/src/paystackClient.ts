import crypto from "node:crypto";
import { logger } from "./lib/logger";

/**
 * Thin Paystack REST client. Paystack's official SDK is `paystack-sdk`
 * but it's underspecified for TypeScript and adds 1MB of deps for
 * three endpoints we actually use, so we hit the JSON API directly.
 *
 * Endpoints used:
 *  - POST /transaction/initialize  — create checkout for one-shot flows
 *    (boost, cv, job-tier promotion)
 *  - GET  /transaction/verify/:ref — re-verify a transaction by
 *    reference (fallback for the /verify endpoint when the webhook
 *    hasn't landed yet)
 *  - verifySignature(rawBody, signature) — HMAC-SHA512 of the raw
 *    request body, keyed by the SECRET (not a separate webhook
 *    secret — Paystack uses the same secret for both API calls and
 *    webhook signing, unlike Stripe).
 */

const PAYSTACK_BASE = "https://api.paystack.co";

function getSecret(): string {
  const k = process.env.PAYSTACK_SECRET_KEY;
  if (!k) {
    throw new Error(
      "PAYSTACK_SECRET_KEY is not set; Paystack rail is not configured",
    );
  }
  return k;
}

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

export interface PaystackInitResponse {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export interface PaystackVerifyResponse {
  id: number;
  reference: string;
  amount: number;
  currency: string;
  status: string; // 'success' | 'failed' | 'abandoned'
  paid_at: string | null;
  customer: { email: string; customer_code?: string } | null;
  metadata: Record<string, unknown> | string | null;
}

async function paystackFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getSecret()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: PaystackEnvelope<T> | { status: false; message: string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `paystack ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  if (!res.ok || !("status" in json) || !json.status) {
    throw new Error(
      `paystack ${path} failed (${res.status}): ${
        "message" in json ? json.message : "unknown error"
      }`,
    );
  }
  return (json as PaystackEnvelope<T>).data;
}

/**
 * Initialize a transaction. Amount must be in the lowest currency
 * subunit (kobo for NGN, pesewas for GHS, cents for ZAR/KES).
 */
export async function paystackInitializeTransaction(args: {
  email: string;
  amountSubunits: number;
  currency: string;
  reference?: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}): Promise<PaystackInitResponse> {
  return paystackFetch<PaystackInitResponse>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: args.email,
      amount: args.amountSubunits,
      currency: args.currency.toUpperCase(),
      reference: args.reference,
      callback_url: args.callbackUrl,
      metadata: args.metadata,
    }),
  });
}

export async function paystackVerifyTransaction(
  reference: string,
): Promise<PaystackVerifyResponse> {
  return paystackFetch<PaystackVerifyResponse>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { method: "GET" },
  );
}

/**
 * Constant-time verification of a Paystack webhook signature.
 * Returns true when the HMAC-SHA512 of the raw body matches the
 * `x-paystack-signature` header.
 */
export function verifyPaystackSignature(
  rawBody: Buffer,
  signatureHeader: string | string[] | undefined,
): boolean {
  const sig = Array.isArray(signatureHeader)
    ? signatureHeader[0]
    : signatureHeader;
  if (!sig) return false;
  let secret: string;
  try {
    secret = getSecret();
  } catch (err) {
    logger.warn({ err }, "paystack signature verify skipped — secret missing");
    return false;
  }
  const computed = crypto
    .createHmac("sha512", secret)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
