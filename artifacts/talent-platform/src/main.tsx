import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installWebSessionAuth } from "./lib/web-session";
import { initWebSentry } from "./lib/sentry";
import { setBaseUrl } from "@workspace/api-client-react";

// If VITE_API_BASE_URL is set at build time (production deploys where
// the API lives on a different origin than the static site), route all
// generated API calls to it. Otherwise leave the base unset so relative
// /api/* paths are used (works for same-origin dev/preview setups).
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
if (apiBaseUrl) {
  setBaseUrl(apiBaseUrl);
}

// Initialize Sentry as early as possible so it can capture any error
// thrown during the very first render. No-op when VITE_SENTRY_DSN_WEB
// is unset (development default).
initWebSentry();

// Register the localStorage-backed bearer token fallback BEFORE the
// React tree mounts so the very first /auth/me request can carry it.
installWebSessionAuth();

createRoot(document.getElementById("root")!).render(<App />);
