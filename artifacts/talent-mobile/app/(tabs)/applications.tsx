import {
  ListApplicationsStatus,
  useGetCandidateDashboard,
  useListApplications,
  type Application,
  type ListApplicationsStatus as ListApplicationsStatusT,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApplicationCard } from "@/components/ApplicationCard";
import { EmptyState } from "@/components/EmptyState";
import { FilterChip } from "@/components/FilterChip";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { StatCard } from "@/components/StatCard";
import { CURRENT_CANDIDATE_ID } from "@/constants/auth";
import { useColors } from "@/hooks/useColors";

const WEB_TOP_INSET = Platform.OS === "web" ? 67 : 0;

type StatusFilter = ListApplicationsStatusT | "all";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: ListApplicationsStatus.applied, label: "Applied" },
  { value: ListApplicationsStatus.screening, label: "Screening" },
  { value: ListApplicationsStatus.interview, label: "Interview" },
  { value: ListApplicationsStatus.offer, label: "Offer" },
  { value: ListApplicationsStatus.hired, label: "Hired" },
  { value: ListApplicationsStatus.rejected, label: "Rejected" },
];

export default function ApplicationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<StatusFilter>("all");

  const dashboardQuery = useGetCandidateDashboard(CURRENT_CANDIDATE_ID);
  const params = useMemo(
    () => ({
      candidateId: CURRENT_CANDIDATE_ID,
      status: filter === "all" ? undefined : filter,
    }),
    [filter],
  );

  const { data: applications, isLoading } = useListApplications(params);

  const goToJob = useCallback((id: number) => {
    router.push(`/job/${id}` as never);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Application }) => (
      <ApplicationCard
        jobTitle={item.jobTitle}
        employerName={item.employerName}
        employerLogoUrl={item.employerLogoUrl}
        status={item.status}
        matchScore={item.matchScore}
        appliedAt={item.appliedAt}
        onPress={() => goToJob(item.jobId)}
      />
    ),
    [goToJob],
  );

  const dashboard = dashboardQuery.data;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + WEB_TOP_INSET + 8,
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Applications
        </Text>

        <View style={styles.statsRow}>
          <StatCard
            label="Applied"
            value={dashboard?.applicationsCount ?? 0}
            icon="send"
          />
          <StatCard
            label="Interviews"
            value={dashboard?.interviewsCount ?? 0}
            icon="calendar"
          />
          <StatCard
            label="Offers"
            value={dashboard?.offersCount ?? 0}
            icon="award"
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {STATUS_FILTERS.map((f) => (
            <FilterChip
              key={f.value}
              label={f.label}
              selected={filter === f.value}
              onPress={() => setFilter(f.value)}
            />
          ))}
        </ScrollView>
      </View>

      <FlatList<Application>
        data={applications ?? []}
        keyExtractor={(item) => `app-${item.id}`}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          isLoading ? (
            <LoadingSpinner />
          ) : (
            <EmptyState
              icon="briefcase"
              title="No applications yet"
              subtitle="Start applying to jobs to see them tracked here."
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    gap: 14,
    paddingBottom: 12,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    letterSpacing: -0.5,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  filters: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 20,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    flexGrow: 1,
  },
});
