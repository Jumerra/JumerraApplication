import {
  customFetch,
  getGetCandidateWeeklyDigestQueryKey,
  useGetCandidateWeeklyDigest,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
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
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());

  const visibleMatches = useMemo(() => {
    if (!digest) return [];
    return digest.newMatches
      .filter((m) => !dismissedIds.has(m.jobId))
      .slice(0, 5);
  }, [digest, dismissedIds]);

  const handleDismiss = (jobId: number) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(jobId);
      return next;
    });
    customFetch("/api/me/feed/dismiss", {
      method: "POST",
      body: JSON.stringify({ jobId }),
    }).catch(() => {
      // best-effort: keep it hidden locally even if persistence fails
    });
  };

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

          {visibleMatches.length > 0 ? (
            <View style={styles.matchesGroup}>
              <View style={styles.sectionLabelRow}>
                <Feather name="target" size={12} color={colors.mutedForeground} />
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Top picks this week
                </Text>
              </View>
              {visibleMatches.map((m) => (
                <View
                  key={m.jobId}
                  style={[
                    styles.matchRow,
                    {
                      backgroundColor: colors.secondary,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  <Pressable
                    onPress={() => router.push(`/job/${m.jobId}` as never)}
                    style={styles.matchMain}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.matchTitle,
                          { color: colors.foreground },
                        ]}
                        numberOfLines={1}
                      >
                        {m.title}
                      </Text>
                      <Text
                        style={[
                          styles.matchSub,
                          { color: colors.mutedForeground },
                        ]}
                        numberOfLines={1}
                      >
                        {m.employerName}
                      </Text>
                    </View>
                    <Text style={[styles.matchScore, { color: colors.primary }]}>
                      {m.matchScore}%
                    </Text>
                  </Pressable>
                  <View style={styles.actionsRow}>
                    <Pressable
                      onPress={() =>
                        router.push(`/job/${m.jobId}/apply` as never)
                      }
                      style={[
                        styles.actionBtn,
                        styles.applyBtn,
                        { backgroundColor: colors.primary },
                      ]}
                      accessibilityLabel={`Apply to ${m.title}`}
                    >
                      <Feather
                        name="send"
                        size={12}
                        color={colors.primaryForeground}
                      />
                      <Text
                        style={[
                          styles.actionLabel,
                          { color: colors.primaryForeground },
                        ]}
                      >
                        Apply
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleDismiss(m.jobId)}
                      style={[
                        styles.actionBtn,
                        styles.dismissBtn,
                        { borderColor: colors.border },
                      ]}
                      accessibilityLabel={`Dismiss ${m.title}`}
                    >
                      <Feather name="x" size={12} color={colors.mutedForeground} />
                      <Text
                        style={[
                          styles.actionLabel,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        Dismiss
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : digest.newMatches.length > 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              You've cleared this week's picks. New ones land next Monday.
            </Text>
          ) : null}
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
  matchesGroup: {
    gap: 8,
  },
  sectionLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  matchRow: {
    padding: 10,
    gap: 8,
  },
  matchMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
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
  actionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  applyBtn: {},
  dismissBtn: {
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  actionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
  },
});
