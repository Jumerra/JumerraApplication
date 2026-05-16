import { usePushRegistration } from "@/hooks/usePushRegistration";

/**
 * Headless component: hosts `usePushRegistration` so it can sit
 * underneath the auth context without polluting the root layout's
 * provider stack with extra hook plumbing.
 */
export function PushRegistrar(): null {
  usePushRegistration();
  return null;
}
