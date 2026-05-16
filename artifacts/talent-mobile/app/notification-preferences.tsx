import { Feather } from "@expo/vector-icons";
import { customFetch } from "@workspace/api-client-react";
import { router, Stack } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type Prefs = {
  strongMatch: boolean;
  applicationStatus: boolean;
  interviewReminder: boolean;
  profileViewed: boolean;
};

const ROWS: { key: keyof Prefs; title: string; body: string }[] = [
  {
    key: "strongMatch",
    title: "Strong matches",
    body: "Notify me when we find a great-fit role for my profile.",
  },
  {
    key: "applicationStatus",
    title: "Application updates",
    body: "Notify me when an employer changes the status of one of my applications.",
  },
  {
    key: "interviewReminder",
    title: "Interview reminders",
    body: "Send a reminder 24 hours and 1 hour before each interview.",
  },
  {
    key: "profileViewed",
    title: "Profile views (Boost)",
    body: "Notify me when an employer views my profile while my Boost is active.",
  },
];

export default function NotificationPreferencesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<keyof Prefs | null>(null);

  useEffect(() => {
    let cancelled = false;
    customFetch<Prefs>("/api/me/notification-prefs")
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch(() => {
        if (!cancelled)
          setPrefs({
            strongMatch: true,
            applicationStatus: true,
            interviewReminder: true,
            profileViewed: true,
          });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (key: keyof Prefs, next: boolean) => {
    if (!prefs) return;
    const optimistic = { ...prefs, [key]: next };
    setPrefs(optimistic);
    setSaving(key);
    try {
      const updated = await customFetch<Prefs>("/api/me/notification-prefs", {
        method: "PUT",
        body: JSON.stringify({ [key]: next }),
      });
      setPrefs(updated);
    } catch {
      // Revert on failure
      setPrefs(prefs);
    } finally {
      setSaving(null);
    }
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Notifications" }} />

      <ScrollView
        contentContainerStyle={{
          paddingTop: Platform.OS === "web" ? 16 : 8,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 16,
        }}
      >
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: "Inter_400Regular",
            fontSize: 13,
            lineHeight: 18,
            marginBottom: 16,
          }}
        >
          Choose which kinds of alerts we send you. We always keep a copy in
          your in-app inbox even if you turn off push.
        </Text>

        {loading || !prefs ? (
          <View style={{ paddingVertical: 32, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {ROWS.map((row, i) => (
              <View
                key={row.key}
                style={[
                  styles.row,
                  i < ROWS.length - 1
                    ? { borderBottomWidth: 1, borderBottomColor: colors.border }
                    : null,
                ]}
              >
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text
                    style={{
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 15,
                      color: colors.foreground,
                    }}
                  >
                    {row.title}
                  </Text>
                  <Text
                    style={{
                      marginTop: 4,
                      fontFamily: "Inter_400Regular",
                      fontSize: 12,
                      color: colors.mutedForeground,
                    }}
                  >
                    {row.body}
                  </Text>
                </View>
                <Switch
                  value={prefs[row.key]}
                  onValueChange={(v) => toggle(row.key, v)}
                  disabled={saving === row.key}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>
            ))}
          </View>
        )}

        <Pressable
          onPress={() => router.back()}
          style={{
            marginTop: 24,
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            paddingVertical: 8,
          }}
        >
          <Feather name="chevron-left" size={16} color={colors.primary} />
          <Text
            style={{
              marginLeft: 4,
              color: colors.primary,
              fontFamily: "Inter_600SemiBold",
            }}
          >
            Back
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
});
