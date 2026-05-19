import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installWebSessionAuth } from "./lib/web-session";
import { initWebSentry } from "./lib/sentry";
import { setBaseUrl } from "@workspace/api-client-react";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
if (apiBaseUrl) {
  setBaseUrl(apiBaseUrl);
}

initWebSentry();
installWebSessionAuth();

createRoot(document.getElementById("root")!).render(<App />);
