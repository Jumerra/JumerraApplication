import { Feather } from "@expo/vector-icons";
import { useAiCvCritique } from "@workspace/api-client-react";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

const SEVERITY_META: Record<
  "info" | "suggestion" | "warning",
  { label: string; tone: "info" | "warn" | "danger" }
> = {
  info: { label: "Note", tone: "info" },
  suggestion: { label: "Suggest", tone: "warn" },
  warning: { label: "Fix", tone: "danger" },
};

export function CvCritiqueCard({ candidateId }: { candidateId: number }) {
  const colors = useColors();
  const mutation = useAiCvCritique();
  const [error, setError] = useState<string | null>(null);

  const onGenerate = (regenerate = false) => {
    setError(null);
    mutation.mutate(
      { id: candidateId, data: { regenerate } },
      {
        onError: (err: unknown) => {
          setError(
            err instanceof Error ? err.message : "Couldn't generate critique",
          );
        },
      },
    );
  };

  const data = mutation.data;

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
      <View style={styles.header}>
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor: colors.primary + "20",
              borderRadius: colors.radius,
            },
          ]}
        >
          <Feather name="zap" size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            AI critique
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Section-by-section feedback on your profile.
          </Text>
        </View>
        <Pressable
          onPress={() => onGenerate(Boolean(data))}
          disabled={mutation.isPending}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius,
              opacity: pressed || mutation.isPending ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>
            {mutation.isPending
              ? "Reviewing…"
              : data
                ? "Re-run"
                : "Get critique"}
          </Text>
        </Pressable>
      </View>

      {error ? (
        <Text
          style={{ color: colors.destructive, fontSize: 13, marginTop: 8 }}
        >
          {error}
        </Text>
      ) : null}

      {data ? (
        <View style={{ marginTop: 12, gap: 12 }}>
          <View
            style={{
              backgroundColor: colors.primary + "10",
              borderColor: colors.primary + "30",
              borderWidth: 1,
              borderRadius: colors.radius,
              padding: 10,
            }}
          >
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 13,
                lineHeight: 18,
              }}
            >
              {data.overall}
            </Text>
          </View>
          {data.sections.map((s) => (
            <View
              key={s.section}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: colors.radius,
                padding: 12,
                gap: 8,
              }}
            >
              <Text
                style={{
                  color: colors.foreground,
                  fontFamily: "Inter_700Bold",
                  fontSize: 13,
                }}
              >
                {s.section}
              </Text>
              {s.items.map((item, i) => {
                const meta = SEVERITY_META[item.severity] ?? SEVERITY_META.suggestion;
                const pillBg =
                  meta.tone === "danger"
                    ? "#fda4af30"
                    : meta.tone === "warn"
                      ? "#fcd34d30"
                      : "#93c5fd30";
                const pillColor =
                  meta.tone === "danger"
                    ? "#9f1239"
                    : meta.tone === "warn"
                      ? "#92400e"
                      : "#1e40af";
                return (
                  <View key={i} style={{ flexDirection: "row", gap: 8 }}>
                    <Text
                      style={{
                        backgroundColor: pillBg,
                        color: pillColor,
                        fontFamily: "Inter_700Bold",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 999,
                        overflow: "hidden",
                      }}
                    >
                      {meta.label}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color: colors.foreground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 12,
                          lineHeight: 17,
                        }}
                      >
                        {item.message}
                      </Text>
                      {item.suggestion ? (
                        <Text
                          style={{
                            color: colors.mutedForeground,
                            fontFamily: "Inter_400Regular",
                            fontSize: 12,
                            lineHeight: 17,
                            marginTop: 2,
                          }}
                        >
                          <Text style={{ fontFamily: "Inter_600SemiBold" }}>
                            Try:{" "}
                          </Text>
                          {item.suggestion}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
  cta: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ctaText: {
    fontFamily: "Inter_700Bold",
    fontSize: 12,
  },
});
