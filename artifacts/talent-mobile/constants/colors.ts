/**
 * Semantic design tokens for TalentLink Mobile.
 *
 * Mirrors the palette from artifacts/talent-platform/src/index.css so that
 * web and mobile share the same visual identity.
 *
 * Primary: emerald — hsl(160 84% 39%) light / hsl(160 84% 45%) dark
 * Radius:  0.75rem from web → 12px on mobile
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: "#16191e",
    tint: "#10a872",

    // Core surfaces
    background: "#ffffff",
    foreground: "#16191e",

    // Cards / elevated surfaces
    card: "#ffffff",
    cardForeground: "#16191e",

    // Primary brand color
    primary: "#10a872",
    primaryForeground: "#ffffff",

    // Secondary / less-emphasis interactive surfaces
    secondary: "#f3f4f6",
    secondaryForeground: "#16191e",

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: "#f3f4f6",
    mutedForeground: "#6b7280",

    // Accent highlights
    accent: "#f3f4f6",
    accentForeground: "#16191e",

    // Destructive actions
    destructive: "#ef4444",
    destructiveForeground: "#ffffff",

    // Borders and input outlines
    border: "#e6e8eb",
    input: "#e6e8eb",
  },

  dark: {
    text: "#f0f1f3",
    tint: "#13d695",

    background: "#0c0e12",
    foreground: "#f0f1f3",

    card: "#10131a",
    cardForeground: "#f0f1f3",

    primary: "#13d695",
    primaryForeground: "#0c0e12",

    secondary: "#212530",
    secondaryForeground: "#f0f1f3",

    muted: "#212530",
    mutedForeground: "#a0a4af",

    accent: "#212530",
    accentForeground: "#f0f1f3",

    destructive: "#ef4444",
    destructiveForeground: "#ffffff",

    border: "#212530",
    input: "#212530",
  },

  radius: 12,
};

export default colors;
