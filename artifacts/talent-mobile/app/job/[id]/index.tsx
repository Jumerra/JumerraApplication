import { Feather } from "@expo/vector-icons";
import {
  getListApplicationsQueryKey,
  useGetJob,
  useListApplications,
} from "@workspace/api-client-react";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmployerReviewsCard } from "@/components/EmployerReviewsCard";
import { EmptyState } from "@/components/EmptyState";
import { JobTypeBadge } from "@/components/JobTypeBadge";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { MatchScoreBadge } from "@/components/MatchScoreBadge";
import { SkillChip } from "@/components/SkillChip";
import { StatusPill } from "@/components/StatusPill";
import { TierBadge } from "@/components/TierBadge";
import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";
import { InterviewPrepCard } from "@/components/InterviewPrepCard";
import { WhyMatched } from "@/components/WhyMatched";
import {
  getGetCandidateJobMatchQueryKey,
  useGetCandidateJobMatch,
} from "@workspace/api-client-react";
import { formatSalary } from "@/lib/format";

export default function JobDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string }>();
  const jobId = Number(params.id);

  const { data: job, isLoading, error } = useGetJob(jobId);
  // Look up the candidate's existing application (if any) so we can show
  // the "applied" state instead of an Apply button. Only candidates have
  // applications, so gate the lookup on role + linked candidate record.
  const candidateId = user?.candidateId ?? 0;
  const isCandidate =
    user?.role === "candidate" && user.candidateId != null;
  const applicationsParams = useMemo(
    () => ({
      candidateId,
      jobId: Number.isFinite(jobId) ? jobId : undefined,
    }),
    [candidateId, jobId],
  );
  const { data: applications } = useListApplications(applicationsParams, {
    query: {
      queryKey: getListApplicationsQueryKey(applicationsParams),
      enabled: isCandidate && Number.isFinite(jobId),
    },
  });

  const existingApplication = useMemo(
    () => applications?.find((a) => a.jobId === jobId),
    [applications, jobId],
  );

  if (isLoading) {
    return (
      <View
        style={[styles.flex, { backgroundColor: colors.background }]}
      >
        <LoadingSpinner />
      </View>
    );
  }

  if (error || !job) {
    return (
      <View
        style={[styles.flex, { backgroundColor: colors.background }]}
      >
        <EmptyState
          icon="alert-circle"
          title="Job not found"
          subtitle="This role may have been removed."
        />
      </View>
    );
  }

  const salary = formatSalary(job.salaryMin, job.salaryMax, job.currency);
  const matchScore = existingApplication?.matchScore;

  const headerHeight = insets.top + 56;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        <LinearGradient
          colors={[colors.primary, colors.background]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[styles.heroGradient, { paddingTop: headerHeight + 8 }]}
        >
          <View style={styles.heroInner}>
            <View style={styles.heroTopRow}>
              <View
                style={[
                  styles.logoWrap,
                  {
                    backgroundColor: colors.background,
                    borderRadius: colors.radius * 1.5,
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
                    size={28}
                    color={colors.mutedForeground}
                  />
                )}
              </View>
              {typeof matchScore === "number" ? (
                <MatchScoreBadge score={matchScore} size={56} />
              ) : null}
            </View>

            <Text
              style={[styles.employer, { color: colors.primaryForeground }]}
              numberOfLines={1}
            >
              {job.employerName}
            </Text>
            <Text
              style={[styles.title, { color: colors.primaryForeground }]}
              numberOfLines={3}
            >
              {job.title}
            </Text>
            {job.tier && job.tier !== "free" ? (
              <View style={{ flexDirection: "row", marginTop: 6 }}>
                <TierBadge tier={job.tier} size="md" />
              </View>
            ) : null}

            <View style={styles.metaRow}>
              <JobTypeBadge type={job.type} />
              <View
                style={[
                  styles.metaPill,
                  {
                    backgroundColor: colors.background,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <Feather
                  name="map-pin"
                  size={12}
                  color={colors.foreground}
                />
                <Text style={[styles.metaText, { color: colors.foreground }]}>
                  {job.remote ? "Remote" : job.location}
                </Text>
              </View>
              {salary ? (
                <View
                  style={[
                    styles.metaPill,
                    {
                      backgroundColor: colors.background,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  <Feather
                    name="dollar-sign"
                    size={12}
                    color={colors.foreground}
                  />
                  <Text style={[styles.metaText, { color: colors.foreground }]}>
                    {salary}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </LinearGradient>

        <View style={styles.body}>
          {job.description ? (
            <Section title="About this role">
              <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                {job.description}
              </Text>
            </Section>
          ) : null}

          {job.skills?.length ? (
            <Section title="Required skills">
              <View style={styles.chipCloud}>
                {job.skills.map((s) => (
                  <SkillChip key={s} label={s} />
                ))}
              </View>
            </Section>
          ) : null}

          {job.requirements?.length ? (
            <Section title="Requirements">
              <View style={{ gap: 10 }}>
                {job.requirements.map((r, i) => (
                  <View key={`req-${i}`} style={styles.bulletRow}>
                    <View
                      style={[
                        styles.bulletDot,
                        { backgroundColor: colors.primary },
                      ]}
                    />
                    <Text
                      style={[styles.bodyText, { color: colors.foreground, flex: 1 }]}
                    >
                      {r}
                    </Text>
                  </View>
                ))}
              </View>
            </Section>
          ) : null}

          {isCandidate && candidateId > 0 ? (
            <Section title="Why we matched you">
              <MatchExplainer candidateId={candidateId} jobId={jobId} />
            </Section>
          ) : null}

          {isCandidate && candidateId > 0 ? (
            <Section title="Interview prep">
              <InterviewPrepCard candidateId={candidateId} jobId={jobId} />
            </Section>
          ) : null}

          {isCandidate ? (
            <MockInterviewCta jobId={jobId} />
          ) : null}

          {job.benefits?.length ? (
            <Section title="Benefits">
              <View style={{ gap: 10 }}>
                {job.benefits.map((b, i) => (
                  <View key={`ben-${i}`} style={styles.bulletRow}>
                    <Feather
                      name="check-circle"
                      size={16}
                      color={colors.primary}
                      style={{ marginTop: 2 }}
                    />
                    <Text
                      style={[styles.bodyText, { color: colors.foreground, flex: 1 }]}
                    >
                      {b}
                    </Text>
                  </View>
                ))}
              </View>
            </Section>
          ) : null}

          {job.employerId ? (
            <EmployerReviewsCard employerId={job.employerId} />
          ) : null}
        </View>
      </ScrollView>

      <StickyApplyBar
        applied={!!existingApplication}
        status={existingApplication?.status}
        onApply={() => router.push(`/job/${jobId}/apply` as never)}
      />
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function StickyApplyBar({
  applied,
  status,
  onApply,
}: {
  applied: boolean;
  status?: string;
  onApply: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.stickyBar,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          paddingBottom: insets.bottom + 12,
        },
      ]}
    >
      {applied ? (
        <View
          style={[
            styles.appliedBar,
            {
              backgroundColor: colors.secondary,
              borderRadius: colors.radius * 1.5,
            },
          ]}
        >
          <View style={styles.appliedTextWrap}>
            <Text style={[styles.appliedTitle, { color: colors.foreground }]}>
              Application submitted
            </Text>
            {status ? (
              <Text
                style={[styles.appliedSubtitle, { color: colors.mutedForeground }]}
              >
                Tracking your application
              </Text>
            ) : null}
          </View>
          {status ? <StatusPill status={status} /> : null}
        </View>
      ) : (
        <Pressable
          onPress={onApply}
          style={({ pressed }) => [
            styles.applyButton,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius * 1.5,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Feather name="send" size={18} color={colors.primaryForeground} />
          <Text
            style={[styles.applyButtonText, { color: colors.primaryForeground }]}
          >
            Apply
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heroGradient: {
    paddingBottom: 24,
  },
  heroInner: {
    paddingHorizontal: 20,
    gap: 8,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  logoWrap: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: {
    width: "100%",
    height: "100%",
  },
  employer: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    opacity: 0.9,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 26,
    letterSpacing: -0.5,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metaText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 24,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
  },
  bodyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 22,
  },
  chipCloud: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  bulletRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
  },
  stickyBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  applyButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    minHeight: 52,
  },
  applyButtonText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  appliedBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    minHeight: 52,
  },
  appliedTextWrap: {
    flex: 1,
    gap: 2,
  },
  appliedTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  appliedSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
  },
});

function MockInterviewCta({ jobId }: { jobId: number }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() =>
        router.push(`/job/${jobId}/mock-interview` as never)
      }
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: 14,
          borderWidth: 1,
          borderColor: colors.primary + "60",
          backgroundColor: colors.primary + "10",
          borderRadius: colors.radius * 1.25,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      testID="button-mock-interview-cta"
    >
      <Feather name="zap" size={20} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: colors.foreground,
            fontFamily: "Inter_700Bold",
            fontSize: 14,
          }}
        >
          Take an AI mock interview
        </Text>
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: "Inter_400Regular",
            fontSize: 12,
            marginTop: 2,
          }}
        >
          6 role-tuned questions, scored instantly. Employers see your score.
        </Text>
      </View>
      <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
    </Pressable>
  );
}

function MatchExplainer({ candidateId, jobId }: { candidateId: number; jobId: number }) {
  const { data, isLoading } = useGetCandidateJobMatch(candidateId, jobId, {
    query: {
      queryKey: getGetCandidateJobMatchQueryKey(candidateId, jobId),
      enabled: candidateId > 0 && jobId > 0,
    },
  });
  if (isLoading || !data) return null;
  return <WhyMatched breakdown={data} />;
}
