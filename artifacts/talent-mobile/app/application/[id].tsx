import {
  getListApplicationsQueryKey,
  useListApplications,
  useReportApplicationSalary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApplicationTimeline } from "@/components/ApplicationTimeline";
import { InterviewPrepCard } from "@/components/InterviewPrepCard";
import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";

const PREP_STATUSES = new Set(["screening", "interview", "offer", "hired"]);

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

      {app && candidateId > 0 && PREP_STATUSES.has(app.status) ? (
        <InterviewPrepCard candidateId={candidateId} jobId={app.jobId} />
      ) : null}

      {app && app.status === "hired" && candidateId > 0 ? (
        <ReportSalary
          applicationId={app.id}
          candidateId={candidateId}
          alreadyReported={Boolean(app.reportedSalary)}
        />
      ) : null}

      {applicationId > 0 ? (
        <ApplicationTimeline applicationId={applicationId} />
      ) : null}
    </ScrollView>
  );
}

function ReportSalary({
  applicationId,
  candidateId,
  alreadyReported,
}: {
  applicationId: number;
  candidateId: number;
  alreadyReported: boolean;
}) {
  const colors = useColors();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("GHS");
  const mut = useReportApplicationSalary({
    mutation: {
      onSuccess: () => {
        Alert.alert("Thanks", "Your data helps everyone negotiate fairly.");
        qc.invalidateQueries({
          queryKey: getListApplicationsQueryKey({ candidateId }),
        });
      },
      onError: () => Alert.alert("Could not save", "Please try again."),
    },
  });

  if (alreadyReported) {
    return (
      <View
        style={[
          styles.salaryCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.salaryHeader}>
          <Feather name="check-circle" size={16} color={colors.primary} />
          <Text style={[styles.salaryTitle, { color: colors.foreground }]}>
            Salary reported (anonymous)
          </Text>
        </View>
        <Text style={[styles.salaryBody, { color: colors.mutedForeground }]}>
          Thanks — only the aggregate band is shared.
        </Text>
      </View>
    );
  }

  const num = Number(amount.replace(/[^0-9]/g, ""));
  const valid = num > 0 && currency.length >= 2;

  return (
    <View
      style={[
        styles.salaryCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.salaryHeader}>
        <Feather name="dollar-sign" size={16} color={colors.primary} />
        <Text style={[styles.salaryTitle, { color: colors.foreground }]}>
          Share what you earned (anonymous)
        </Text>
      </View>
      <Text style={[styles.salaryBody, { color: colors.mutedForeground }]}>
        Helps future candidates negotiate. Never shown on its own — only
        as part of a band once 3+ hires have reported.
      </Text>
      <View style={styles.salaryRow}>
        <TextInput
          value={currency}
          onChangeText={(t) => setCurrency(t.toUpperCase())}
          maxLength={6}
          style={[
            styles.salaryInput,
            {
              width: 70,
              color: colors.foreground,
              borderColor: colors.border,
            },
          ]}
        />
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          placeholder="Annual amount"
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.salaryInput,
            {
              flex: 1,
              color: colors.foreground,
              borderColor: colors.border,
            },
          ]}
        />
      </View>
      <Pressable
        disabled={!valid || mut.isPending}
        onPress={() =>
          mut.mutate({
            id: applicationId,
            data: { reportedSalary: num, reportedCurrency: currency },
          })
        }
        style={[
          styles.salaryButton,
          {
            backgroundColor: colors.primary,
            opacity: !valid || mut.isPending ? 0.5 : 1,
          },
        ]}
      >
        <Text style={[styles.salaryButtonText, { color: colors.primaryForeground }]}>
          {mut.isPending ? "Saving…" : "Share anonymously"}
        </Text>
      </Pressable>
    </View>
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
  salaryCard: {
    padding: 14,
    borderWidth: 1,
    borderRadius: 16,
    gap: 10,
  },
  salaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  salaryTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
  },
  salaryBody: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 18,
  },
  salaryRow: {
    flexDirection: "row",
    gap: 8,
  },
  salaryInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  salaryButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  salaryButtonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
});
