import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { customFetch } from "@workspace/api-client-react";

import { SkillChip } from "@/components/SkillChip";
import { useColors } from "@/hooks/useColors";

type MockInterviewSummary = {
  id: number;
  status: "in_progress" | "finalised" | "abandoned";
  scoreOverall: number | null;
};

type MockInterviewListResponse = {
  items: MockInterviewSummary[];
};

type ApplySnapshot = {
  candidate: {
    id: number;
    fullName: string;
    headline: string;
    avatarUrl: string;
    skills: string[];
  };
  cv: {
    hasGeneratedCv: boolean;
    aiCvUnlocked: boolean;
    preview: string | null;
  };
};

type Props = {
  visible: boolean;
  jobId: number | null;
  jobTitle?: string;
  employerName?: string;
  onClose: () => void;
  /** Called after the application is successfully submitted. */
  onSubmitted?: () => void;
  /**
   * Where this submission originated. The For You swipe stack passes
   * `"for_you"` so employers can prioritize replies; regular
   * job-detail apply CTAs leave this as the default `"browse"`.
   */
  applicationSource?: "browse" | "for_you";
};

/**
 * One-tap apply confirmation sheet. Shows a snapshot of the saved
 * profile + CV that's about to be sent to the employer, then submits
 * via `POST /api/applications`. Reused by the For You swipe-right
 * action and any other "apply now" CTA.
 */
export function ApplyConfirmSheet({
  visible,
  jobId,
  jobTitle,
  employerName,
  onClose,
  onSubmitted,
  applicationSource = "browse",
}: Props) {
  const colors = useColors();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<ApplySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Latest mock interview the candidate has done for THIS job (if any).
  // Drives the "Boost your application" CTA inside the sheet so the
  // For You / job-detail apply flow can detour into the chat-based
  // interview before the application is sent.
  const [mockInterview, setMockInterview] = useState<MockInterviewSummary | null>(
    null,
  );

  useEffect(() => {
    if (!visible || jobId == null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      customFetch<ApplySnapshot>("/api/me/apply-snapshot"),
      customFetch<MockInterviewListResponse>(
        `/api/me/mock-interviews?jobId=${jobId}`,
      ).catch(() => ({ items: [] }) as MockInterviewListResponse),
    ])
      .then(([snap, mockResp]) => {
        if (cancelled) return;
        setSnapshot(snap);
        // The list endpoint returns `{ items: MockInterview[] }` —
        // ordered newest-first server-side. Prefer latest finalised;
        // fall back to in-progress so the CTA can say "Resume"
        // instead of "Take" when applicable.
        const items = mockResp?.items ?? [];
        const finalised = items.find((m) => m.status === "finalised");
        const inProgress = items.find((m) => m.status === "in_progress");
        setMockInterview(finalised ?? inProgress ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your profile snapshot.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, jobId]);

  const handleSubmit = async () => {
    if (jobId == null || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await customFetch("/api/applications", {
        method: "POST",
        body: JSON.stringify({
          jobId,
          // Server derives candidateId from the session for non-admins;
          // include a placeholder to satisfy the existing API shape.
          candidateId: snapshot?.candidate.id ?? 0,
          coverNote: "I'm interested in this role and would love to chat.",
          // Tags the application's origin so employers can prioritize
          // high-intent "for_you" swipe submissions over regular
          // browse applies.
          source: applicationSource,
        }),
      });
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
      }
      // Hand off to the parent. The parent is responsible for closing
      // the sheet and any post-submit navigation. We must NOT also call
      // `onClose()` here — when the parent navigates away on success
      // (e.g. router.replace), a second `onClose()` that does
      // router.back() races against it and lands the user on the wrong
      // screen.
      if (onSubmitted) {
        onSubmitted();
      } else {
        onClose();
      }
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? (err as { status: number }).status
          : 0;
      if (status === 409) {
        setError("You've already applied to this job.");
      } else {
        setError("Couldn't submit your application. Try again.");
      }
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        ).catch(() => {});
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <View style={styles.handle}>
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.border,
              }}
            />
          </View>

          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Apply with one tap
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityLabel="Close"
            >
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {jobTitle ? (
            <Text style={[styles.jobTitle, { color: colors.foreground }]}>
              {jobTitle}
              {employerName ? (
                <Text style={{ color: colors.mutedForeground }}>
                  {"  ·  "}
                  {employerName}
                </Text>
              ) : null}
            </Text>
          ) : null}

          <ScrollView
            style={styles.body}
            contentContainerStyle={{ paddingBottom: 16 }}
          >
            {loading ? (
              <View style={{ paddingVertical: 24, alignItems: "center" }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : snapshot ? (
              <>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                  We'll send the employer
                </Text>

                <View
                  style={[
                    styles.card,
                    { backgroundColor: colors.muted, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.cardName, { color: colors.foreground }]}>
                    {snapshot.candidate.fullName || "Your name"}
                  </Text>
                  {snapshot.candidate.headline ? (
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        marginTop: 2,
                        fontFamily: "Inter_400Regular",
                      }}
                    >
                      {snapshot.candidate.headline}
                    </Text>
                  ) : null}

                  {snapshot.candidate.skills.length > 0 ? (
                    <View style={styles.chipRow}>
                      {snapshot.candidate.skills.slice(0, 6).map((s) => (
                        <SkillChip key={s} label={s} />
                      ))}
                    </View>
                  ) : null}
                </View>

                {jobId != null ? (
                  <Pressable
                    onPress={() => {
                      onClose();
                      router.push(`/job/${jobId}/mock-interview`);
                    }}
                    style={[
                      styles.card,
                      {
                        backgroundColor: colors.muted,
                        borderColor: colors.border,
                        marginTop: 10,
                      },
                    ]}
                  >
                    <View
                      style={{ flexDirection: "row", alignItems: "center" }}
                    >
                      <Feather
                        name="zap"
                        size={16}
                        color={colors.primary}
                      />
                      <Text
                        style={{
                          marginLeft: 8,
                          color: colors.foreground,
                          fontFamily: "Inter_600SemiBold",
                          flex: 1,
                        }}
                      >
                        {mockInterview?.status === "finalised" &&
                        mockInterview.scoreOverall != null
                          ? `AI mock interview · ${mockInterview.scoreOverall}/100`
                          : mockInterview?.status === "in_progress"
                            ? "Resume your AI mock interview"
                            : "Boost with a 6-question AI mock interview"}
                      </Text>
                      <Feather
                        name="chevron-right"
                        size={18}
                        color={colors.mutedForeground}
                      />
                    </View>
                    <Text
                      style={{
                        marginTop: 6,
                        color: colors.mutedForeground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 13,
                        lineHeight: 18,
                      }}
                    >
                      {mockInterview?.status === "finalised"
                        ? "Your score is shown to the employer with your application."
                        : "Show employers what you can actually do — your score is attached to your application."}
                    </Text>
                  </Pressable>
                ) : null}

                <View
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.muted,
                      borderColor: colors.border,
                      marginTop: 10,
                    },
                  ]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Feather
                      name="file-text"
                      size={16}
                      color={colors.mutedForeground}
                    />
                    <Text
                      style={{
                        marginLeft: 8,
                        color: colors.foreground,
                        fontFamily: "Inter_600SemiBold",
                      }}
                    >
                      {snapshot.cv.hasGeneratedCv
                        ? "Your AI-generated CV"
                        : "Profile-based CV"}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={4}
                    style={{
                      marginTop: 6,
                      color: colors.mutedForeground,
                      fontFamily: "Inter_400Regular",
                      fontSize: 13,
                      lineHeight: 18,
                    }}
                  >
                    {snapshot.cv.preview ??
                      "We'll attach your saved profile so the employer sees your skills, experience, and education."}
                  </Text>
                </View>
              </>
            ) : null}

            {error ? (
              <Text style={{ marginTop: 12, color: colors.destructive }}>
                {error}
              </Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              style={[
                styles.btn,
                {
                  backgroundColor: colors.muted,
                  borderColor: colors.border,
                  flex: 1,
                  marginRight: 8,
                },
              ]}
              disabled={submitting}
            >
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              style={[
                styles.btn,
                {
                  backgroundColor: colors.primary,
                  borderColor: colors.primary,
                  flex: 2,
                },
              ]}
              disabled={submitting || loading || jobId == null}
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text
                  style={{
                    color: colors.primaryForeground,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  Send application
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingBottom: 24,
    maxHeight: "85%",
  },
  handle: { alignItems: "center", paddingTop: 8, paddingBottom: 4 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 18 },
  jobTitle: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  body: { paddingHorizontal: 20 },
  sectionLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  card: { borderWidth: 1, borderRadius: 14, padding: 14 },
  cardName: { fontFamily: "Inter_700Bold", fontSize: 16 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 10, gap: 6 },
  footer: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  btn: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
