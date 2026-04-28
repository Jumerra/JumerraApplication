import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type Props = {
  label: string;
  tone?: "default" | "primary";
};

export function SkillChip({ label, tone = "default" }: Props) {
  const colors = useColors();
  const isPrimary = tone === "primary";
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: isPrimary ? colors.primary : colors.secondary,
          borderRadius: colors.radius,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            color: isPrimary ? colors.primaryForeground : colors.secondaryForeground,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  text: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
});
