import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { formatJobType } from "@/lib/format";

type Props = {
  type: string;
  tone?: "default" | "primary";
};

export function JobTypeBadge({ type, tone = "default" }: Props) {
  const colors = useColors();
  const isPrimary = tone === "primary";
  const bg = isPrimary ? colors.primary : colors.secondary;
  const fg = isPrimary ? colors.primaryForeground : colors.secondaryForeground;
  return (
    <View style={[styles.pill, { backgroundColor: bg, borderRadius: colors.radius }]}>
      <Text style={[styles.text, { color: fg }]}>{formatJobType(type)}</Text>
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
