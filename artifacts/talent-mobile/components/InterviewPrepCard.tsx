import { Feather } from "@expo/vector-icons";
import { useAiInterviewPrep } from "@workspace/api-client-react";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export function InterviewPrepCard({
  candidateId,
  jobId,
}: {
  candidateId: number;
  jobId: number;
}) {
  const colors = useColors();
  const mutation = useAiInterviewPrep();
  const [error, setError] = useState<string | null>(null);

  const onGenerate = () => {
    setError(null);
    mutation.mutate(
      { id: candidateId, data: { jobId } },
      {
        onError: (err: unknown) => {
          setError(
            err instanceof Error ? err.message : "Couldn't generate prep",
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
            Prep for this interview
          </Text>
          <Text
            style={[styles.subtitle, { color: colors.mutedForeground }]}
          >
            5 likely questions with a STAR scaffold for your answers.
          </Text>
        </View>
        {!data ? (
          <Pressable
            onPress={onGenerate}
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
            <Text
              style={[
                styles.ctaText,
                { color: colors.primaryForeground },
              ]}
            >
              {mutation.isPending ? "Thinking…" : "Generate"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text style={{ color: colors.destructive, fontSize: 13, marginTop: 8 }}>
          {error}
        </Text>
      ) : null}

      {data ? (
        <View style={{ marginTop: 12, gap: 10 }}>
          {data.questions.map((q, idx) => (
            <PrepRow
              key={idx}
              index={idx}
              question={q.question}
              scaffold={q.scaffold}
            />
          ))}
          <Pressable
            onPress={onGenerate}
            disabled={mutation.isPending}
            style={({ pressed }) => [
              {
                alignSelf: "flex-end",
                paddingVertical: 6,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
                fontFamily: "Inter_600SemiBold",
              }}
            >
              Regenerate
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function PrepRow({
  index,
  question,
  scaffold,
}: {
  index: number;
  question: string;
  scaffold: { situation: string; task: string; action: string; result: string };
}) {
  const colors = useColors();
  const [open, setOpen] = useState(index === 0);
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: colors.radius,
        overflow: "hidden",
      }}
    >
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [
          {
            paddingHorizontal: 12,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 8,
            backgroundColor: pressed ? colors.muted : "transparent",
          },
        ]}
      >
        <Text
          style={{
            color: colors.primary,
            fontFamily: "Inter_700Bold",
            fontSize: 11,
            paddingTop: 1,
          }}
        >
          {String(index + 1).padStart(2, "0")}
        </Text>
        <Text
          style={{
            flex: 1,
            color: colors.foreground,
            fontFamily: "Inter_600SemiBold",
            fontSize: 13,
            lineHeight: 18,
          }}
        >
          {question}
        </Text>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={14}
          color={colors.mutedForeground}
        />
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 6 }}>
          <ScaffoldLine label="Situation" text={scaffold.situation} />
          <ScaffoldLine label="Task" text={scaffold.task} />
          <ScaffoldLine label="Action" text={scaffold.action} />
          <ScaffoldLine label="Result" text={scaffold.result} />
        </View>
      ) : null}
    </View>
  );
}

function ScaffoldLine({ label, text }: { label: string; text: string }) {
  const colors = useColors();
  if (!text) return null;
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Text
        style={{
          width: 70,
          color: colors.mutedForeground,
          fontFamily: "Inter_700Bold",
          fontSize: 10,
          letterSpacing: 0.5,
          paddingTop: 2,
        }}
      >
        {label.toUpperCase()}
      </Text>
      <Text
        style={{
          flex: 1,
          color: colors.foreground,
          fontFamily: "Inter_400Regular",
          fontSize: 12,
          lineHeight: 17,
        }}
      >
        {text}
      </Text>
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
