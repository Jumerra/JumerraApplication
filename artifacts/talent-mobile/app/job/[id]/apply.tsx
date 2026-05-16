import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListApplicationsQueryKey,
  useAiDraftCoverNote,
  useCreateApplication,
  useGetJob,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/useAuth";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { JobTypeBadge } from "@/components/JobTypeBadge";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useColors } from "@/hooks/useColors";

const MIN_LENGTH = 30;
const MAX_LENGTH = 1000;

export default function ApplyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const jobId = Number(params.id);

  const { data: job, isLoading, isError } = useGetJob(jobId);
  const createMutation = useCreateApplication();
  const draftMutation = useAiDraftCoverNote();
  const { user } = useAuth();
  const candidateId = user?.candidateId ?? 0;

  const [coverNote, setCoverNote] = useState("");
  const trimmedLength = coverNote.trim().length;
  const isValid =
    trimmedLength >= MIN_LENGTH && trimmedLength <= MAX_LENGTH;

  const handleSubmit = () => {
    if (!isValid || createMutation.isPending) return;
    // The server derives `candidateId` from the authenticated session for
    // non-admin users, so we can leave it off the payload. The generated
    // type still requires it; cast to satisfy TS without lying about a
    // value the server will overwrite anyway.
    createMutation.mutate(
      {
        data: {
          jobId,
          coverNote: coverNote.trim(),
        } as { jobId: number; candidateId: number; coverNote: string },
      },
      {
        onSuccess: () => {
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            ).catch(() => {});
          }
          queryClient.invalidateQueries({
            queryKey: getListApplicationsQueryKey(),
          });
          if (router.canGoBack()) {
            router.back();
          }
          router.replace("/applications" as never);
        },
        onError: () => {
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Error,
            ).catch(() => {});
          }
          Alert.alert(
            "Could not submit",
            "Something went wrong submitting your application. You may have already applied to this role.",
          );
        },
      },
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <LoadingSpinner />
      </View>
    );
  }

  if (isError || !job) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="alert-circle"
          title="Couldn't load this job"
          subtitle="Please go back and try again."
        />
      </View>
    );
  }

  const counterColor =
    trimmedLength < MIN_LENGTH ? colors.destructive : colors.mutedForeground;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        style={styles.flex}
        contentContainerStyle={{
          padding: 20,
          paddingBottom: insets.bottom + 120,
          gap: 20,
        }}
        bottomOffset={20}
      >
        <View
          style={[
            styles.jobCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius * 1.5,
            },
          ]}
        >
          <View
            style={[
              styles.logoWrap,
              {
                backgroundColor: colors.secondary,
                borderRadius: colors.radius,
              },
            ]}
          >
            {job.employerLogoUrl ? (
              <Image
                source={{ uri: job.employerLogoUrl }}
                style={styles.logo}
                contentFit="cover"
                transition={150}
              />
            ) : (
              <Feather
                name="briefcase"
                size={20}
                color={colors.mutedForeground}
              />
            )}
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text
              style={[styles.jobTitle, { color: colors.foreground }]}
              numberOfLines={2}
            >
              {job.title}
            </Text>
            <Text
              style={[styles.jobEmployer, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {job.employerName}
            </Text>
            <View style={{ marginTop: 4 }}>
              <JobTypeBadge type={job.type} />
            </View>
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <Text style={[styles.label, { color: colors.foreground }]}>
              Cover note
            </Text>
            {candidateId > 0 ? (
              <Pressable
                disabled={draftMutation.isPending}
                onPress={() => {
                  draftMutation.mutate(
                    { id: candidateId, data: { jobId, regenerate: coverNote.trim().length > 0 } },
                    {
                      onSuccess: (resp) => {
                        setCoverNote(resp.draft.slice(0, MAX_LENGTH));
                        if (Platform.OS !== "web") {
                          Haptics.selectionAsync().catch(() => {});
                        }
                      },
                      onError: (err: unknown) => {
                        Alert.alert(
                          "Couldn't draft",
                          err instanceof Error
                            ? err.message
                            : "AI draft failed. Try again later.",
                        );
                      },
                    },
                  );
                }}
                style={({ pressed }) => [
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: colors.radius,
                    borderWidth: 1,
                    borderColor: colors.primary,
                    opacity: pressed || draftMutation.isPending ? 0.7 : 1,
                  },
                ]}
              >
                <Feather name="zap" size={14} color={colors.primary} />
                <Text
                  style={{
                    color: colors.primary,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 12,
                  }}
                >
                  {draftMutation.isPending ? "Drafting…" : "Draft with AI"}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            Tell {job.employerName} why you'd be a great fit for this role.
          </Text>
          <TextInput
            value={coverNote}
            onChangeText={(t) =>
              setCoverNote(t.slice(0, MAX_LENGTH))
            }
            multiline
            placeholder="I'm excited to apply because..."
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.textArea,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                borderRadius: colors.radius * 1.5,
              },
            ]}
            textAlignVertical="top"
          />
          <View style={styles.counterRow}>
            <Text
              style={[styles.counterText, { color: counterColor }]}
            >
              {trimmedLength < MIN_LENGTH
                ? `${MIN_LENGTH - trimmedLength} more characters needed`
                : `${trimmedLength} / ${MAX_LENGTH}`}
            </Text>
          </View>
        </View>
      </KeyboardAwareScrollViewCompat>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        <Pressable
          onPress={handleSubmit}
          disabled={!isValid || createMutation.isPending}
          style={({ pressed }) => [
            styles.submit,
            {
              backgroundColor:
                !isValid || createMutation.isPending
                  ? colors.muted
                  : colors.primary,
              borderRadius: colors.radius * 1.5,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Feather
            name="send"
            size={18}
            color={
              !isValid || createMutation.isPending
                ? colors.mutedForeground
                : colors.primaryForeground
            }
          />
          <Text
            style={[
              styles.submitText,
              {
                color:
                  !isValid || createMutation.isPending
                    ? colors.mutedForeground
                    : colors.primaryForeground,
              },
            ]}
          >
            {createMutation.isPending ? "Submitting…" : "Submit application"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  jobCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderWidth: 1,
    alignItems: "center",
  },
  logoWrap: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: {
    width: "100%",
    height: "100%",
  },
  jobTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  jobEmployer: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  label: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  helper: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 19,
  },
  textArea: {
    minHeight: 220,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    lineHeight: 22,
  },
  counterRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  counterText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  submit: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    minHeight: 52,
  },
  submitText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
});
