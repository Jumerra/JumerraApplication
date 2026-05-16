/**
 * Client-side Sentry init. Skipped entirely in development unless
 * `VITE_SENTRY_DSN_WEB` is set so local builds don't ship events.
 *
 * PII handling: we explicitly disable `sendDefaultPii`, scrub the
 * `Authorization` / `Cookie` headers if Sentry ever captures them
 * through a fetch breadcrumb, and rely on the server's `x-request-id`
 * (exposed via CORS) for log correlation instead of user identifiers.
 */

import * as Sentry from "@sentry/react";

let _initialized = false;

export function initWebSentry(): void {
  if (_initialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN_WEB as string | undefined;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
    // Errors only for now — perf tracing produces a lot of events and
    // we can enable selectively later.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        const h = event.request.headers as Record<string, string>;
        for (const k of ["authorization", "cookie", "set-cookie"]) {
          if (k in h) h[k] = "[redacted]";
        }
      }
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }
      return event;
    },
    beforeBreadcrumb(crumb) {
      // Strip query strings from fetch breadcrumbs — they sometimes
      // carry email/token values when third-party SDKs build URLs.
      if (crumb.category === "fetch" && typeof crumb.data?.url === "string") {
        crumb.data.url = crumb.data.url.split("?")[0];
      }
      return crumb;
    },
  });
  _initialized = true;
}
