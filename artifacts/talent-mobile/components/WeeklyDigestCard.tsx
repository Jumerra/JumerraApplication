import {
  getGetCandidateWeeklyDigestQueryKey,
  useGetCandidateWeeklyDigest,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export function WeeklyDigestCard({ candidateId }: { candidateId: number }) {
  const colors = useColors();
  const { data } = useGetCandidateWeeklyDigest(candidateId, {
    query: {
      queryKey: getGetCandidateWeeklyDigestQueryKey(candidateId),
      enabled: candidateId > 0,
    },
  });

  const digest = data?.digest ?? null;

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius * 1.5,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Feather name="calendar" size={16} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground }]}>
          Your week on Jumerra
        </Text>
      </View>

      {!digest ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          We send a fresh digest every Monday. Your first one is on the way.
        </Text>
      ) : (
        <>
          <Text style={[styles.weekLabel, { color: colors.mutedForeground }]}>
            Week of{" "}
            {new Date(digest.weekStart).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
            })}
          </Text>
          <View style={styles.statsRow}>
            <Stat label="Views" value={digest.profileViews} />
            <Stat label="Applied" value={digest.applicationsSent} />
            <Stat label="Interviews" value={digest.interviewsScheduled} />
          </View>
          {digest.newMatches.slice(0, 3).map((m) => (
            <Pressable
              key={m.jobId}
              onPress={() => router.push(`/job/${m.jobId}` as never)}
              style={[
                styles.matchRow,
                {
                  backgroundColor: colors.secondary,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.matchTitle, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {m.title}
                </Text>
                <Text
                  style={[styles.matchSub, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {m.employerName}
                </Text>
              </View>
              <Text style={[styles.matchScore, { color: colors.primary }]}>
                {m.matchScore}%
              </Text>
            </Pressable>
          ))}
        </>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const colors = useColors();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 20,
    padding: 16,
    borderWidth: 1,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  weekLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    marginTop: -4,
  },
  empty: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
  },
  stat: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
  },
  statLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    marginTop: 2,
  },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
  },
  matchTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  matchSub: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    marginTop: 2,
  },
  matchScore: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
  },
});
