import { customFetch } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";

import { useColors } from "@/hooks/useColors";

type SampleJob = {
  jobId: number;
  title: string;
  employerName: string;
  missingSkills: string[];
};

type Role = {
  title: string;
  jobCount: number;
  requiredSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  distance: number;
  sampleJobs: SampleJob[];
};

type Constellation = {
  candidateSkills: string[];
  roles: Role[];
};

const LABELS: Record<number, string> = {
  0: "You qualify",
  1: "1 skill away",
  2: "2 skills away",
};

export function CareerConstellationCard() {
  const colors = useColors();
  const [data, setData] = useState<Constellation | null>(null);
  const [loading, setLoading] = useState(true);
  const [openTitle, setOpenTitle] = useState<string | null>(null);
  const [addingSkill, setAddingSkill] = useState<string | null>(null);
  const [addedSkills, setAddedSkills] = useState<Set<string>>(new Set());

  const addToGrowthPlan = useCallback(async (skill: string) => {
    const lower = skill.toLowerCase();
    setAddingSkill(lower);
    try {
      await customFetch(
        `/api/me/growth-plan/${encodeURIComponent(lower)}/add`,
        { method: "POST" },
      );
      setAddedSkills((s) => new Set(s).add(lower));
      Alert.alert("Added", `${skill} added to your growth plan`);
    } catch (err) {
      Alert.alert("Error", (err as Error).message);
    } finally {
      setAddingSkill(null);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await customFetch<Constellation>(
        "/api/me/career-constellation",
      );
      setData(d ?? null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!data || data.roles.length === 0) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
        testID="card-career-constellation-empty"
      >
        <View style={styles.header}>
          <Feather name="git-branch" size={18} color={colors.primary} />
          <Text style={[styles.title, { color: colors.text }]}>
            Career constellation
          </Text>
        </View>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Add more skills to your profile to see roles you're close to.
        </Text>
      </View>
    );
  }

  const grouped: Record<0 | 1 | 2, Role[]> = { 0: [], 1: [], 2: [] };
  for (const r of data.roles) {
    const d = Math.max(0, Math.min(2, r.distance)) as 0 | 1 | 2;
    grouped[d].push(r);
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
      testID="card-career-constellation"
    >
      <View style={styles.header}>
        <Feather name="git-branch" size={18} color={colors.primary} />
        <Text style={[styles.title, { color: colors.text }]}>
          Career constellation
        </Text>
      </View>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Roles you qualify for and ones you're 1–2 skills away from.
      </Text>

      {([0, 1, 2] as const).map((d) => {
        if (grouped[d].length === 0) return null;
        return (
          <View key={d} style={styles.section}>
            <Text
              style={[styles.sectionLabel, { color: colors.mutedForeground }]}
            >
              {LABELS[d].toUpperCase()} · {grouped[d].length}
            </Text>
            {grouped[d].map((r) => {
              const isOpen = openTitle === r.title;
              return (
                <Pressable
                  key={r.title}
                  onPress={() =>
                    setOpenTitle(isOpen ? null : r.title)
                  }
                  style={[styles.row, { borderColor: colors.border }]}
                  testID={`constellation-row-${r.title}`}
                >
                  <View style={styles.rowHead}>
                    <Text style={[styles.rowTitle, { color: colors.text }]}>
                      {r.title}
                    </Text>
                    <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
                      {r.jobCount} job{r.jobCount === 1 ? "" : "s"}
                    </Text>
                  </View>
                  {r.missingSkills.length > 0 ? (
                    <View style={styles.missingWrap}>
                      <Text
                        style={[
                          styles.rowMissing,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        Missing:
                      </Text>
                      {r.missingSkills.map((s) => {
                        const lower = s.toLowerCase();
                        const isAdded = addedSkills.has(lower);
                        const isBusy = addingSkill === lower;
                        return (
                          <Pressable
                            key={s}
                            disabled={isAdded || isBusy}
                            onPress={(e) => {
                              e.stopPropagation();
                              addToGrowthPlan(s);
                            }}
                            style={[
                              styles.skillPill,
                              {
                                borderColor: colors.border,
                                backgroundColor: isAdded
                                  ? colors.secondary
                                  : "transparent",
                              },
                            ]}
                            testID={`add-growth-${s}`}
                          >
                            <Feather
                              name={isAdded ? "check" : "plus"}
                              size={11}
                              color={colors.primary}
                            />
                            <Text
                              style={[styles.skillPillText, { color: colors.text }]}
                            >
                              {s}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <Text
                      style={[styles.rowMissing, { color: colors.primary }]}
                    >
                      You meet every required skill.
                    </Text>
                  )}
                  {isOpen && r.sampleJobs.length > 0 ? (
                    <View style={styles.samples}>
                      {r.sampleJobs.map((j) => (
                        <Pressable
                          key={j.jobId}
                          onPress={() => router.push(`/job/${j.jobId}`)}
                        >
                          <Text
                            style={[styles.sample, { color: colors.primary }]}
                          >
                            {j.title} · {j.employerName}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginVertical: 8,
    gap: 4,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontWeight: "700", fontSize: 16 },
  subtitle: { fontSize: 12, marginBottom: 8 },
  section: { marginTop: 8, gap: 6 },
  sectionLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.5 },
  row: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    gap: 4,
  },
  rowHead: { flexDirection: "row", justifyContent: "space-between" },
  rowTitle: { fontWeight: "600", fontSize: 14 },
  rowMeta: { fontSize: 11 },
  rowMissing: { fontSize: 12 },
  samples: { marginTop: 6, gap: 2 },
  sample: { fontSize: 12, textDecorationLine: "underline" },
  missingWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  skillPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  skillPillText: { fontSize: 11, fontWeight: "500" },
});
