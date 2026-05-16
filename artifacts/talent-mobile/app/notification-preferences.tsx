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
  weeklyDigest: boolean;
  digestDow: number;
  digestHour: number;
  digestTz: string | null;
  effectiveDigestTz?: string;
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatHour(h: number): string {
  const suffix = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${suffix}`;
}

const DEFAULT_PREFS: Prefs = {
  strongMatch: true,
  applicationStatus: true,
  interviewReminder: true,
  profileViewed: true,
  weeklyDigest: true,
  digestDow: 1,
  digestHour: 9,
  digestTz: null,
};

type BooleanPrefKey =
  | "strongMatch"
  | "applicationStatus"
  | "interviewReminder"
  | "profileViewed"
  | "weeklyDigest";

const ROWS: { key: BooleanPrefKey; title: string; body: string }[] = [
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
  {
    key: "weeklyDigest",
    title: "Weekly digest",
    body: "Every Monday, send a recap of my week plus my top 5 new job matches.",
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
        if (!cancelled) setPrefs(DEFAULT_PREFS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patchPref = async <K extends keyof Prefs>(key: K, next: Prefs[K]) => {
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

  const toggle = (key: BooleanPrefKey, next: boolean) => patchPref(key, next);

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
                  value={Boolean(prefs[row.key])}
                  onValueChange={(v) => toggle(row.key, v)}
                  disabled={saving === row.key}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>
            ))}
          </View>
        )}

        {prefs && !loading ? (
          <View style={{ marginTop: 20 }}>
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 14,
                color: colors.foreground,
                marginBottom: 6,
              }}
            >
              Weekly digest delivery
            </Text>
            <Text
              style={{
                fontFamily: "Inter_400Regular",
                fontSize: 12,
                color: colors.mutedForeground,
                marginBottom: 12,
              }}
            >
              When to send your weekly digest, in your local time
              {prefs.effectiveDigestTz ? ` (${prefs.effectiveDigestTz})` : ""}.
            </Text>

            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border, padding: 12 },
              ]}
            >
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 12,
                  color: colors.mutedForeground,
                  marginBottom: 6,
                }}
              >
                Day
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 12 }}>
                {DOW_LABELS.map((label, dow) => {
                  const active = prefs.digestDow === dow;
                  return (
                    <Pressable
                      key={label}
                      onPress={() => patchPref("digestDow", dow)}
                      disabled={saving === "digestDow" || !prefs.weeklyDigest}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        marginRight: 6,
                        marginBottom: 6,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? colors.primary : "transparent",
                        opacity: prefs.weeklyDigest ? 1 : 0.5,
                      }}
                    >
                      <Text
                        style={{
                          color: active ? "#fff" : colors.foreground,
                          fontFamily: "Inter_600SemiBold",
                          fontSize: 12,
                        }}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 12,
                  color: colors.mutedForeground,
                  marginBottom: 6,
                }}
              >
                Time
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {Array.from({ length: 24 }, (_, h) => {
                  const active = prefs.digestHour === h;
                  return (
                    <Pressable
                      key={h}
                      onPress={() => patchPref("digestHour", h)}
                      disabled={saving === "digestHour" || !prefs.weeklyDigest}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        marginRight: 6,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? colors.primary : "transparent",
                        opacity: prefs.weeklyDigest ? 1 : 0.5,
                      }}
                    >
                      <Text
                        style={{
                          color: active ? "#fff" : colors.foreground,
                          fontFamily: "Inter_600SemiBold",
                          fontSize: 12,
                        }}
                      >
                        {formatHour(h)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {!prefs.weeklyDigest ? (
                <Text
                  style={{
                    marginTop: 10,
                    fontFamily: "Inter_400Regular",
                    fontSize: 11,
                    color: colors.mutedForeground,
                  }}
                >
                  Turn on Weekly digest above to start receiving these.
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

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
