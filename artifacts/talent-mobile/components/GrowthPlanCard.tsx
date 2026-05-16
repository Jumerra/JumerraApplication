import { customFetch } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

type GrowthItem = {
  id: number;
  skill: string;
  status: "active" | "completed" | "dismissed";
  rejectionCount: number;
  targetDate: string | null;
  estMinutes: number;
  resources: { title: string; url: string; estMinutes: number }[];
};

function formatTarget(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatHours(mins: number): string {
  const h = Math.round(mins / 60);
  if (h < 24) return `~${h}h`;
  const d = Math.round(h / 8);
  return `~${d} focused days`;
}

export function GrowthPlanCard() {
  const colors = useColors();
  const [items, setItems] = useState<GrowthItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await customFetch<{ items: GrowthItem[] }>(
        "/api/me/growth-plan",
      );
      setItems(data?.items ?? []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const complete = async (skill: string) => {
    setBusy(skill);
    try {
      const res = await customFetch<{
        ok: boolean;
        employersNotified: number;
      }>(`/api/me/growth-plan/${encodeURIComponent(skill)}/complete`, {
        method: "POST",
      });
      const tail =
        res && res.employersNotified > 0
          ? `\n${res.employersNotified} employer${res.employersNotified === 1 ? "" : "s"} re-pinged.`
          : "";
      Alert.alert(`Nice work!`, `Marked "${skill}" complete.${tail}`);
      await load();
    } catch (err) {
      Alert.alert("Couldn't complete", (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (skill: string) => {
    setBusy(skill);
    try {
      await customFetch(
        `/api/me/growth-plan/${encodeURIComponent(skill)}/dismiss`,
        { method: "POST" },
      );
      await load();
    } catch (err) {
      Alert.alert("Couldn't dismiss", (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (items == null) return null;
  const active = items.filter((i) => i.status === "active");
  if (active.length === 0) return null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.header}>
        <Feather name="trending-up" size={18} color={colors.primary} />
        <Text style={[styles.title, { color: colors.text }]}>
          Your growth plan
        </Text>
      </View>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        {active.length} missing skill{active.length === 1 ? "" : "s"} from
        recent rejections. Close one and we'll re-ping those employers.
      </Text>
      {active.map((item) => (
        <View
          key={item.id}
          style={[
            styles.item,
            { borderColor: colors.border, backgroundColor: colors.background },
          ]}
        >
          <View style={styles.itemHead}>
            <Text style={[styles.skill, { color: colors.text }]}>
              {item.skill}
            </Text>
            <Pressable
              onPress={() => dismiss(item.skill)}
              disabled={busy === item.skill}
              hitSlop={8}
            >
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            Missed on {item.rejectionCount} job
            {item.rejectionCount === 1 ? "" : "s"} · {formatHours(item.estMinutes)}
            {item.targetDate ? ` · target ${formatTarget(item.targetDate)}` : ""}
          </Text>
          {item.resources.map((r) => (
            <Pressable
              key={r.url}
              onPress={() => Linking.openURL(r.url)}
              style={styles.resourceRow}
            >
              <Feather name="external-link" size={14} color={colors.primary} />
              <Text style={[styles.resource, { color: colors.primary }]}>
                {r.title}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => complete(item.skill)}
            disabled={busy === item.skill}
            style={[styles.cta, { backgroundColor: colors.primary }]}
          >
            {busy === item.skill ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Feather name="check-circle" size={14} color="#fff" />
                <Text style={styles.ctaText}>I'm skilled in this now</Text>
              </>
            )}
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 16,
    gap: 12,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "700" },
  subtitle: { fontSize: 13 },
  item: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 6 },
  itemHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  skill: {
    fontSize: 15,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  meta: { fontSize: 12 },
  resourceRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  resource: { fontSize: 13, textDecorationLine: "underline" },
  cta: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  ctaText: { color: "#fff", fontWeight: "600", fontSize: 14 },
});
