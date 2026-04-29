/**
 * Resolve a candidate/user avatarUrl into a fully-qualified URL the
 * `<Image>` component can fetch.
 *
 * The API returns a normalized object path (`/objects/uploads/<id>`) for
 * objects we minted via the storage upload flow. The storage router serves
 * those at `/api/storage/objects/...`, so we need to prepend the API base
 * (which on mobile is the remote workspace domain set via `setBaseUrl`).
 *
 * For absolute http(s) URLs, return as-is.
 *
 * NOTE on auth (native only): The `/storage/objects/*` route is
 * `requireAuth` server-side. On the web build, browser cookies are sent
 * automatically. On native, `expo-image` does not go through the
 * `customFetch` cookie jar, so authenticated avatar GETs would 401 if
 * this app is ever shipped as a native binary. The current deployment
 * target is the Expo web build, where this works as-is. If/when native
 * is targeted, either:
 *   (a) move avatar storage to a public-served path
 *       (`PUBLIC_OBJECT_SEARCH_PATHS`), or
 *   (b) inject a Cookie header via the `headers` option on the
 *       `<Image source={{ uri, headers }} />` prop, populated from
 *       the AsyncStorage cookie jar.
 */
export function avatarSrc(
  avatarUrl: string | null | undefined,
): string | undefined {
  if (!avatarUrl) return undefined;
  if (avatarUrl.startsWith("/objects/")) {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    const base = domain ? `https://${domain}` : "";
    return `${base}/api/storage${avatarUrl}`;
  }
  return avatarUrl;
}
