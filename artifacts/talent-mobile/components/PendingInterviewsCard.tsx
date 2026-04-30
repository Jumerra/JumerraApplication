import {
  getListInterviewInvitesForCandidateQueryKey,
  useListInterviewInvitesForCandidate,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

function formatSlotShort(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  return `${start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} · ${start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}–${end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/**
 * Surfaces pending + accepted interview invites at the top of the
 * applications tab. Hidden when there are none so it doesn't add an
 * empty card to the screen.
 */
export function PendingInterviewsCard({
  candidateId,
}: {
  candidateId: number;
}) {
  const colors = useColors();
  const { data } = useListInterviewInvitesForCandidate(
    candidateId,
    undefined,
    {
      query: {
        queryKey: getListInterviewInvitesForCandidateQueryKey(candidateId),
        enabled: candidateId > 0,
      },
    },
  );

  const invites = (data ?? []).filter(
    (i) => i.status === "proposed" || i.status === "accepted",
  );
  if (invites.length === 0) return null;

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.primary + "0d",
          borderColor: colors.primary + "40",
          borderRadius: colors.radius,
        },
      ]}
    >
      <View style={styles.header}>
        <Feather name="calendar" size={16} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground }]}>
          Interview invitations
        </Text>
      </View>
      {invites.map((invite) => {
        const selectedSlot =
          invite.status === "accepted"
            ? invite.timeSlots.find((s) => s.id === invite.selectedSlotId)
            : null;
        const isAccepted = invite.status === "accepted";
        const badgeBg = isAccepted ? "#dcfce7" : "#fef3c7";
        const badgeFg = isAccepted ? "#166534" : "#92400e";
        return (
          <Pressable
            key={invite.id}
            onPress={() => router.push(`/interview/${invite.id}` as never)}
            style={[
              styles.row,
              {
                backgroundColor: colors.background,
                borderRadius: colors.radius,
              },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <View style={styles.titleRow}>
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: badgeBg,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  <Text style={[styles.badgeText, { color: badgeFg }]}>
                    {isAccepted ? "Confirmed" : "New"}
                  </Text>
                </View>
                <Text
                  style={[styles.jobTitle, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {invite.jobTitle}
                </Text>
              </View>
              <Text
                style={[styles.subtitle, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {invite.employerName}
              </Text>
              <Text
                style={[styles.slot, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {isAccepted && selectedSlot
                  ? formatSlotShort(selectedSlot.startsAt, selectedSlot.endsAt)
                  : `${invite.timeSlots.length} time slot${
                      invite.timeSlots.length === 1 ? "" : "s"
                    } proposed — tap to confirm`}
              </Text>
            </View>
            <Feather
              name="chevron-right"
              size={18}
              color={colors.mutedForeground}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
  },
  jobTitle: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  subtitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  slot: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
});
