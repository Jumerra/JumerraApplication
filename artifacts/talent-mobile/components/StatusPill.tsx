import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { formatStatus } from "@/lib/format";

type Props = {
  status: string;
};

export function StatusPill({ status }: Props) {
  const colors = useColors();

  let bg = colors.muted;
  let fg = colors.mutedForeground;

  switch (status) {
    case "applied":
      bg = "#dbeafe";
      fg = "#1d4ed8";
      break;
    case "screening":
      bg = "#ffedd5";
      fg = "#c2410c";
      break;
    case "interview":
      bg = "#ede9fe";
      fg = "#6d28d9";
      break;
    case "offer":
      bg = "#ccfbf1";
      fg = "#0f766e";
      break;
    case "hired":
      bg = colors.primary;
      fg = colors.primaryForeground;
      break;
    case "rejected":
      bg = colors.destructive;
      fg = colors.destructiveForeground;
      break;
    case "withdrawn":
    default:
      bg = colors.muted;
      fg = colors.mutedForeground;
      break;
  }

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: bg,
          borderRadius: colors.radius,
        },
      ]}
    >
      <Text style={[styles.text, { color: fg }]}>{formatStatus(status)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  text: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
});
