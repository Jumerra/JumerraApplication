import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { formatSalary } from "@/lib/format";

import { JobTypeBadge } from "./JobTypeBadge";
import { MatchScoreBadge } from "./MatchScoreBadge";

type Props = {
  title: string;
  employerName: string;
  employerLogoUrl?: string;
  location?: string;
  type: string;
  matchScore?: number;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string;
  onPress: () => void;
};

export function JobRow({
  title,
  employerName,
  employerLogoUrl,
  location,
  type,
  matchScore,
  salaryMin,
  salaryMax,
  currency,
  onPress,
}: Props) {
  const colors = useColors();
  const salary = formatSalary(salaryMin, salaryMax, currency);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius * 1.5,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
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
          <Feather name="briefcase" size={22} color={colors.mutedForeground} />
        )}
      </View>

      <View style={styles.body}>
        <Text
          style={[styles.title, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {title}
        </Text>
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
              <Feather name="map-pin" size={11} color={colors.mutedForeground} />
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
          <Text style={[styles.salary, { color: colors.primary }]} numberOfLines={1}>
            {salary}
          </Text>
        ) : null}
      </View>

      {typeof matchScore === "number" ? (
        <MatchScoreBadge score={matchScore} size={42} />
      ) : (
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: 1,
  },
  logoWrap: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: {
    width: "100%",
    height: "100%",
  },
  body: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  employer: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
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
    fontSize: 11,
    flexShrink: 1,
  },
  salary: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    marginTop: 2,
  },
});
