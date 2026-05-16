import { Feather } from "@expo/vector-icons";
import type { MatchBreakdown } from "@workspace/api-client-react";
import { Image } from "expo-image";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { formatSalary } from "@/lib/format";

import { JobTypeBadge } from "./JobTypeBadge";
import { MatchScoreBadge } from "./MatchScoreBadge";
import { TierBadge } from "./TierBadge";
import { WhyMatched } from "./WhyMatched";

type Props = {
  title: string;
  employerName: string;
  employerLogoUrl?: string;
  location?: string;
  type: string;
  matchScore?: number;
  matchBreakdown?: MatchBreakdown;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string;
  tier?: string | null;
  fastTrack?: boolean | null;
  onPress: () => void;
};

export function JobCard({
  title,
  employerName,
  employerLogoUrl,
  location,
  type,
  matchScore,
  matchBreakdown,
  salaryMin,
  salaryMax,
  currency,
  tier,
  fastTrack,
  onPress,
}: Props) {
  const colors = useColors();
  const salary = formatSalary(salaryMin, salaryMax, currency);
  const [whyOpen, setWhyOpen] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius * 1.5,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View
          style={[
            styles.logoWrap,
            { backgroundColor: colors.secondary, borderRadius: colors.radius },
          ]}
        >
          {employerLogoUrl ? (
            <Image
              source={{ uri: employerLogoUrl }}
              style={styles.logo}
              contentFit="cover"
              transition={150}
            />
          ) : (
            <Feather name="briefcase" size={20} color={colors.mutedForeground} />
          )}
        </View>
        {typeof matchScore === "number" ? (
          <MatchScoreBadge score={matchScore} size={44} />
        ) : null}
      </View>

      <Text
        style={[styles.title, { color: colors.foreground }]}
        numberOfLines={2}
      >
        {title}
      </Text>
      {(tier && tier !== "free") || fastTrack ? (
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {tier && tier !== "free" ? <TierBadge tier={tier} /> : null}
          {fastTrack ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 999,
                backgroundColor: "#fef3c7",
                borderWidth: 1,
                borderColor: "#fcd34d",
              }}
            >
              <Feather name="zap" size={10} color="#92400e" />
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 10,
                  color: "#92400e",
                }}
              >
                48hr Fast-Track
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <Text
        style={[styles.employer, { color: colors.mutedForeground }]}
        numberOfLines={1}
      >
        {employerName}
      </Text>

      <View style={styles.metaRow}>
        <JobTypeBadge type={type} />
        {location ? (
          <View style={styles.locRow}>
            <Feather name="map-pin" size={12} color={colors.mutedForeground} />
            <Text
              style={[styles.locText, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {location}
            </Text>
          </View>
        ) : null}
      </View>

      {salary ? (
        <View style={styles.salaryRow}>
          <Feather name="dollar-sign" size={12} color={colors.primary} />
          <Text style={[styles.salaryText, { color: colors.primary }]}>{salary}</Text>
        </View>
      ) : null}

      {matchBreakdown ? (
        <View style={{ marginTop: 4 }}>
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              setWhyOpen((v) => !v);
            }}
            hitSlop={6}
            style={({ pressed }) => [
              styles.whyToggle,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Feather
              name={whyOpen ? "chevron-up" : "chevron-down"}
              size={12}
              color={colors.primary}
            />
            <Text style={[styles.whyToggleText, { color: colors.primary }]}>
              {whyOpen ? "Hide" : "Why we matched you"}
            </Text>
          </Pressable>
          {whyOpen ? (
            <View style={{ marginTop: 8 }}>
              <WhyMatched breakdown={matchBreakdown} />
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 280,
    padding: 16,
    borderWidth: 1,
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logoWrap: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: {
    width: "100%",
    height: "100%",
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    marginTop: 4,
  },
  employer: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  locRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
  },
  locText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    flexShrink: 1,
  },
  salaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  salaryText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  whyToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  whyToggleText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
});
