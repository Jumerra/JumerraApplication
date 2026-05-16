/**
 * Shared HTML email wrapper. Every transactional email rendered by
 * `lib/email.ts` goes through `renderEmailHtml()` so the brand
 * (colors, header, footer) is a single-file change.
 *
 * Kept deliberately inline-style — most email clients ignore <style>
 * blocks and class hooks, so the wrapper paints every container with
 * inline CSS that survives Outlook, Apple Mail, and Gmail.
 */

const PRIMARY = "#0d9488"; // teal-600 — matches the web UI
const TEXT = "#0f172a";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const BG = "#f8fafc";

export interface RenderEmailHtmlOpts {
  heading: string;
  /** Pre-rendered HTML body (callers control their own paragraphs). */
  body: string;
  cta?: { href: string; label: string } | null;
  footer?: string;
}

export function renderEmailHtml(opts: RenderEmailHtmlOpts): string {
  const ctaHtml = opts.cta
    ? `
      <tr><td style="padding:8px 0 24px 0;">
        <a href="${escapeAttr(opts.cta.href)}"
           style="background:${PRIMARY};color:#ffffff;text-decoration:none;
                  font-weight:600;padding:12px 20px;border-radius:8px;
                  display:inline-block;font-size:15px;">
          ${escapeHtml(opts.cta.label)}
        </a>
      </td></tr>`
    : "";
  const footerHtml = opts.footer
    ? `<p style="color:${MUTED};font-size:13px;margin:24px 0 0 0;">${opts.footer}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width" />
  <title>${escapeHtml(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BG};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560"
             style="max-width:560px;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
        <tr><td style="padding:20px 28px;border-bottom:1px solid ${BORDER};background:#ffffff;">
          <span style="font-size:18px;font-weight:700;color:${PRIMARY};letter-spacing:-0.01em;">Jumerra</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 16px 0;font-size:20px;font-weight:600;color:${TEXT};">
            ${escapeHtml(opts.heading)}
          </h1>
          <div style="font-size:15px;line-height:1.6;color:${TEXT};">${opts.body}</div>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            ${ctaHtml}
          </table>
          ${footerHtml}
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid ${BORDER};background:${BG};">
          <p style="margin:0;color:${MUTED};font-size:12px;">
            Jumerra · The talent platform built for early-career hiring.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
