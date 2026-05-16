import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { customFetch } from "@workspace/api-client-react";

import { useAuth } from "@/hooks/useAuth";

/**
 * Registers an Expo push token for the signed-in user, then keeps the
 * server informed if the token rotates. Silently no-ops on web (no
 * native push available there) and on the iOS Simulator (Expo refuses
 * to mint a token without a real APNs registration).
 *
 * Permission denial is also a no-op — the user simply won't receive
 * push, and the existing in-app notifications continue to work.
 */
export function usePushRegistration(): void {
  const { user } = useAuth();
  const lastRegisteredFor = useRef<{ userId: number; token: string } | null>(
    null,
  );

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!user) return;
    if (!Device.isDevice) return; // simulator: no real push

    let cancelled = false;
    let tokenSub: { remove: () => void } | null = null;

    const postToken = async (token: string) => {
      try {
        await customFetch<{ ok: boolean }>("/api/me/push-tokens", {
          method: "POST",
          body: JSON.stringify({
            token,
            platform:
              Platform.OS === "ios"
                ? "ios"
                : Platform.OS === "android"
                  ? "android"
                  : "unknown",
          }),
        });
        lastRegisteredFor.current = { userId: user.id, token };
      } catch {
        // best-effort
      }
    };

    (async () => {
      try {
        // Foreground display behavior. Without this the OS swallows
        // notifications received while the app is in the foreground,
        // which is surprising for users.
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldPlaySound: true,
            shouldSetBadge: true,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        });

        const existing = await Notifications.getPermissionsAsync();
        let status = existing.status;
        if (status !== "granted") {
          const req = await Notifications.requestPermissionsAsync();
          status = req.status;
        }
        if (status !== "granted") return;

        // Android requires an explicit channel; the default silently
        // drops priority-elevated notifications on newer OS versions.
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "default",
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        }

        const projectId =
          (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)
            ?.projectId ??
          (Constants as unknown as { easConfig?: { projectId?: string } })
            .easConfig?.projectId;

        const tokenData = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined,
        );
        if (cancelled) return;

        const token = tokenData.data;
        if (!token) return;

        // Avoid re-POSTing the same token on every render.
        const prev = lastRegisteredFor.current;
        if (!prev || prev.userId !== user.id || prev.token !== token) {
          await postToken(token);
        }

        // Re-register if the OS rotates the token while the app is
        // running. Without this, push delivery silently breaks after
        // a token refresh.
        tokenSub = Notifications.addPushTokenListener((next) => {
          if (next?.data) void postToken(next.data);
        });
      } catch {
        // Permissions / token mint failures are not actionable for the
        // user; silently degrade to in-app only.
      }
    })();

    return () => {
      cancelled = true;
      tokenSub?.remove();
      // If the user signed out (or switched accounts), revoke this
      // device's token on the server so it doesn't continue to receive
      // push for the previous account on a shared device.
      const prev = lastRegisteredFor.current;
      if (prev) {
        const tokenToRevoke = prev.token;
        lastRegisteredFor.current = null;
        customFetch("/api/me/push-tokens", {
          method: "DELETE",
          body: JSON.stringify({ token: tokenToRevoke }),
        }).catch(() => {});
      }
    };
  }, [user]);
}
