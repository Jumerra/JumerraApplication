import { useRouter, useSegments } from "expo-router";
import React, { useEffect } from "react";
import { View } from "react-native";

import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/hooks/useAuth";

const PUBLIC_ROOT_SEGMENT = "(auth)";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const segments = useSegments();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const inAuthGroup = segments[0] === PUBLIC_ROOT_SEGMENT;

  useEffect(() => {
    if (isLoading) return;
    if (!user && !inAuthGroup) {
      router.replace("/(auth)/sign-in");
    } else if (user && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [user, isLoading, inAuthGroup, router]);

  // Block rendering whenever auth state and current route group don't agree
  // so we never flash the wrong tree before `router.replace` runs.
  const mismatch =
    (!user && !inAuthGroup) || (Boolean(user) && inAuthGroup);

  if (isLoading || mismatch) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.background,
        }}
      >
        <LoadingSpinner />
      </View>
    );
  }

  return <>{children}</>;
}
