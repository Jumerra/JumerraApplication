// Anthropic SDK client wired through the Replit AI Integrations proxy.
// Env vars are auto-provisioned: AI_INTEGRATIONS_ANTHROPIC_BASE_URL and
// AI_INTEGRATIONS_ANTHROPIC_API_KEY.
import Anthropic from "@anthropic-ai/sdk";

const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

if (!baseURL || !apiKey) {
  // Don't crash the server at import time — the boot path doesn't depend
  // on AI. The client getter throws clearly when invoked.
}

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (cached) return cached;
  if (!baseURL || !apiKey) {
    throw new Error(
      "Anthropic AI integration is not configured. Missing AI_INTEGRATIONS_ANTHROPIC_BASE_URL or AI_INTEGRATIONS_ANTHROPIC_API_KEY.",
    );
  }
  cached = new Anthropic({
    baseURL,
    apiKey,
  });
  return cached;
}

export const ANTHROPIC_MODEL = "claude-sonnet-4-6";
