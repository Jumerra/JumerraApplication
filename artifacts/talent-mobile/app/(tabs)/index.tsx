import { Feather } from "@expo/vector-icons";
import {
  getGetCandidateQueryKey,
  getGetCandidateRecommendationsQueryKey,
  useGetCandidate,
  useGetCandidateRecommendations,
  useListJobs,
  type Job,
  type JobMatch,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { JobCard } from "@/components/JobCard";
import { JobRow } from "@/components/JobRow";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { SectionHeader } from "@/components/SectionHeader";
import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";

const WEB_TOP_INSET = Platform.OS === "web" ? 67 : 0;

export default function DiscoverScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  // Discover only makes sense for candidates with a linked candidate
  // record. Non-candidate users still land here briefly before AuthGate
  // bounces them, so we gate the queries to avoid 404 storms.
  const candidateId = user?.candidateId ?? 0;
  const hasCandidateRecord =
    user?.role === "candidate" && user.candidateId != null;

  const candidateQuery = useGetCandidate(candidateId, {
    query: {
      queryKey: getGetCandidateQueryKey(candidateId),
      enabled: hasCandidateRecord,
    },
  });
  const recommendationsQuery = useGetCandidateRecommendations(candidateId, {
    query: {
      queryKey: getGetCandidateRecommendationsQueryKey(candidateId),
      enabled: hasCandidateRecord,
    },
  });
  const trendingQuery = useListJobs({ featured: true });

  const candidate = candidateQuery.data;
  const recommendations = (recommendationsQuery.data ?? []).slice(0, 8);
  const trending = (trendingQuery.data ?? []).slice(0, 5);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Manual refetch() bypasses the `enabled` flag in react-query, so we
      // must guard the candidate-scoped queries on `hasCandidateRecord` to
      // avoid firing requests for /api/candidates/0/* when the user is not
      // a candidate (or hasn't loaded yet).
      await Promise.all([
        ...(hasCandidateRecord
          ? [candidateQuery.refetch(), recommendationsQuery.refetch()]
          : []),
        trendingQuery.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [
    hasCandidateRecord,
    candidateQuery,
    recommendationsQuery,
    trendingQuery,
  ]);

  const firstName = candidate?.fullName?.split(" ")[0] ?? "there";

  const goToJob = useCallback((id: number) => {
    router.push(`/job/${id}` as never);
  }, []);

  const isInitialLoading =
    candidateQuery.isLoading &&
    recommendationsQuery.isLoading &&
    trendingQuery.isLoading;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + WEB_TOP_INSET + 8,
        paddingBottom: insets.bottom + 120,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.heroWrap}>
        <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
          Hi, {firstName}
        </Text>
        <Text style={[styles.heroTitle, { color: colors.foreground }]}>
          Find work that fits
        </Text>
        {candidate ? (
          <View
            style={[
              styles.scorePill,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius * 2,
              },
            ]}
          >
            <Feather
              name="zap"
              size={12}
              color={colors.primaryForeground}
            />
            <Text
              style={[styles.scoreText, { color: colors.primaryForeground }]}
            >
              Talent Score {candidate.talentScore}
            </Text>
          </View>
        ) : null}
      </View>

      {isInitialLoading ? <LoadingSpinner /> : null}

      <View style={styles.section}>
        <View style={styles.sectionHeaderWrap}>
          <SectionHeader
            title="Recommended for you"
            subtitle="AI-matched roles based on your skills"
          />
        </View>
        {recommendationsQuery.isLoading ? (
          <View style={styles.horizontalLoading}>
            <LoadingSpinner size="small" />
          </View>
        ) : recommendations.length === 0 ? (
          <EmptyState
            icon="zap"
            title="No recommendations yet"
            subtitle="Add more skills to your profile to get matched."
          />
        ) : (
          <FlatList<JobMatch>
            data={recommendations}
            keyExtractor={(item) => `rec-${item.jobId}`}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}
            ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
            renderItem={({ item }) => (
              <JobCard
                title={item.title}
                employerName={item.employerName}
                employerLogoUrl={item.employerLogoUrl}
                location={item.location}
                type={item.type}
                matchScore={item.matchScore}
                salaryMin={item.salaryMin}
                salaryMax={item.salaryMax}
                currency={item.currency}
                tier={item.tier}
                onPress={() => goToJob(item.jobId)}
              />
            )}
          />
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeaderWrap}>
          <SectionHeader
            title="Trending now"
            subtitle="Featured roles employers are actively hiring for"
          />
        </View>
        {trendingQuery.isLoading ? (
          <View style={styles.horizontalLoading}>
            <LoadingSpinner size="small" />
          </View>
        ) : trending.length === 0 ? (
          <EmptyState
            icon="briefcase"
            title="No trending jobs"
            subtitle="Check back later for fresh featured roles."
          />
        ) : (
          <View style={styles.verticalList}>
            {trending.map((job: Job) => (
              <JobRow
                key={`trend-${job.id}`}
                title={job.title}
                employerName={job.employerName}
                employerLogoUrl={job.employerLogoUrl}
                location={job.remote ? "Remote" : job.location}
                type={job.type}
                salaryMin={job.salaryMin}
                salaryMax={job.salaryMax}
                currency={job.currency}
                tier={job.tier}
                onPress={() => goToJob(job.id)}
              />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  heroWrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 6,
  },
  greeting: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  heroTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    letterSpacing: -0.5,
  },
  scorePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: "flex-start",
    marginTop: 8,
  },
  scoreText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  section: {
    marginTop: 24,
    gap: 12,
  },
  sectionHeaderWrap: {
    paddingHorizontal: 20,
  },
  horizontalList: {
    paddingHorizontal: 20,
  },
  horizontalLoading: {
    height: 120,
    justifyContent: "center",
  },
  verticalList: {
    paddingHorizontal: 20,
    gap: 10,
  },
});
