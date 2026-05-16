import {
  getGetCandidateScoreBreakdownQueryKey,
  useGetCandidateScoreBreakdown,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export function TalentScoreBreakdownCard({
  candidateId,
}: {
  candidateId: number;
}) {
  const colors = useColors();
  const { data } = useGetCandidateScoreBreakdown(candidateId, {
    query: {
      queryKey: getGetCandidateScoreBreakdownQueryKey(candidateId),
      enabled: candidateId > 0,
    },
  });

  if (!data) return null;

  // Spec: surface all 3 ranked next-action suggestions (mobile parity
  // with the web TalentScoreBreakdown panel). Server already caps the
  // list at 3, but slice defensively in case a stale client sees more.
  const topSuggestions = data.suggestions.slice(0, 3);

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
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            How your Talent Score is built
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Five inputs feed your score
          </Text>
        </View>
        <View
          style={[
            styles.scoreBubble,
            { backgroundColor: colors.primary, borderRadius: colors.radius * 2 },
          ]}
        >
          <Text style={[styles.scoreNum, { color: colors.primaryForeground }]}>
            {data.score}
          </Text>
        </View>
      </View>

      <View style={styles.bars}>
        {data.components.map((c) => (
          <View key={c.key} style={styles.barRow}>
            <View style={styles.barLabelRow}>
              <Text
                style={[styles.barLabel, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {c.label}
              </Text>
              <Text style={[styles.barValue, { color: colors.mutedForeground }]}>
                {c.contribution}/{c.weight}
              </Text>
            </View>
            <View
              style={[
                styles.barTrack,
                { backgroundColor: colors.secondary },
              ]}
            >
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${c.score}%`,
                    backgroundColor: colors.primary,
                  },
                ]}
              />
            </View>
          </View>
        ))}
      </View>

      {topSuggestions.length > 0 ? (
        <View style={styles.ctaList}>
          {topSuggestions.map((s) => (
            <Pressable
              key={`${s.title}-${s.link}`}
              onPress={() => router.push(s.link as never)}
              style={[
                styles.cta,
                {
                  backgroundColor: colors.primary + "12",
                  borderColor: colors.primary + "33",
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Feather name="zap" size={14} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.ctaTitle, { color: colors.foreground }]}>
                  {s.title}
                </Text>
                <Text
                  style={[styles.ctaSub, { color: colors.mutedForeground }]}
                  numberOfLines={2}
                >
                  {s.description}
                </Text>
              </View>
              <View
                style={[
                  styles.ctaBadge,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.ctaBadgeText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  +{s.impact}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 20,
    padding: 16,
    borderWidth: 1,
    gap: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  subtitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    marginTop: 2,
  },
  scoreBubble: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreNum: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
  },
  bars: {
    gap: 10,
  },
  barRow: {
    gap: 4,
  },
  barLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  barLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    flex: 1,
  },
  barValue: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
  },
  ctaList: {
    gap: 8,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderWidth: 1,
  },
  ctaTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  ctaSub: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    marginTop: 2,
  },
  ctaBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  ctaBadgeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
  },
});
