import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl, setCookieJar } from "@workspace/api-client-react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthGate } from "@/components/AuthGate";
import { ErrorBoundary } from "@/components/ErrorBoundary";

SplashScreen.preventAutoHideAsync();

setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);

if (Platform.OS !== "web") {
  const STORAGE_KEY = "talentlink.session-cookies";
  let cookies: Record<string, string> = {};
  let loadPromise: Promise<void> | null = null;

  const ensureLoaded = (): Promise<void> => {
    if (!loadPromise) {
      loadPromise = AsyncStorage.getItem(STORAGE_KEY)
        .then((raw) => {
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === "object") {
                cookies = parsed as Record<string, string>;
              }
            } catch {
              cookies = {};
            }
          }
        })
        .catch(() => {
          cookies = {};
        });
    }
    return loadPromise;
  };

  const persist = async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cookies));
    } catch {
      // Best-effort; ignore persistence failures.
    }
  };

  setCookieJar({
    async getCookieHeader() {
      await ensureLoaded();
      const entries = Object.entries(cookies);
      if (entries.length === 0) return null;
      return entries.map(([name, value]) => `${name}=${value}`).join("; ");
    },
    async setCookies(_url, setCookieHeaders) {
      await ensureLoaded();
      let changed = false;
      for (const setCookie of setCookieHeaders) {
        const firstSemi = setCookie.indexOf(";");
        const pair = firstSemi >= 0 ? setCookie.slice(0, firstSemi) : setCookie;
        const eqIdx = pair.indexOf("=");
        if (eqIdx <= 0) continue;
        const name = pair.slice(0, eqIdx).trim();
        const value = pair.slice(eqIdx + 1).trim();
        if (!name) continue;

        const isExpired =
          /max-age=0\b/i.test(setCookie) ||
          /expires=thu, 01 jan 1970/i.test(setCookie) ||
          value === "" ||
          value === '""';

        if (isExpired) {
          if (cookies[name] !== undefined) {
            delete cookies[name];
            changed = true;
          }
        } else if (cookies[name] !== value) {
          cookies[name] = value;
          changed = true;
        }
      }
      if (changed) await persist();
    },
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="job/[id]/index"
        options={{ headerTitle: "", headerTransparent: true }}
      />
      <Stack.Screen
        name="job/[id]/apply"
        options={{ presentation: "modal", headerTitle: "Apply" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AuthGate>
                <RootLayoutNav />
              </AuthGate>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
