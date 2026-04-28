import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type Props = {
  score: number;
  size?: number;
};

export function MatchScoreBadge({ score, size = 44 }: Props) {
  const colors = useColors();
  const value = Math.max(0, Math.min(100, Math.round(score)));

  let bg = colors.muted;
  let fg = colors.mutedForeground;
  if (value >= 75) {
    bg = colors.primary;
    fg = colors.primaryForeground;
  } else if (value >= 50) {
    bg = "#f59e0b";
    fg = "#ffffff";
  }

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: bg,
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: fg, fontSize: size * 0.32 },
        ]}
      >
        {value}
      </Text>
      <Text style={[styles.percent, { color: fg, fontSize: size * 0.18 }]}>%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  text: {
    fontFamily: "Inter_700Bold",
    lineHeight: undefined,
  },
  percent: {
    fontFamily: "Inter_600SemiBold",
    marginLeft: 1,
    marginTop: 2,
  },
});
