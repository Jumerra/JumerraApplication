import {
  getGetApplicationTimelineQueryKey,
  useGetApplicationTimeline,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export function ApplicationTimeline({
  applicationId,
}: {
  applicationId: number;
}) {
  const colors = useColors();
  const { data } = useGetApplicationTimeline(applicationId, {
    query: {
      queryKey: getGetApplicationTimelineQueryKey(applicationId),
      enabled: applicationId > 0,
    },
  });

  if (!data) return null;

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius * 1.5,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Feather name="clock" size={16} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground }]}>
          Application milestones
        </Text>
      </View>
      <Text style={[styles.eta, { color: colors.mutedForeground }]}>
        {data.etaLabel}
      </Text>
      <View style={styles.list}>
        {data.milestones.map((m, idx) => {
          const isTerminal = m.key === "withdrawn";
          const iconName = isTerminal
            ? "x-circle"
            : m.isReached
              ? "check-circle"
              : "circle";
          const iconColor = isTerminal
            ? colors.destructive
            : m.isCurrent
              ? colors.primary
              : m.isReached
                ? colors.primary
                : colors.mutedForeground;
          return (
            <View key={`${m.key}-${idx}`} style={styles.row}>
              <View style={styles.iconCol}>
                <Feather
                  name={iconName as never}
                  size={18}
                  color={iconColor}
                />
                {idx < data.milestones.length - 1 ? (
                  <View
                    style={[
                      styles.connector,
                      { backgroundColor: colors.border },
                    ]}
                  />
                ) : null}
              </View>
              <View style={styles.content}>
                <View style={styles.titleRow}>
                  <Text
                    style={[
                      styles.label,
                      {
                        color: m.isReached || m.isCurrent
                          ? colors.foreground
                          : colors.mutedForeground,
                      },
                    ]}
                  >
                    {m.label}
                  </Text>
                  {m.reachedAt ? (
                    <Text
                      style={[styles.date, { color: colors.mutedForeground }]}
                    >
                      {new Date(m.reachedAt).toLocaleDateString()}
                    </Text>
                  ) : null}
                </View>
                {m.isCurrent && !isTerminal ? (
                  <Text style={[styles.subtle, { color: colors.primary }]}>
                    Current step
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: 16,
    borderWidth: 1,
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  eta: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  list: {
    gap: 0,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  iconCol: {
    alignItems: "center",
  },
  connector: {
    width: 2,
    flex: 1,
    marginTop: 2,
    marginBottom: 2,
  },
  content: {
    flex: 1,
    paddingBottom: 14,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  label: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    flex: 1,
  },
  date: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  subtle: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    marginTop: 2,
  },
});
