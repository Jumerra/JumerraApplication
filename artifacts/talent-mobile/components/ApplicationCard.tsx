import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { relativeTime } from "@/lib/format";

import { MatchScoreBadge } from "./MatchScoreBadge";
import { StatusPill } from "./StatusPill";

type Props = {
  jobTitle: string;
  employerName: string;
  employerLogoUrl?: string;
  status: string;
  matchScore: number;
  appliedAt: string;
  onPress: () => void;
};

export function ApplicationCard({
  jobTitle,
  employerName,
  employerLogoUrl,
  status,
  matchScore,
  appliedAt,
  onPress,
}: Props) {
  const colors = useColors();

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
      <View style={styles.topRow}>
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
        <View style={styles.titleCol}>
          <Text
            style={[styles.title, { color: colors.foreground }]}
            numberOfLines={2}
          >
            {jobTitle}
          </Text>
          <Text
            style={[styles.employer, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {employerName}
          </Text>
        </View>
        <MatchScoreBadge score={matchScore} size={42} />
      </View>

      <View style={styles.bottomRow}>
        <StatusPill status={status} />
        <View style={styles.timeRow}>
          <Feather name="clock" size={12} color={colors.mutedForeground} />
          <Text style={[styles.time, { color: colors.mutedForeground }]}>
            {relativeTime(appliedAt)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderWidth: 1,
    gap: 12,
  },
  topRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
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
  titleCol: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  employer: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  time: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
});
