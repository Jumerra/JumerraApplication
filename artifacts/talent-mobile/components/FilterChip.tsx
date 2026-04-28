import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { useColors } from "@/hooks/useColors";

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

export function FilterChip({ label, selected, onPress }: Props) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.secondary,
          borderRadius: colors.radius * 2,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      hitSlop={6}
    >
      <Text
        style={[
          styles.text,
          {
            color: selected ? colors.primaryForeground : colors.secondaryForeground,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  text: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
});
