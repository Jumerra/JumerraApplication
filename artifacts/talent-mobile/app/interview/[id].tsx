import {
  getGetCandidateDashboardQueryKey,
  getGetInterviewInviteQueryKey,
  getListApplicationsQueryKey,
  getListInterviewInvitesForCandidateQueryKey,
  useAcceptInterviewInvite,
  useDeclineInterviewInvite,
  useGetInterviewInvite,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";

/**
 * Defense-in-depth: only treat meeting links as openable when they
 * parse to an http(s) URL. The backend rejects unsafe protocols on
 * write, but legacy rows might still contain unsafe payloads.
 */
function isSafeWebUrl(value: string | null | undefined): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatSlot(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dateStr = start.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startTime = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const endTime = end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateStr} · ${startTime}–${endTime}`;
}

export default function InterviewInviteScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const inviteId = Number(params.id);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const inviteQuery = useGetInterviewInvite(inviteId, {
    query: {
      queryKey: getGetInterviewInviteQueryKey(inviteId),
      enabled: Number.isFinite(inviteId) && inviteId > 0,
    },
  });
  const acceptInvite = useAcceptInterviewInvite();
  const declineInvite = useDeclineInterviewInvite();

  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [declineMode, setDeclineMode] = useState(false);
  const [reason, setReason] = useState("");

  const invalidateAll = () => {
    queryClient.invalidateQueries({
      queryKey: getGetInterviewInviteQueryKey(inviteId),
    });
    if (user?.candidateId) {
      queryClient.invalidateQueries({
        queryKey: getListInterviewInvitesForCandidateQueryKey(user.candidateId),
      });
      queryClient.invalidateQueries({
        queryKey: getGetCandidateDashboardQueryKey(user.candidateId),
      });
    }
    // Accepting/declining flips applications.status server-side, so the
    // mobile applications tab needs to refetch.
    queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
  };

  if (inviteQuery.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Interview" }} />
        <LoadingSpinner />
      </View>
    );
  }

  if (inviteQuery.isError || !inviteQuery.data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Interview" }} />
        <Text style={{ color: colors.mutedForeground }}>
          Couldn't load this interview invitation.
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={[styles.btnGhost, { borderColor: colors.border }]}
        >
          <Text style={{ color: colors.foreground }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const invite = inviteQuery.data;
  const isCandidate =
    user?.role === "candidate" && user.candidateId === invite.candidateId;
  const selectedSlot = invite.timeSlots.find(
    (s) => s.id === invite.selectedSlotId,
  );

  const onAccept = () => {
    if (!selectedSlotId) {
      Alert.alert("Pick a time", "Please select one of the proposed slots.");
      return;
    }
    acceptInvite.mutate(
      { id: invite.id, data: { slotId: selectedSlotId } },
      {
        onSuccess: () => {
          invalidateAll();
        },
        onError: () =>
          Alert.alert(
            "Couldn't accept",
            "Something went wrong. Please try again.",
          ),
      },
    );
  };

  const onDecline = () => {
    declineInvite.mutate(
      { id: invite.id, data: { reason: reason.trim() || undefined } },
      {
        onSuccess: () => {
          setDeclineMode(false);
          invalidateAll();
        },
        onError: () =>
          Alert.alert(
            "Couldn't decline",
            "Something went wrong. Please try again.",
          ),
      },
    );
  };

  const statusBg =
    invite.status === "accepted"
      ? "#dcfce7"
      : invite.status === "declined"
        ? "#fee2e2"
        : invite.status === "cancelled"
          ? colors.muted
          : "#fef3c7";
  const statusFg =
    invite.status === "accepted"
      ? "#166534"
      : invite.status === "declined"
        ? "#991b1b"
        : invite.status === "cancelled"
          ? colors.mutedForeground
          : "#92400e";

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: insets.bottom + 32 },
      ]}
    >
      <Stack.Screen options={{ title: "Interview" }} />

      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>
            INTERVIEW INVITATION
          </Text>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {invite.jobTitle}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {invite.employerName}
          </Text>
        </View>
        <View
          style={[
            styles.statusPill,
            { backgroundColor: statusBg, borderRadius: colors.radius },
          ]}
        >
          <Text style={[styles.statusText, { color: statusFg }]}>
            {invite.status}
          </Text>
        </View>
      </View>

      {/* Meta block */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
        {invite.location ? (
          <View style={styles.metaRow}>
            <Feather name="map-pin" size={16} color={colors.mutedForeground} />
            <Text style={[styles.metaText, { color: colors.foreground }]}>
              {invite.location}
            </Text>
          </View>
        ) : null}
        {isSafeWebUrl(invite.meetingLink) ? (
          <Pressable
            style={styles.metaRow}
            onPress={() => Linking.openURL(invite.meetingLink as string)}
          >
            <Feather name="link" size={16} color={colors.mutedForeground} />
            <Text style={[styles.metaText, { color: colors.primary, textDecorationLine: "underline" }]} numberOfLines={1}>
              {invite.meetingLink}
            </Text>
          </Pressable>
        ) : null}
        {invite.notes ? (
          <View style={styles.metaRow}>
            <Feather name="file-text" size={16} color={colors.mutedForeground} />
            <Text style={[styles.metaText, { color: colors.foreground, flex: 1 }]}>
              {invite.notes}
            </Text>
          </View>
        ) : null}
        {!invite.location && !invite.meetingLink && !invite.notes ? (
          <Text style={{ color: colors.mutedForeground }}>
            No additional details provided.
          </Text>
        ) : null}
      </View>

      {/* Result banners */}
      {invite.status === "accepted" && selectedSlot ? (
        <View style={[styles.banner, { backgroundColor: "#dcfce7", borderRadius: colors.radius }]}>
          <Feather name="check-circle" size={18} color="#166534" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: "#166534" }]}>
              You confirmed this interview
            </Text>
            <Text style={[styles.bannerBody, { color: "#166534" }]}>
              {formatSlot(selectedSlot.startsAt, selectedSlot.endsAt)}
            </Text>
          </View>
        </View>
      ) : null}

      {invite.status === "declined" ? (
        <View style={[styles.banner, { backgroundColor: "#fee2e2", borderRadius: colors.radius }]}>
          <Feather name="x-circle" size={18} color="#991b1b" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: "#991b1b" }]}>
              You declined this interview
            </Text>
            {invite.declineReason ? (
              <Text style={[styles.bannerBody, { color: "#991b1b", fontStyle: "italic" }]}>
                "{invite.declineReason}"
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {invite.status === "cancelled" ? (
        <View style={[styles.banner, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
          <Feather name="slash" size={18} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, flex: 1 }}>
            The employer cancelled this interview invitation.
          </Text>
        </View>
      ) : null}

      {/* Action area */}
      {invite.status === "proposed" && isCandidate ? (
        <>
          <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
            Pick a time that works
          </Text>
          <View style={{ gap: 8 }}>
            {invite.timeSlots.map((slot) => {
              const selected = slot.id === selectedSlotId;
              return (
                <Pressable
                  key={slot.id}
                  onPress={() => setSelectedSlotId(slot.id)}
                  style={[
                    styles.slot,
                    {
                      backgroundColor: selected ? colors.primary + "14" : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.radio,
                      {
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    {selected ? (
                      <View
                        style={[
                          styles.radioDot,
                          { backgroundColor: colors.primary },
                        ]}
                      />
                    ) : null}
                  </View>
                  <Text style={[styles.slotText, { color: colors.foreground }]}>
                    {formatSlot(slot.startsAt, slot.endsAt)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {declineMode ? (
            <View
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius, gap: 8 },
              ]}
            >
              <Text style={[styles.sectionLabel, { color: colors.foreground, marginTop: 0 }]}>
                Reason (optional)
              </Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                multiline
                placeholder="Shared with the employer"
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.textInput,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
              />
              <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
                <Pressable
                  onPress={() => {
                    setDeclineMode(false);
                    setReason("");
                  }}
                  style={[styles.btnGhost, { borderColor: colors.border }]}
                >
                  <Text style={{ color: colors.foreground }}>Back</Text>
                </Pressable>
                <Pressable
                  onPress={onDecline}
                  disabled={declineInvite.isPending}
                  style={[styles.btnDanger, { backgroundColor: colors.destructive, borderRadius: colors.radius }]}
                >
                  <Text style={{ color: colors.destructiveForeground, fontFamily: "Inter_600SemiBold" }}>
                    {declineInvite.isPending ? "Declining..." : "Confirm decline"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.actions}>
              <Pressable
                onPress={() => setDeclineMode(true)}
                style={[styles.btnGhost, { borderColor: colors.border, flex: 1 }]}
              >
                <Text style={{ color: colors.foreground, textAlign: "center" }}>
                  Decline
                </Text>
              </Pressable>
              <Pressable
                onPress={onAccept}
                disabled={!selectedSlotId || acceptInvite.isPending}
                style={[
                  styles.btnPrimary,
                  {
                    backgroundColor:
                      selectedSlotId && !acceptInvite.isPending
                        ? colors.primary
                        : colors.muted,
                    borderRadius: colors.radius,
                    flex: 1,
                  },
                ]}
              >
                <Text
                  style={{
                    color:
                      selectedSlotId && !acceptInvite.isPending
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                    fontFamily: "Inter_600SemiBold",
                    textAlign: "center",
                  }}
                >
                  {acceptInvite.isPending ? "Accepting..." : "Accept"}
                </Text>
              </Pressable>
            </View>
          )}
        </>
      ) : null}

      {invite.status === "proposed" && !isCandidate ? (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
          ]}
        >
          <Text style={[styles.sectionLabel, { color: colors.foreground, marginTop: 0 }]}>
            Awaiting candidate response
          </Text>
          {invite.timeSlots.map((s) => (
            <Text key={s.id} style={[styles.metaText, { color: colors.foreground }]}>
              · {formatSlot(s.startsAt, s.endsAt)}
            </Text>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 16,
    paddingTop: Platform.OS === "web" ? 80 : 16,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  eyebrow: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    letterSpacing: -0.3,
    marginTop: 4,
  },
  subtitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    marginTop: 2,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    textTransform: "capitalize",
  },
  card: {
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  metaText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  banner: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    padding: 12,
  },
  bannerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  bannerBody: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    marginTop: 2,
  },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    marginTop: 4,
  },
  slot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderWidth: 1,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  slotText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  textInput: {
    borderWidth: 1,
    padding: 10,
    minHeight: 70,
    textAlignVertical: "top",
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  btnGhost: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDanger: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
