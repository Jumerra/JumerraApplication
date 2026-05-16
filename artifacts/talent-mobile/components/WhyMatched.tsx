import { Feather } from "@expo/vector-icons";
import type { MatchBreakdown } from "@workspace/api-client-react";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export function WhyMatched({ breakdown }: { breakdown: MatchBreakdown }) {
  const colors = useColors();
  const matched = breakdown.matchedSkills ?? [];
  const missing = (breakdown.missingSkills ?? []).slice(0, 6);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius * 1.5,
        },
      ]}
    >
      <Text style={[styles.summary, { color: colors.foreground }]}>
        {breakdown.summary}
      </Text>
      <Bar label="Skills coverage" weight="65%" value={breakdown.skillCoveragePct} />
      <Bar label="Experience" weight="15%" value={breakdown.experiencePct} />
      <Bar label="Talent score" weight="20%" value={breakdown.talentPct} />
      {matched.length > 0 ? (
        <ChipRow
          label="Skills you bring"
          items={matched}
          icon="check-circle"
          tone={colors.primary}
        />
      ) : null}
      {missing.length > 0 ? (
        <ChipRow
          label="Worth adding"
          items={missing}
          icon="alert-circle"
          tone={colors.destructive}
        />
      ) : null}
    </View>
  );
}

function Bar({
  label,
  weight,
  value,
}: {
  label: string;
  weight: string;
  value: number;
}) {
  const colors = useColors();
  const safe = Math.max(0, Math.min(100, value || 0));
  return (
    <View style={{ marginTop: 8 }}>
      <View style={styles.barHeader}>
        <Text style={[styles.barLabel, { color: colors.mutedForeground }]}>
          {label} <Text style={{ opacity: 0.7 }}>· {weight}</Text>
        </Text>
        <Text style={[styles.barValue, { color: colors.foreground }]}>
          {safe}%
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: colors.muted,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${safe}%`,
            height: "100%",
            backgroundColor: colors.primary,
          }}
        />
      </View>
    </View>
  );
}

function ChipRow({
  label,
  items,
  icon,
  tone,
}: {
  label: string;
  items: string[];
  icon: keyof typeof Feather.glyphMap;
  tone: string;
}) {
  const colors = useColors();
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={[styles.chipsTitle, { color: colors.mutedForeground }]}>
        {label.toUpperCase()}
      </Text>
      <View style={styles.chipsWrap}>
        {items.map((s) => (
          <View
            key={s}
            style={[
              styles.chip,
              { borderColor: tone + "55", backgroundColor: tone + "15" },
            ]}
          >
            <Feather name={icon} size={11} color={tone} />
            <Text style={[styles.chipText, { color: tone }]}>{s}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 14 },
  summary: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    lineHeight: 18,
  },
  barHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  barLabel: { fontFamily: "Inter_500Medium", fontSize: 11 },
  barValue: { fontFamily: "Inter_700Bold", fontSize: 11 },
  chipsTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
});
