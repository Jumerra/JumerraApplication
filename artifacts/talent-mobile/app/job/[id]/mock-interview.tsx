/**
 * Mobile AI mock interview chat. Mirrors the web flow: start
 * (idempotent) → answer each question → finalise. Uses the same
 * generated React-Query hooks as the web app so the cookie-jar /
 * customFetch wiring works unchanged.
 */
import { Feather } from "@expo/vector-icons";
import {
  useStartMockInterview,
  useAnswerMockInterview,
  useFinaliseMockInterview,
  useGetJob,
  type MockInterview,
} from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function MockInterviewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const jobId = Number(params.id);
  const { data: job } = useGetJob(jobId);
  const [interview, setInterview] = useState<MockInterview | null>(null);
  const [draft, setDraft] = useState("");
  const startMutation = useStartMockInterview();
  const answerMutation = useAnswerMockInterview();
  const finaliseMutation = useFinaliseMockInterview();
  const startedRef = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    if (!startedRef.current && Number.isFinite(jobId) && jobId > 0) {
      startedRef.current = true;
      startMutation.mutate(
        { data: { jobId } },
        { onSuccess: (data) => setInterview(data) },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const questions = interview?.questions ?? [];
  const transcript = interview?.transcript ?? [];
  const answeredCount = transcript.length;
  const totalCount = questions.length;
  const currentQuestion = questions[answeredCount];
  const isFinalised = interview?.status === "finalised";
  const isLastAnswered = totalCount > 0 && answeredCount >= totalCount;

  const submitAnswer = () => {
    if (!interview || !currentQuestion) return;
    const text = draft.trim();
    if (text.length < 5) return;
    answerMutation.mutate(
      {
        id: interview.id,
        data: { questionIndex: answeredCount, answer: text },
      },
      {
        onSuccess: (resp) => {
          setInterview(resp.interview);
          setDraft("");
          requestAnimationFrame(() =>
            scrollRef.current?.scrollToEnd({ animated: true }),
          );
        },
      },
    );
  };

  const finalise = () => {
    if (!interview) return;
    finaliseMutation.mutate(
      { id: interview.id },
      { onSuccess: (data) => setInterview(data) },
    );
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 12,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.headerSubtitle, { color: colors.mutedForeground }]}
          >
            AI Mock Interview
          </Text>
          <Text
            style={[styles.headerTitle, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {job?.title ?? "Loading…"}
          </Text>
        </View>
      </View>

      {totalCount > 0 ? (
        <View
          style={[
            styles.progressTrack,
            { backgroundColor: colors.secondary },
          ]}
        >
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: colors.primary,
                width: `${(answeredCount / totalCount) * 100}%`,
              },
            ]}
          />
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 220,
          gap: 16,
        }}
      >
        {startMutation.isPending && !interview ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>
              Generating questions…
            </Text>
          </View>
        ) : null}

        {questions.map((q, idx) => {
          if (idx > answeredCount) return null;
          const answered = transcript[idx];
          return (
            <View key={q.id} style={{ gap: 10 }}>
              <View style={styles.bubbleRow}>
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: colors.primary + "20" },
                  ]}
                >
                  <Feather name="cpu" size={16} color={colors.primary} />
                </View>
                <View
                  style={[
                    styles.bubble,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[styles.focusTag, { color: colors.primary }]}
                  >
                    {q.focus.toUpperCase()}
                  </Text>
                  <Text style={[styles.bubbleText, { color: colors.foreground }]}>
                    {q.text}
                  </Text>
                </View>
              </View>
              {answered ? (
                <>
                  <View
                    style={[styles.bubbleRow, { justifyContent: "flex-end" }]}
                  >
                    <View
                      style={[
                        styles.bubble,
                        {
                          backgroundColor: colors.primary,
                          borderColor: colors.primary,
                          maxWidth: "80%",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.bubbleText,
                          { color: colors.primaryForeground },
                        ]}
                      >
                        {answered.answer}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.scoreRow}>
                    <ScorePill
                      label="Tech"
                      value={answered.scores.technical}
                    />
                    <ScorePill
                      label="Comm"
                      value={answered.scores.communication}
                    />
                    <ScorePill
                      label="Culture"
                      value={answered.scores.culture}
                    />
                  </View>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 12,
                      fontStyle: "italic",
                      paddingHorizontal: 4,
                    }}
                  >
                    {answered.feedback}
                  </Text>
                </>
              ) : null}
            </View>
          );
        })}

        {isFinalised && interview ? (
          <View
            style={[
              styles.scoreCard,
              {
                backgroundColor: colors.primary + "10",
                borderColor: colors.primary + "40",
              },
            ]}
          >
            <Text style={[styles.scoreCardTitle, { color: colors.foreground }]}>
              Your score
            </Text>
            <Text style={[styles.scoreOverall, { color: colors.primary }]}>
              {interview.scoreOverall ?? 0}
              <Text style={{ fontSize: 18, color: colors.mutedForeground }}>
                /100
              </Text>
            </Text>
            <View style={styles.scoreRow}>
              <ScoreTile
                label="Technical"
                value={interview.scoreTechnical}
              />
              <ScoreTile
                label="Communication"
                value={interview.scoreCommunication}
              />
              <ScoreTile label="Culture" value={interview.scoreCulture} />
            </View>
            {interview.summary ? (
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 13,
                  lineHeight: 19,
                  marginTop: 4,
                }}
              >
                {interview.summary}
              </Text>
            ) : null}
            <Pressable
              onPress={() => router.replace(`/job/${jobId}/apply` as never)}
              style={[
                styles.primaryButton,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius * 1.5,
                },
              ]}
            >
              <Text
                style={{
                  color: colors.primaryForeground,
                  fontFamily: "Inter_700Bold",
                }}
              >
                Apply with this score
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {!isFinalised && (currentQuestion || isLastAnswered) ? (
        <View
          style={[
            styles.composer,
            {
              borderTopColor: colors.border,
              backgroundColor: colors.background,
              paddingBottom: insets.bottom + 12,
            },
          ]}
        >
          {isLastAnswered ? (
            <Pressable
              onPress={finalise}
              disabled={finaliseMutation.isPending}
              style={[
                styles.primaryButton,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius * 1.5,
                  opacity: finaliseMutation.isPending ? 0.6 : 1,
                },
              ]}
            >
              <Text
                style={{
                  color: colors.primaryForeground,
                  fontFamily: "Inter_700Bold",
                }}
              >
                {finaliseMutation.isPending ? "Scoring…" : "Finish interview"}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.composerRow}>
              <TextInput
                placeholder="Type your answer…"
                placeholderTextColor={colors.mutedForeground}
                value={draft}
                onChangeText={setDraft}
                multiline
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    backgroundColor: colors.card,
                  },
                ]}
              />
              <Pressable
                onPress={submitAnswer}
                disabled={
                  draft.trim().length < 5 || answerMutation.isPending
                }
                style={({ pressed }) => [
                  styles.sendButton,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: colors.radius,
                    opacity:
                      draft.trim().length < 5 || answerMutation.isPending
                        ? 0.4
                        : pressed
                          ? 0.8
                          : 1,
                  },
                ]}
              >
                {answerMutation.isPending ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Feather
                    name="send"
                    size={18}
                    color={colors.primaryForeground}
                  />
                )}
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

function ScorePill({ label, value }: { label: string; value: number }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.scorePill,
        { backgroundColor: colors.secondary, borderRadius: colors.radius },
      ]}
    >
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 11,
          fontFamily: "Inter_500Medium",
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: colors.foreground,
          fontSize: 13,
          fontFamily: "Inter_700Bold",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function ScoreTile({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.scoreTile,
        {
          backgroundColor: colors.background,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
        {label}
      </Text>
      <Text
        style={{
          color: colors.foreground,
          fontSize: 18,
          fontFamily: "Inter_700Bold",
        }}
      >
        {value ?? "—"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backButton: { padding: 4 },
  headerSubtitle: { fontSize: 11, fontFamily: "Inter_500Medium" },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  progressTrack: { height: 3, width: "100%" },
  progressFill: { height: "100%" },
  centered: { padding: 32, alignItems: "center" },
  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  bubble: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderRadius: 14,
    gap: 4,
  },
  focusTag: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  bubbleText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  scoreRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 4,
  },
  scorePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  scoreTile: {
    flex: 1,
    alignItems: "center",
    padding: 12,
    borderWidth: 1,
    gap: 4,
  },
  scoreCard: {
    padding: 16,
    borderWidth: 1,
    borderRadius: 16,
    gap: 12,
  },
  scoreCardTitle: { fontSize: 14, fontFamily: "Inter_500Medium" },
  scoreOverall: { fontSize: 44, fontFamily: "Inter_700Bold" },
  composer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 140,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    borderWidth: 1,
  },
  sendButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
