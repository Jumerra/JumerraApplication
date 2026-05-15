import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type Props = {
  tier?: string | null;
  size?: "sm" | "md";
};

/**
 * Compact pill rendered next to a job title to flag paid tier
 * placements. Returns null for the implicit `free` tier.
 */
export function TierBadge({ tier, size = "sm" }: Props) {
  const colors = useColors();
  if (tier !== "promoted" && tier !== "sponsored") return null;

  const isSponsored = tier === "sponsored";
  // Hand-tuned colors so the pill is legible in both light & dark
  // without depending on the dynamic palette (which doesn't define
  // accent variants).
  const bg = isSponsored ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.12)";
  const fg = isSponsored ? "#b45309" : colors.primary;
  const icon = isSponsored ? "star" : "trending-up";
  const label = isSponsored ? "Sponsored" : "Promoted";

  return (
    <View
      style={[
        styles.pill,
        size === "md" && styles.pillMd,
        { backgroundColor: bg, borderColor: fg + "40" },
      ]}
    >
      <Feather name={icon} size={size === "md" ? 12 : 10} color={fg} />
      <Text
        style={[
          styles.label,
          size === "md" && styles.labelMd,
          { color: fg },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillMd: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 4,
  },
  label: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
  },
  labelMd: {
    fontSize: 12,
  },
});
