import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  getGetAutoApplyStatusQueryKey,
  getListAutoApplyActivityQueryKey,
  useCreateAutoApplyCheckout,
  useGetAutoApplyStatus,
  useListAutoApplyActivity,
  useToggleAutoApply,
  useVerifyAutoApplyCheckout,
  useWithdrawAutoApplyApplication,
  type AutoApplyActivityItem,
  type AutoApplyActivityItemApplicationStatus,
} from "@workspace/api-client-react";
import { Stack, router } from "expo-router";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { StatusPill } from "@/components/StatusPill";
import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";
import {
  buildCancelUrl as buildCancelUrlPure,
  buildSuccessUrl as buildSuccessUrlPure,
  buildWebOrigin,
  getDeepLinkPrefix as getDeepLinkPrefixPure,
} from "@/lib/checkout-urls";
import { runMobileCheckoutFlow } from "@/lib/checkout-flow";

const WEB_TOP_INSET = Platform.OS === "web" ? 67 : 0;
const RETURN_SUFFIX = "/auto-apply/return";

// Once an employer has made a final decision, withdrawing makes no sense.
const WITHDRAWABLE = new Set<AutoApplyActivityItemApplicationStatus>([
  "applied",
  "screening",
  "interview",
  "offer",
]);

function formatPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getWebOrigin(): string {
  return buildWebOrigin({
    isWeb: Platform.OS === "web",
    windowOrigin: Platform.OS === "web" ? window.location.origin : null,
    envDomain: process.env.EXPO_PUBLIC_DOMAIN ?? null,
  });
}

function getDeepLinkPrefix(suffix: string): string | null {
  return getDeepLinkPrefixPure({
    isWeb: Platform.OS === "web",
    suffix,
    createUrl: (path) => Linking.createURL(path),
  });
}

function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const data =
      err.data && typeof err.data === "object"
        ? (err.data as { error?: unknown })
        : null;
    if (typeof data?.error === "string" && data.error.length > 0) {
      return data.error;
    }
  }
  if (err instanceof Error && err.message) {
    return err.message.replace(/^HTTP \d+ [^:]+: /, "");
  }
  return fallback;
}

export default function AutoApplyScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = makeStyles(colors);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const isCandidate = user?.role === "candidate";
  const candidateId = user?.candidateId ?? 0;
  const hasCandidateRecord = isCandidate && candidateId > 0;

  const { data: status, isLoading } = useGetAutoApplyStatus(candidateId, {
    query: {
      queryKey: getGetAutoApplyStatusQueryKey(candidateId),
      enabled: hasCandidateRecord,
    },
  });
  const { data: activity } = useListAutoApplyActivity(candidateId, {
    query: {
      queryKey: getListAutoApplyActivityQueryKey(candidateId),
      enabled: hasCandidateRecord,
    },
  });

  const toggle = useToggleAutoApply();
  const checkout = useCreateAutoApplyCheckout();
  const verify = useVerifyAutoApplyCheckout();
  const withdraw = useWithdrawAutoApplyApplication();
  const [busy, setBusy] = React.useState(false);
  const [withdrawingId, setWithdrawingId] = React.useState<number | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: getGetAutoApplyStatusQueryKey(candidateId),
    });
  };

  const onWithdraw = (item: AutoApplyActivityItem) => {
    Alert.alert(
      "Withdraw application?",
      `This withdraws your application to "${item.jobTitle}". Auto-Apply won't re-apply to this job.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: async () => {
            setWithdrawingId(item.id);
            try {
              await withdraw.mutateAsync({ id: candidateId, logId: item.id });
              await queryClient.invalidateQueries({
                queryKey: getListAutoApplyActivityQueryKey(candidateId),
              });
            } catch (err) {
              Alert.alert(
                "Couldn't withdraw",
                describeError(
                  err,
                  "Failed to withdraw application. Please try again.",
                ),
              );
            } finally {
              setWithdrawingId(null);
            }
          },
        },
      ],
    );
  };

  const onToggle = async (next: boolean) => {
    try {
      await toggle.mutateAsync({ id: candidateId, data: { enabled: next } });
      await refresh();
    } catch (err) {
      Alert.alert(
        "Couldn't update",
        describeError(err, "Failed to update the Auto-Apply switch."),
      );
    }
  };

  const onSubscribe = async () => {
    setBusy(true);
    try {
      const origin = getWebOrigin();
      const deepLink = getDeepLinkPrefix(RETURN_SUFFIX);
      const successUrl = buildSuccessUrlPure({
        suffix: RETURN_SUFFIX,
        origin,
        deepLink,
      });
      const cancelUrl = buildCancelUrlPure({
        suffix: RETURN_SUFFIX,
        origin,
        deepLink,
      });

      if (Platform.OS === "web") {
        const { checkoutUrl } = await checkout.mutateAsync({
          id: candidateId,
          data: { successUrl, cancelUrl },
        });
        window.location.href = checkoutUrl;
        return;
      }

      const result = await runMobileCheckoutFlow({
        successUrl,
        cancelUrl,
        deepLink: deepLink ?? Linking.createURL(""),
        createCheckout: (urls) =>
          checkout.mutateAsync({ id: candidateId, data: urls }),
        openAuthSession: (url, redirect) =>
          WebBrowser.openAuthSessionAsync(url, redirect),
        parseReturnUrl: (url) => {
          const parsed = Linking.parse(url);
          return { queryParams: parsed.queryParams ?? null };
        },
        verify: async (sessionId) => {
          await verify.mutateAsync({ data: { sessionId } });
        },
        onVerified: refresh,
      });

      if (result.status === "success") {
        Alert.alert(
          "Auto-Apply is live",
          "Your subscription is active. Turn the switch on to start applying to strong matches.",
        );
      }
    } catch (err) {
      Alert.alert(
        "Checkout failed",
        describeError(err, "We couldn't start checkout. Please try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  if (user && !isCandidate) {
    return (
      <View
        style={[styles.container, { paddingTop: insets.top + WEB_TOP_INSET }]}
      >
        <Stack.Screen options={{ title: "AI Auto-Apply" }} />
        <EmptyState
          icon="user-x"
          title="Candidates only"
          subtitle="Sign in with a candidate account to manage AI Auto-Apply."
        />
      </View>
    );
  }

  if (isLoading || !user) {
    return (
      <View
        style={[styles.container, { paddingTop: insets.top + WEB_TOP_INSET }]}
      >
        <Stack.Screen options={{ title: "AI Auto-Apply" }} />
        <LoadingSpinner />
      </View>
    );
  }

  const settings = status?.settings;
  const featureOff = !!settings && !settings.isActive;
  const subActive = status?.subscriptionActive ?? false;
  const enabled = status?.enabled ?? false;
  const periodEnd = status?.subscription?.currentPeriodEnd ?? null;
  const usedToday = status?.usedToday ?? 0;
  const dailyCap = status?.dailyCap ?? settings?.dailyCap ?? 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top + WEB_TOP_INSET }]}>
      <Stack.Screen
        options={{ title: "AI Auto-Apply", headerBackTitle: "Back" }}
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }}
      >
        <View style={styles.intro}>
          <View style={styles.introIcon}>
            <Feather name="zap" size={20} color={colors.primary} />
          </View>
          <Text style={styles.introText}>
            Let Jumerra automatically submit your application to new jobs that
            strongly match your profile — so you never miss a great opening.
          </Text>
        </View>

        {featureOff ? (
          <View style={styles.card}>
            <EmptyState
              icon="clock"
              title="Not available right now"
              subtitle="AI Auto-Apply isn't available right now. Check back soon."
            />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>Subscription</Text>
                {subActive ? (
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: colors.primary + "1A" },
                    ]}
                  >
                    <Feather
                      name="check-circle"
                      size={12}
                      color={colors.primary}
                    />
                    <Text style={[styles.badgeText, { color: colors.primary }]}>
                      Active
                    </Text>
                  </View>
                ) : null}
              </View>
              {settings ? (
                <Text style={styles.cardSubtitle}>
                  {formatPrice(settings.priceCents, settings.currency)} every{" "}
                  {settings.intervalDays} days. Cancel anytime.
                </Text>
              ) : null}

              {subActive ? (
                <Text style={[styles.bodyText, { marginTop: 12 }]}>
                  Your subscription is active
                  {periodEnd ? (
                    <Text style={{ color: colors.foreground, fontWeight: "600" }}>
                      {" "}
                      until {formatDate(periodEnd)}
                    </Text>
                  ) : null}
                  .
                </Text>
              ) : (
                <>
                  <View style={{ gap: 10, marginTop: 14 }}>
                    <Benefit
                      colors={colors}
                      text="We apply for you the moment a strong match is posted."
                    />
                    <Benefit
                      colors={colors}
                      text={`Only high-confidence matches${
                        settings ? ` (${settings.matchThreshold}+ score)` : ""
                      } — no spam.`}
                    />
                    <Benefit
                      colors={colors}
                      text={`Capped at ${settings?.dailyCap ?? 0} applications a day.`}
                    />
                  </View>
                  <Pressable
                    onPress={onSubscribe}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      { opacity: pressed || busy ? 0.85 : 1, marginTop: 16 },
                    ]}
                    accessibilityLabel="Subscribe to Auto-Apply"
                  >
                    {busy ? (
                      <ActivityIndicator color={colors.primaryForeground} />
                    ) : (
                      <>
                        <Text style={styles.primaryBtnText}>Subscribe</Text>
                        <Feather
                          name="arrow-right"
                          size={16}
                          color={colors.primaryForeground}
                        />
                      </>
                    )}
                  </Pressable>
                </>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Auto-Apply switch</Text>
              <Text style={styles.cardSubtitle}>
                Turn this on to let the engine apply on your behalf. It only runs
                while your subscription is active.
              </Text>
              <View style={styles.switchRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.switchTitle}>
                    {enabled ? "Auto-Apply is on" : "Auto-Apply is off"}
                  </Text>
                  <Text style={styles.switchSub}>
                    {!subActive
                      ? "Subscribe first — the switch has no effect without an active subscription."
                      : enabled
                        ? "We'll apply to strong matches as they're posted."
                        : "Flip this on to start auto-applying."}
                  </Text>
                </View>
                <Switch
                  value={enabled}
                  disabled={toggle.isPending}
                  onValueChange={onToggle}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.background}
                />
              </View>
              {subActive ? (
                <Text style={styles.usageText}>
                  {usedToday} of {dailyCap} applications used today
                </Text>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recent auto-applications</Text>
              <Text style={styles.cardSubtitle}>
                Jobs we've applied to for you, newest first. Withdraw any you're
                no longer interested in.
              </Text>
              {!activity || activity.length === 0 ? (
                <Text style={[styles.bodyText, styles.emptyActivity]}>
                  No auto-applications yet. Once you're subscribed and switched
                  on, matching jobs will appear here.
                </Text>
              ) : (
                <View style={{ marginTop: 8 }}>
                  {activity.map((item, idx) => {
                    const appStatus = item.applicationStatus;
                    const canWithdraw =
                      item.applicationId != null &&
                      appStatus != null &&
                      WITHDRAWABLE.has(appStatus);
                    const isWithdrawing = withdrawingId === item.id;
                    return (
                      <View
                        key={item.id}
                        style={[
                          styles.activityRow,
                          idx > 0 ? styles.activityDivider : null,
                        ]}
                      >
                        <View style={styles.activityMain}>
                          <Pressable
                            onPress={() =>
                              router.push(`/job/${item.jobId}` as never)
                            }
                            style={({ pressed }) => [
                              { flex: 1, paddingRight: 12 },
                              { opacity: pressed ? 0.7 : 1 },
                            ]}
                          >
                            <Text
                              style={styles.activityTitle}
                              numberOfLines={1}
                            >
                              {item.jobTitle}
                            </Text>
                            <View style={styles.activityMeta}>
                              <Feather
                                name="clock"
                                size={11}
                                color={colors.mutedForeground}
                              />
                              <Text style={styles.activityMetaText}>
                                {formatDateTime(item.createdAt)}
                              </Text>
                            </View>
                          </Pressable>
                          <View
                            style={[
                              styles.matchBadge,
                              { backgroundColor: colors.primary + "1A" },
                            ]}
                          >
                            <Text
                              style={[
                                styles.matchBadgeText,
                                { color: colors.primary },
                              ]}
                            >
                              {item.matchScore}% match
                            </Text>
                          </View>
                        </View>
                        <View style={styles.activityStatusRow}>
                          {appStatus ? <StatusPill status={appStatus} /> : null}
                          {canWithdraw ? (
                            <Pressable
                              onPress={() => onWithdraw(item)}
                              disabled={isWithdrawing}
                              style={({ pressed }) => [
                                styles.withdrawBtn,
                                {
                                  borderColor: colors.border,
                                  borderRadius: colors.radius,
                                  opacity:
                                    pressed || isWithdrawing ? 0.7 : 1,
                                },
                              ]}
                              accessibilityLabel={`Withdraw application to ${item.jobTitle}`}
                            >
                              {isWithdrawing ? (
                                <ActivityIndicator
                                  size="small"
                                  color={colors.destructive}
                                />
                              ) : (
                                <>
                                  <Feather
                                    name="x"
                                    size={13}
                                    color={colors.destructive}
                                  />
                                  <Text
                                    style={[
                                      styles.withdrawText,
                                      { color: colors.destructive },
                                    ]}
                                  >
                                    Withdraw
                                  </Text>
                                </>
                              )}
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Benefit({
  colors,
  text,
}: {
  colors: ReturnType<typeof useColors>;
  text: string;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
      <Feather
        name="check"
        size={14}
        color={colors.primary}
        style={{ marginTop: 2 }}
      />
      <Text
        style={{
          flex: 1,
          color: colors.mutedForeground,
          fontFamily: "Inter_400Regular",
          fontSize: 13,
          lineHeight: 19,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    intro: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
    introIcon: {
      width: 40,
      height: 40,
      borderRadius: c.radius,
      backgroundColor: c.primary + "1A",
      alignItems: "center",
      justifyContent: "center",
    },
    introText: {
      flex: 1,
      color: c.mutedForeground,
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 19,
    },
    card: {
      backgroundColor: c.card,
      borderRadius: c.radius * 1.5,
      borderWidth: 1,
      borderColor: c.border,
      padding: 16,
    },
    cardHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    cardTitle: {
      fontFamily: "Inter_700Bold",
      fontSize: 16,
      color: c.foreground,
    },
    cardSubtitle: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      color: c.mutedForeground,
      marginTop: 4,
      lineHeight: 19,
    },
    badge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
    },
    badgeText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
    bodyText: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      color: c.mutedForeground,
      lineHeight: 19,
    },
    primaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: c.primary,
      paddingVertical: 12,
      borderRadius: c.radius,
    },
    primaryBtnText: {
      color: c.primaryForeground,
      fontFamily: "Inter_600SemiBold",
      fontSize: 14,
    },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: c.radius,
      padding: 14,
      marginTop: 14,
    },
    switchTitle: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 14,
      color: c.foreground,
    },
    switchSub: {
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      color: c.mutedForeground,
      marginTop: 4,
      lineHeight: 17,
    },
    usageText: {
      fontFamily: "Inter_500Medium",
      fontSize: 12,
      color: c.mutedForeground,
      marginTop: 12,
    },
    emptyActivity: {
      textAlign: "center",
      paddingVertical: 16,
    },
    activityRow: {
      paddingVertical: 12,
      gap: 8,
    },
    activityMain: {
      flexDirection: "row",
      alignItems: "center",
    },
    activityDivider: {
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    activityTitle: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 14,
      color: c.foreground,
    },
    activityMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: 3,
    },
    activityMetaText: {
      fontFamily: "Inter_400Regular",
      fontSize: 11,
      color: c.mutedForeground,
    },
    activityStatusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    matchBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
    },
    matchBadgeText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
    withdrawBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      borderWidth: 1,
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    withdrawText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 12,
    },
  });
}
