// Stripe client wired through the Replit Stripe connector. Pulls
// credentials at call-time from the connector API rather than caching
// them, so token refreshes are picked up automatically.
import Stripe from "stripe";

interface StripeConnectionSettings {
  publishable: string;
  secret: string;
}

interface ConnectionItem {
  settings: StripeConnectionSettings;
}

let connectionSettings: ConnectionItem | undefined;

/**
 * Distinct failure modes around fetching Stripe credentials from the
 * Replit connector. We turn each into a typed error so route handlers
 * can map them to a meaningful HTTP response and log fields rather than
 * collapsing every failure into a generic "Failed to create checkout
 * session".
 */
export type StripeCredentialErrorCode =
  | "stripe_token_missing"
  | "stripe_connector_unreachable"
  | "stripe_connector_status"
  | "stripe_not_configured";

export class StripeCredentialError extends Error {
  readonly name = "StripeCredentialError";
  readonly code: StripeCredentialErrorCode;
  readonly status?: number;

  constructor(
    code: StripeCredentialErrorCode,
    message: string,
    options: { cause?: unknown; status?: number } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    Object.setPrototypeOf(this, new.target.prototype);
    this.code = code;
    this.status = options.status;
  }
}

async function getCredentials(): Promise<{
  publishableKey: string;
  secretKey: string;
}> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new StripeCredentialError(
      "stripe_token_missing",
      "Server is not running inside a Replit environment with credentials.",
    );
  }

  if (!hostname) {
    throw new StripeCredentialError(
      "stripe_token_missing",
      "REPLIT_CONNECTORS_HOSTNAME is not set on this server.",
    );
  }

  const connectorName = "stripe";
  const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
  const targetEnvironment = isProduction ? "production" : "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", connectorName);
  url.searchParams.set("environment", targetEnvironment);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    });
  } catch (cause) {
    // Typically a DNS failure, TLS handshake error, or socket reset
    // when the connector cold-starts. The user can usefully retry.
    throw new StripeCredentialError(
      "stripe_connector_unreachable",
      "Couldn't reach the Replit Stripe connector. Please try again in a moment.",
      { cause },
    );
  }

  if (!response.ok) {
    throw new StripeCredentialError(
      "stripe_connector_status",
      `Replit Stripe connector returned HTTP ${response.status}.`,
      { status: response.status },
    );
  }

  let data: { items?: ConnectionItem[] };
  try {
    data = (await response.json()) as { items?: ConnectionItem[] };
  } catch (cause) {
    throw new StripeCredentialError(
      "stripe_connector_status",
      "Replit Stripe connector returned an invalid response body.",
      { cause, status: response.status },
    );
  }

  connectionSettings = data.items?.[0];

  if (
    !connectionSettings ||
    !connectionSettings.settings.publishable ||
    !connectionSettings.settings.secret
  ) {
    throw new StripeCredentialError(
      "stripe_not_configured",
      `Stripe ${targetEnvironment} connection isn't configured. Please contact support.`,
    );
  }

  return {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
  };
}

// WARNING: Never cache this client. Always call this function again to
// get a fresh client.
export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey, {
    // Latest API version per Replit Stripe blueprint. Do not pin to an
    // older version.
    apiVersion: "2026-04-22.dahlia",
  });
}

/**
 * Result of mapping an arbitrary thrown checkout error onto an HTTP
 * response. Routes use this to keep their catch blocks tiny and
 * consistent across the boost + CV checkout endpoints.
 */
export interface StripeCheckoutErrorResponse {
  status: number;
  body: { error: string; code: string };
  /** Extra fields to merge into the structured log line. */
  logFields: Record<string, unknown>;
}

/**
 * Map a thrown error from the checkout-session creation flow onto a
 * concrete HTTP response. We distinguish:
 *
 *   - Replit connector / credential issues (`stripe_*` from
 *     `StripeCredentialError`).
 *   - Stripe SDK errors (network/auth/rate-limit/etc.).
 *   - Everything else (true 500).
 *
 * The returned `code` field is what the mobile/web client uses to pick
 * an appropriate alert title; the `error` string is the human-readable
 * message a candidate can act on.
 */
export function mapStripeCheckoutError(
  err: unknown,
): StripeCheckoutErrorResponse {
  if (err instanceof StripeCredentialError) {
    if (
      err.code === "stripe_not_configured" ||
      err.code === "stripe_token_missing"
    ) {
      return {
        status: 503,
        body: {
          error:
            "Payments aren't configured on this server yet. Please contact support.",
          code: err.code,
        },
        logFields: { errCode: err.code, errMessage: err.message },
      };
    }
    return {
      status: 503,
      body: {
        error:
          "Couldn't reach the payment service. Please try again in a moment.",
        code: err.code,
      },
      logFields: {
        errCode: err.code,
        errMessage: err.message,
        connectorStatus: err.status,
      },
    };
  }

  if (err instanceof Stripe.errors.StripeError) {
    if (err instanceof Stripe.errors.StripeConnectionError) {
      return {
        status: 503,
        body: {
          error:
            "Couldn't reach Stripe right now. Please try again in a moment.",
          code: "stripe_connection_error",
        },
        logFields: { errType: err.type, stripeCode: err.code },
      };
    }
    if (err instanceof Stripe.errors.StripeAuthenticationError) {
      return {
        status: 503,
        body: {
          error:
            "Payments are misconfigured on this server. Please contact support.",
          code: "stripe_auth_error",
        },
        logFields: { errType: err.type, stripeCode: err.code },
      };
    }
    if (err instanceof Stripe.errors.StripeRateLimitError) {
      return {
        status: 503,
        body: {
          error: "Stripe is busy right now. Please try again in a few seconds.",
          code: "stripe_rate_limited",
        },
        logFields: { errType: err.type, stripeCode: err.code },
      };
    }
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      return {
        status: 502,
        body: {
          error:
            err.message ||
            "Stripe rejected the checkout request. Please try again or contact support.",
          code: "stripe_invalid_request",
        },
        logFields: {
          errType: err.type,
          stripeCode: err.code,
          stripeParam: err.param,
          stripeMessage: err.message,
        },
      };
    }
    if (err instanceof Stripe.errors.StripeAPIError) {
      return {
        status: 502,
        body: {
          error:
            "Stripe is temporarily unavailable. Please try again in a few minutes.",
          code: "stripe_api_error",
        },
        logFields: {
          errType: err.type,
          stripeCode: err.code,
          stripeStatus: err.statusCode,
        },
      };
    }
    if (err instanceof Stripe.errors.StripePermissionError) {
      return {
        status: 502,
        body: {
          error:
            "This server isn't allowed to create that checkout. Please contact support.",
          code: "stripe_permission_error",
        },
        logFields: { errType: err.type, stripeCode: err.code },
      };
    }
    return {
      status: 502,
      body: {
        error:
          err.message || "Stripe couldn't create the checkout session.",
        code: "stripe_error",
      },
      logFields: {
        errType: err.type,
        stripeCode: err.code,
        stripeStatus: err.statusCode,
      },
    };
  }

  return {
    status: 500,
    body: {
      error:
        "An unexpected error occurred while creating the checkout session.",
      code: "internal_error",
    },
    logFields: {},
  };
}
