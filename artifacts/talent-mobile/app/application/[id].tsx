import {
  getListApplicationsQueryKey,
  useListApplications,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApplicationTimeline } from "@/components/ApplicationTimeline";
import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";

const WEB_TOP_INSET = Platform.OS === "web" ? 67 : 0;

export default function ApplicationDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const applicationId = Number(id);
  const { user } = useAuth();
  const candidateId = user?.candidateId ?? 0;

  const params = { candidateId };
  const { data: apps } = useListApplications(params, {
    query: {
      queryKey: getListApplicationsQueryKey(params),
      enabled: candidateId > 0,
    },
  });
  const app = apps?.find((a) => a.id === applicationId);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + WEB_TOP_INSET + 8,
        paddingBottom: insets.bottom + 32,
        paddingHorizontal: 20,
        gap: 14,
      }}
    >
      <Pressable
        onPress={() => router.back()}
        style={styles.backRow}
        hitSlop={8}
      >
        <Feather name="chevron-left" size={20} color={colors.primary} />
        <Text style={[styles.backText, { color: colors.primary }]}>Back</Text>
      </Pressable>

      {app ? (
        <View
          style={[
            styles.headerCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius * 1.5,
            },
          ]}
        >
          <Text style={[styles.jobTitle, { color: colors.foreground }]}>
            {app.jobTitle}
          </Text>
          <Text style={[styles.employer, { color: colors.mutedForeground }]}>
            {app.employerName}
          </Text>
          <Pressable
            onPress={() => router.push(`/job/${app.jobId}` as never)}
            style={styles.viewJob}
          >
            <Feather name="external-link" size={14} color={colors.primary} />
            <Text style={[styles.viewJobText, { color: colors.primary }]}>
              View job posting
            </Text>
          </Pressable>
        </View>
      ) : null}

      {applicationId > 0 ? (
        <ApplicationTimeline applicationId={applicationId} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  backText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  headerCard: {
    padding: 16,
    borderWidth: 1,
    gap: 6,
  },
  jobTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
  },
  employer: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  viewJob: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  viewJobText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
});
