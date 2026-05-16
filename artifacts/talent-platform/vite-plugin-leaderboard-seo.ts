import fs from "node:fs";
import path from "node:path";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";

/**
 * Server-side meta-tag injection for the public institution
 * leaderboard page (`/institutions/:id/leaderboard`).
 *
 * The talent-platform is a Vite SPA, so `useEffect`-set meta tags are
 * invisible to social-media unfurl bots and many search crawlers. This
 * plugin intercepts requests to the leaderboard route in both dev
 * (`configureServer`) and production (`configurePreviewServer`), fetches
 * the public leaderboard JSON from the API, and rewrites the index.html
 * `<title>` + `<meta name="description">` + Open Graph + Twitter card
 * tags before sending the document — so crawlers see the right values
 * without running JavaScript.
 *
 * If the API call fails or the institution opted out, the original
 * (static) index.html is served unchanged. Errors are logged but never
 * thrown, so SPA navigation continues to work.
 */
const LEADERBOARD_RE = /^\/institutions\/(\d+)\/leaderboard\/?(?:\?.*)?$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Leaderboard = {
  institutionName: string;
  institutionLocation: string;
  institutionLogoUrl: string;
  totalPlaced: number;
  medianTimeToPlacementDays: number;
};

function buildMetaBlock(data: Leaderboard): string {
  const title = `${data.institutionName} — Placement Leaderboard | Jumerra`;
  const desc =
    `${data.totalPlaced} students placed from ${data.institutionName}. ` +
    `Median time to placement: ${data.medianTimeToPlacementDays} days. ` +
    `Top hiring partners and salary bands for graduates.`;
  const lines = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(desc)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(desc)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ];
  if (data.institutionLogoUrl) {
    lines.splice(
      5,
      0,
      `<meta property="og:image" content="${escapeHtml(data.institutionLogoUrl)}" />`,
    );
  }
  return lines.join("\n    ");
}

function rewriteHtml(html: string, data: Leaderboard): string {
  // Replace the static <title>...</title> + the default description meta
  // line with the per-institution block. We deliberately match a tight
  // pattern that mirrors what index.html ships with so we never blow
  // away unrelated tags.
  const block = buildMetaBlock(data);
  return html.replace(
    /<title>[\s\S]*?<\/title>[\s\S]*?<meta name="description"[^>]*\/?>/,
    block,
  );
}

async function fetchLeaderboard(
  institutionId: string,
): Promise<Leaderboard | null> {
  try {
    // Always go through the shared proxy on localhost:80 — works for both
    // `vite dev` (per-artifact port) and `vite preview` (production) in
    // Replit because the proxy fronts every artifact's API.
    const url = `http://localhost:80/api/institutions/${institutionId}/leaderboard`;
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    return (await r.json()) as Leaderboard;
  } catch {
    return null;
  }
}

export default function leaderboardSeoPlugin(): Plugin {
  const indexHtmlPath = path.resolve(import.meta.dirname, "index.html");
  const distIndexPath = path.resolve(
    import.meta.dirname,
    "dist/public/index.html",
  );

  return {
    name: "leaderboard-seo",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        const m = url.match(LEADERBOARD_RE);
        if (!m) return next();
        try {
          const data = await fetchLeaderboard(m[1]!);
          let html = fs.readFileSync(indexHtmlPath, "utf-8");
          // Let Vite do its standard dev transforms (HMR client, etc).
          html = await server.transformIndexHtml(url, html, req.originalUrl);
          if (data) html = rewriteHtml(html, data);
          res.setHeader("Content-Type", "text/html");
          res.setHeader("Cache-Control", "no-store");
          res.end(html);
        } catch (err) {
          server.config.logger.error(
            `[leaderboard-seo] ${err instanceof Error ? err.message : String(err)}`,
          );
          next();
        }
      });
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        const m = url.match(LEADERBOARD_RE);
        if (!m) return next();
        try {
          const data = await fetchLeaderboard(m[1]!);
          let html: string;
          try {
            html = fs.readFileSync(distIndexPath, "utf-8");
          } catch {
            return next();
          }
          if (data) html = rewriteHtml(html, data);
          res.setHeader("Content-Type", "text/html");
          res.setHeader("Cache-Control", "no-store");
          res.end(html);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[leaderboard-seo]", err);
          next();
        }
      });
    },
  };
}
