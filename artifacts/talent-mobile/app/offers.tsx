import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMyOpenWindowQueryKey,
  getListMyOffersQueryKey,
  useAcceptReverseOffer,
  useCloseMyWindow,
  useCounterReverseOffer,
  useDeclineReverseOffer,
  useGetMyOpenWindow,
  useListMyOffers,
  useOpenMyWindow,
  type ReverseOffer,
} from "@workspace/api-client-react";
import { Stack, router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";

const WEB_TOP_INSET = Platform.OS === "web" ? 67 : 0;

function formatRemaining(closesAt: string): string {
  const diff = new Date(closesAt).getTime() - Date.now();
  if (diff <= 0) return "expiring";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h left`;
  return `${hours}h left`;
}

function statusColor(s: string, c: ReturnType<typeof useColors>): string {
  if (s === "accepted") return c.primary;
  if (s === "declined" || s === "expired") return c.mutedForeground;
  if (s === "countered") return c.primary;
  return c.foreground;
}

export default function OffersScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = makeStyles(colors);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const isCandidate = user?.role === "candidate";

  const { data: window } = useGetMyOpenWindow();
  const { data: offers, refetch: refetchOffers, isLoading } = useListMyOffers({
    query: { queryKey: getListMyOffersQueryKey(), enabled: isCandidate },
  });
  const openMut = useOpenMyWindow();
  const closeMut = useCloseMyWindow();
  const accept = useAcceptReverseOffer();
  const decline = useDeclineReverseOffer();
  const counter = useCounterReverseOffer();

  const [counterTarget, setCounterTarget] = useState<ReverseOffer | null>(null);
  const [cMin, setCMin] = useState("");
  const [cMax, setCMax] = useState("");

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: getGetMyOpenWindowQueryKey() }),
      refetchOffers(),
    ]);
    setRefreshing(false);
  };

  if (!isCandidate) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + WEB_TOP_INSET }]}>
        <Stack.Screen options={{ title: "Offers" }} />
        <EmptyState
          icon="briefcase"
          title="Candidates only"
          subtitle="Sign in as a candidate to receive reverse offers."
        />
      </View>
    );
  }

  const active = !!window && window.isActive;

  return (
    <View style={[styles.container, { paddingTop: insets.top + WEB_TOP_INSET }]}>
      <Stack.Screen options={{ title: "Offers", headerBackTitle: "Back" }} />

      <FlatList<ReverseOffer>
        data={offers ?? []}
        keyExtractor={(o) => String(o.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 12 }}
        ListHeaderComponent={
          <View style={styles.windowCard}>
            <View style={styles.windowHeader}>
              <Feather name="zap" size={20} color={colors.primary} />
              <Text style={styles.windowTitle}>Open to offers</Text>
            </View>
            <Text style={styles.windowBody}>
              Open a short auction window. Your identity stays anonymous until you accept.
            </Text>
            {active ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <View style={[styles.pill, { backgroundColor: colors.primary + "1A" }]}>
                  <Feather name="clock" size={12} color={colors.primary} />
                  <Text style={[styles.pillText, { color: colors.primary }]}>
                    {formatRemaining(window!.closesAt)}
                  </Text>
                </View>
                <Pressable
                  onPress={async () => {
                    try {
                      await closeMut.mutateAsync();
                      await qc.invalidateQueries({ queryKey: getGetMyOpenWindowQueryKey() });
                    } catch (e: any) {
                      Alert.alert("Could not close", e?.data?.error ?? "Try again");
                    }
                  }}
                  style={styles.ghostBtn}
                >
                  <Text style={styles.ghostBtnText}>Close window</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {[3, 7, 14, 30].map((d) => (
                  <Pressable
                    key={d}
                    onPress={async () => {
                      try {
                        await openMut.mutateAsync({ data: { days: d } });
                        await qc.invalidateQueries({ queryKey: getGetMyOpenWindowQueryKey() });
                      } catch (e: any) {
                        Alert.alert("Could not open", e?.data?.error ?? "Try again");
                      }
                    }}
                    style={styles.primaryBtn}
                  >
                    <Text style={styles.primaryBtnText}>Open {d}d</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
          ) : (
            <EmptyState
              icon="inbox"
              title="No offers yet"
              subtitle={active ? "Employers will show up here once they bid." : "Open your window to start receiving offers."}
            />
          )
        }
        renderItem={({ item: offer }) => (
          <View style={styles.offerCard}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={styles.offerTitle} numberOfLines={1}>{offer.jobTitle}</Text>
              <Text style={[styles.statusBadge, { color: statusColor(offer.status, colors) }]}>
                {offer.status}
              </Text>
            </View>
            <Text style={styles.offerSub} numberOfLines={1}>
              {offer.employerName ?? "Employer"}
            </Text>
            <Text style={styles.salary}>
              {offer.currency} {offer.salaryMin.toLocaleString()} – {offer.salaryMax.toLocaleString()}
            </Text>
            {offer.startDate && (
              <Text style={styles.meta}>Start: {new Date(offer.startDate).toLocaleDateString()}</Text>
            )}
            {offer.note ? <Text style={styles.note}>{offer.note}</Text> : null}

            {offer.status === "pending" && (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <Pressable
                  onPress={async () => {
                    try {
                      await accept.mutateAsync({ id: offer.id });
                      await qc.invalidateQueries({ queryKey: getListMyOffersQueryKey() });
                      Alert.alert("Offer accepted", "The employer can now see your profile.");
                    } catch (e: any) {
                      Alert.alert("Could not accept", e?.data?.error ?? "Try again");
                    }
                  }}
                  style={styles.primaryBtn}
                >
                  <Feather name="check" size={14} color={colors.primaryForeground} />
                  <Text style={styles.primaryBtnText}>Accept</Text>
                </Pressable>
                {!offer.parentOfferId && (
                  <Pressable
                    onPress={() => {
                      setCounterTarget(offer);
                      setCMin(String(offer.salaryMax));
                      setCMax(String(Math.round(offer.salaryMax * 1.15)));
                    }}
                    style={styles.outlineBtn}
                  >
                    <Feather name="repeat" size={14} color={colors.foreground} />
                    <Text style={styles.outlineBtnText}>Counter</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={async () => {
                    try {
                      await decline.mutateAsync({ id: offer.id });
                      await qc.invalidateQueries({ queryKey: getListMyOffersQueryKey() });
                    } catch (e: any) {
                      Alert.alert("Could not decline", e?.data?.error ?? "Try again");
                    }
                  }}
                  style={styles.ghostBtn}
                >
                  <Feather name="x" size={14} color={colors.mutedForeground} />
                  <Text style={styles.ghostBtnText}>Decline</Text>
                </Pressable>
              </View>
            )}
            {offer.status === "accepted" && offer.applicationId && (
              <Pressable
                onPress={() => router.push(`/application/${offer.applicationId}` as any)}
                style={[styles.outlineBtn, { marginTop: 12, alignSelf: "flex-start" }]}
              >
                <Text style={styles.outlineBtnText}>View application</Text>
              </Pressable>
            )}
          </View>
        )}
      />

      <Modal
        visible={!!counterTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setCounterTarget(null)}
      >
        <View style={styles.modalScrim}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Counter offer</Text>
            <Text style={styles.modalSub}>One counter only. Employer will be notified.</Text>
            <View style={{ gap: 10, marginTop: 12 }}>
              <View>
                <Text style={styles.label}>Salary min ({counterTarget?.currency ?? "USD"})</Text>
                <TextInput
                  value={cMin}
                  onChangeText={setCMin}
                  keyboardType="numeric"
                  style={styles.input}
                />
              </View>
              <View>
                <Text style={styles.label}>Salary max ({counterTarget?.currency ?? "USD"})</Text>
                <TextInput
                  value={cMax}
                  onChangeText={setCMax}
                  keyboardType="numeric"
                  style={styles.input}
                />
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
              <Pressable style={[styles.ghostBtn, { flex: 1 }]} onPress={() => setCounterTarget(null)}>
                <Text style={styles.ghostBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, { flex: 1 }]}
                onPress={async () => {
                  if (!counterTarget) return;
                  const min = Number(cMin);
                  const max = Number(cMax);
                  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
                    Alert.alert("Invalid salary", "Max must be at least min.");
                    return;
                  }
                  try {
                    await counter.mutateAsync({
                      id: counterTarget.id,
                      data: {
                        jobTitle: counterTarget.jobTitle,
                        salaryMin: min,
                        salaryMax: max,
                        currency: counterTarget.currency,
                      },
                    });
                    await qc.invalidateQueries({ queryKey: getListMyOffersQueryKey() });
                    setCounterTarget(null);
                  } catch (e: any) {
                    Alert.alert("Could not send counter", e?.data?.error ?? "Try again");
                  }
                }}
              >
                <Text style={styles.primaryBtnText}>Send counter</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    windowCard: {
      backgroundColor: c.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: c.primary + "33",
    },
    windowHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    windowTitle: { fontSize: 16, fontWeight: "700", color: c.foreground },
    windowBody: { fontSize: 13, color: c.mutedForeground, marginTop: 4 },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
    },
    pillText: { fontSize: 12, fontWeight: "600" },
    primaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      backgroundColor: c.primary,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 10,
    },
    primaryBtnText: { color: c.primaryForeground, fontWeight: "600", fontSize: 13 },
    outlineBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 10,
    },
    outlineBtnText: { color: c.foreground, fontWeight: "600", fontSize: 13 },
    ghostBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 10,
    },
    ghostBtnText: { color: c.mutedForeground, fontWeight: "600", fontSize: 13 },
    offerCard: {
      backgroundColor: c.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: c.border,
    },
    offerTitle: { fontSize: 16, fontWeight: "700", color: c.foreground, flex: 1 },
    statusBadge: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
    offerSub: { fontSize: 13, color: c.mutedForeground, marginTop: 2 },
    salary: { fontSize: 15, fontWeight: "700", color: c.foreground, marginTop: 8 },
    meta: { fontSize: 12, color: c.mutedForeground, marginTop: 2 },
    note: {
      fontSize: 13,
      color: c.mutedForeground,
      marginTop: 8,
      fontStyle: "italic",
      borderLeftWidth: 2,
      borderLeftColor: c.border,
      paddingLeft: 8,
    },
    modalScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    modalSheet: {
      backgroundColor: c.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      paddingBottom: 40,
    },
    modalTitle: { fontSize: 18, fontWeight: "700", color: c.foreground },
    modalSub: { fontSize: 13, color: c.mutedForeground, marginTop: 4 },
    label: { fontSize: 12, fontWeight: "600", color: c.mutedForeground, marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: c.foreground,
      backgroundColor: c.card,
    },
  });
}
