import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installWebSessionAuth } from "./lib/web-session";
import { initWebSentry } from "./lib/sentry";

// Initialize Sentry as early as possible so it can capture any error
// thrown during the very first render. No-op when VITE_SENTRY_DSN_WEB
// is unset (development default).
initWebSentry();

// Register the localStorage-backed bearer token fallback BEFORE the
// React tree mounts so the very first /auth/me request can carry it.
installWebSessionAuth();

createRoot(document.getElementById("root")!).render(<App />);
