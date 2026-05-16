import { Feather } from "@expo/vector-icons";
import { customFetch } from "@workspace/api-client-react";
import { router, Stack } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
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
  whatsappStrongMatch: boolean;
  whatsappApplicationStatus: boolean;
  whatsappInterviewReminder: boolean;
  whatsappWeeklyDigest: boolean;
  digestDow: number;
  digestHour: number;
  digestTz: string | null;
  effectiveDigestTz?: string;
};

type WhatsAppState = {
  number: string | null;
  verified: boolean;
  verifiedAt: string | null;
  pendingVerification: boolean;
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
  whatsappStrongMatch: false,
  whatsappApplicationStatus: false,
  whatsappInterviewReminder: false,
  whatsappWeeklyDigest: false,
  digestDow: 1,
  digestHour: 9,
  digestTz: null,
};

const WA_ROWS: { key: keyof Prefs; title: string }[] = [
  { key: "whatsappStrongMatch", title: "Strong matches" },
  { key: "whatsappApplicationStatus", title: "Application updates" },
  { key: "whatsappInterviewReminder", title: "Interview reminders" },
  { key: "whatsappWeeklyDigest", title: "Weekly digest" },
];

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
  const [sendingPreview, setSendingPreview] = useState(false);

  const [wa, setWa] = useState<WhatsAppState | null>(null);
  const [waNumber, setWaNumber] = useState("");
  const [waCode, setWaCode] = useState("");
  const [waBusy, setWaBusy] = useState(false);
  const [waDevCode, setWaDevCode] = useState<string | null>(null);

  const refreshWa = async () => {
    try {
      const data = await customFetch<WhatsAppState>("/api/me/whatsapp");
      setWa(data);
      if (data?.number) setWaNumber(data.number);
    } catch {
      /* no-op */
    }
  };

  const startWa = async () => {
    if (waNumber.trim().length < 6) return;
    setWaBusy(true);
    setWaDevCode(null);
    try {
      const res = await customFetch<{
        ok: boolean;
        sent: boolean;
        devCode?: string;
      }>("/api/me/whatsapp/start-verification", {
        method: "POST",
        body: JSON.stringify({ number: waNumber.trim() }),
      });
      if (res?.devCode) setWaDevCode(res.devCode);
      Alert.alert(
        res?.sent ? "Code sent" : "Verification started",
        res?.sent
          ? "Check your WhatsApp messages."
          : "Use the code displayed on the screen to confirm.",
      );
      await refreshWa();
    } catch (err) {
      Alert.alert(
        "Couldn't send code",
        (err as Error)?.message ?? "Try again in a moment.",
      );
    } finally {
      setWaBusy(false);
    }
  };

  const confirmWa = async () => {
    if (waCode.trim().length < 4) return;
    setWaBusy(true);
    try {
      await customFetch("/api/me/whatsapp/confirm", {
        method: "POST",
        body: JSON.stringify({ code: waCode.trim() }),
      });
      setWaCode("");
      setWaDevCode(null);
      await refreshWa();
      Alert.alert("Verified", "Your WhatsApp number is now connected.");
    } catch (err) {
      Alert.alert("Code didn't match", (err as Error)?.message ?? "Try again.");
    } finally {
      setWaBusy(false);
    }
  };

  const disconnectWa = async () => {
    setWaBusy(true);
    try {
      await customFetch("/api/me/whatsapp", { method: "DELETE" });
      setWaNumber("");
      setWaCode("");
      setWaDevCode(null);
      await Promise.all([
        refreshWa(),
        customFetch<Prefs>("/api/me/notification-prefs").then(setPrefs).catch(() => {}),
      ]);
    } finally {
      setWaBusy(false);
    }
  };

  const sendDigestPreview = async () => {
    setSendingPreview(true);
    try {
      await customFetch("/api/me/digest-preview", { method: "POST" });
      Alert.alert(
        "Preview sent",
        "Check your email and in-app inbox in a moment to see how your weekly digest will look.",
      );
    } catch (err: unknown) {
      // customFetch surfaces a 429 as an Error whose message contains
      // the server's JSON. Show the rate-limit copy when we can detect
      // it, otherwise a generic retry message.
      const msg = (err as Error)?.message ?? "";
      if (msg.includes("once per hour") || msg.includes("429")) {
        Alert.alert(
          "Try again later",
          "You can only send a preview once per hour.",
        );
      } else {
        Alert.alert(
          "Couldn't send preview",
          "Something went wrong. Please try again in a moment.",
        );
      }
    } finally {
      setSendingPreview(false);
    }
  };

  useEffect(() => {
    void refreshWa();
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

        <View style={{ marginTop: 20 }}>
          <Text
            style={{
              fontFamily: "Inter_600SemiBold",
              fontSize: 14,
              color: colors.foreground,
              marginBottom: 6,
            }}
          >
            WhatsApp alerts
          </Text>
          <Text
            style={{
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              color: colors.mutedForeground,
              marginBottom: 12,
            }}
          >
            Add and verify your WhatsApp number to also receive alerts on
            WhatsApp.
          </Text>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border, padding: 14 },
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
              WhatsApp number
            </Text>
            <TextInput
              value={waNumber}
              onChangeText={setWaNumber}
              editable={!waBusy}
              keyboardType="phone-pad"
              placeholder="+233 24 123 4567"
              placeholderTextColor={colors.mutedForeground}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                fontFamily: "Inter_400Regular",
                fontSize: 14,
                color: colors.foreground,
                marginBottom: 10,
              }}
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              <Pressable
                onPress={startWa}
                disabled={waBusy || waNumber.trim().length < 6}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  marginRight: 8,
                  marginBottom: 8,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.primary,
                  opacity: waBusy || waNumber.trim().length < 6 ? 0.5 : 1,
                }}
              >
                <Text
                  style={{
                    color: colors.primary,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 13,
                  }}
                >
                  {wa?.verified ? "Resend code" : "Send code"}
                </Text>
              </Pressable>
              {wa?.verified || wa?.number ? (
                <Pressable
                  onPress={disconnectWa}
                  disabled={waBusy}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    marginBottom: 8,
                    borderRadius: 10,
                  }}
                >
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    Disconnect
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {wa?.verified ? (
              <View
                style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}
              >
                <Feather name="check-circle" size={14} color={colors.primary} />
                <Text
                  style={{
                    marginLeft: 6,
                    color: colors.primary,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 12,
                  }}
                >
                  Verified
                </Text>
              </View>
            ) : null}

            {wa?.pendingVerification || waDevCode ? (
              <View style={{ marginTop: 8 }}>
                <Text
                  style={{
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 12,
                    color: colors.mutedForeground,
                    marginBottom: 6,
                  }}
                >
                  Enter the 6-digit code
                </Text>
                <TextInput
                  value={waCode}
                  onChangeText={setWaCode}
                  editable={!waBusy}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="123456"
                  placeholderTextColor={colors.mutedForeground}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    fontFamily: "Inter_500Medium",
                    fontSize: 16,
                    color: colors.foreground,
                    marginBottom: 8,
                  }}
                />
                {waDevCode ? (
                  <Text
                    style={{
                      fontFamily: "Inter_400Regular",
                      fontSize: 11,
                      color: colors.mutedForeground,
                      marginBottom: 8,
                    }}
                  >
                    No WhatsApp provider configured — dev code: {waDevCode}
                  </Text>
                ) : null}
                <Pressable
                  onPress={confirmWa}
                  disabled={waBusy || waCode.trim().length < 4}
                  style={{
                    alignSelf: "flex-start",
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    borderRadius: 10,
                    backgroundColor: colors.primary,
                    opacity: waBusy || waCode.trim().length < 4 ? 0.5 : 1,
                  }}
                >
                  <Text
                    style={{
                      color: "#fff",
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    Verify
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {prefs ? (
              <View
                style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                <Text
                  style={{
                    fontFamily: "Inter_400Regular",
                    fontSize: 11,
                    color: colors.mutedForeground,
                    marginBottom: 10,
                  }}
                >
                  Send these on WhatsApp
                  {wa?.verified ? "" : " (verify your number first)"}.
                </Text>
                {WA_ROWS.map((row, i) => (
                  <View
                    key={String(row.key)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingVertical: 8,
                      borderBottomWidth:
                        i < WA_ROWS.length - 1 ? 1 : 0,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "Inter_500Medium",
                        fontSize: 14,
                        color: colors.foreground,
                      }}
                    >
                      {row.title}
                    </Text>
                    <Switch
                      value={Boolean(prefs[row.key])}
                      onValueChange={(v) => patchPref(row.key, v as never)}
                      disabled={saving === row.key || !wa?.verified}
                      trackColor={{ false: colors.border, true: colors.primary }}
                    />
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>

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

              <View
                style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                <Pressable
                  onPress={sendDigestPreview}
                  disabled={sendingPreview}
                  style={{
                    alignSelf: "flex-start",
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: colors.primary,
                    backgroundColor: "transparent",
                    opacity: sendingPreview ? 0.6 : 1,
                    flexDirection: "row",
                    alignItems: "center",
                  }}
                >
                  {sendingPreview ? (
                    <ActivityIndicator
                      size="small"
                      color={colors.primary}
                      style={{ marginRight: 8 }}
                    />
                  ) : (
                    <Feather
                      name="send"
                      size={14}
                      color={colors.primary}
                      style={{ marginRight: 8 }}
                    />
                  )}
                  <Text
                    style={{
                      color: colors.primary,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    {sendingPreview ? "Sending…" : "Send me a preview"}
                  </Text>
                </Pressable>
                <Text
                  style={{
                    marginTop: 8,
                    fontFamily: "Inter_400Regular",
                    fontSize: 11,
                    color: colors.mutedForeground,
                  }}
                >
                  Sends the digest now so you can check the format. Limited
                  to once per hour.
                </Text>
              </View>
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
