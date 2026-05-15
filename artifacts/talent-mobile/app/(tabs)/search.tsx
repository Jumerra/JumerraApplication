import { Feather } from "@expo/vector-icons";
import {
  ListJobsType,
  useListJobs,
  type Job,
  type ListJobsType as ListJobsTypeT,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { FilterChip } from "@/components/FilterChip";
import { JobRow } from "@/components/JobRow";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useColors } from "@/hooks/useColors";

const WEB_TOP_INSET = Platform.OS === "web" ? 67 : 0;

type FilterValue = ListJobsTypeT | "all";

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: ListJobsType.internship, label: "Internship" },
  { value: ListJobsType.full_time, label: "Full time" },
  { value: ListJobsType.part_time, label: "Part time" },
  { value: ListJobsType.contract, label: "Contract" },
  { value: ListJobsType.remote, label: "Remote" },
];

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<FilterValue>("all");

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const params = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      type: filter === "all" ? undefined : filter,
    }),
    [debouncedSearch, filter],
  );

  const { data, isLoading, isFetching } = useListJobs(params);

  const goToJob = useCallback((id: number) => {
    router.push(`/job/${id}` as never);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Job }) => (
      <JobRow
        title={item.title}
        employerName={item.employerName}
        employerLogoUrl={item.employerLogoUrl}
        location={item.remote ? "Remote" : item.location}
        type={item.type}
        salaryMin={item.salaryMin}
        salaryMax={item.salaryMax}
        currency={item.currency}
        tier={item.tier}
        onPress={() => goToJob(item.id)}
      />
    ),
    [goToJob],
  );

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
        <Text style={[styles.title, { color: colors.foreground }]}>Search</Text>
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: colors.secondary,
              borderRadius: colors.radius * 1.5,
            },
          ]}
        >
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            style={[styles.input, { color: colors.foreground }]}
            placeholder="Search jobs, skills, companies"
            placeholderTextColor={colors.mutedForeground}
            value={searchInput}
            onChangeText={setSearchInput}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersRow}
        >
          {FILTERS.map((f) => (
            <FilterChip
              key={f.value}
              label={f.label}
              selected={filter === f.value}
              onPress={() => setFilter(f.value)}
            />
          ))}
        </ScrollView>
      </View>

      <FlatList<Job>
        data={data ?? []}
        keyExtractor={(item) => `search-${item.id}`}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          isLoading || isFetching ? (
            <LoadingSpinner />
          ) : (
            <EmptyState
              icon="search"
              title="No matching jobs"
              subtitle="Try adjusting your search or filters."
            />
          )
        }
        keyboardShouldPersistTaps="handled"
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    minHeight: 48,
  },
  input: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    paddingVertical: 0,
  },
  filtersRow: {
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
