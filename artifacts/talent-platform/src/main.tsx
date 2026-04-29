import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installWebSessionAuth } from "./lib/web-session";

// Register the localStorage-backed bearer token fallback BEFORE the
// React tree mounts so the very first /auth/me request can carry it.
installWebSessionAuth();

createRoot(document.getElementById("root")!).render(<App />);
