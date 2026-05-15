import { Feather } from "@expo/vector-icons";
import {
  useGetCandidate,
  useListCandidateProfileViews,
  getGetCandidateQueryKey,
  getListCandidateProfileViewsQueryKey,
} from "@workspace/api-client-react";
import { Image } from "expo-image";
import { router, Stack } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";

function formatRelative(iso: string) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function ProfileViewsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const candidateId = user?.candidateId ?? 0;
  const enabled = !!user && user.role === "candidate" && candidateId > 0;

  const { data: candidate } = useGetCandidate(candidateId, {
    query: {
      enabled,
      queryKey: getGetCandidateQueryKey(candidateId),
    },
  });
  const isBoosted = !!candidate?.isBoosted;

  const { data, isLoading, error } = useListCandidateProfileViews(
    candidateId,
    {
      query: {
        enabled: enabled && isBoosted,
        queryKey: getListCandidateProfileViewsQueryKey(candidateId),
      },
    },
  );

  const httpError = error as { status?: number } | null;
  const boostRequired = httpError?.status === 403 || (candidate && !isBoosted);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: "Who viewed your profile",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }}
      />
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 32,
        }}
      >
        {boostRequired && (
          <View
            style={[
              styles.lockCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View
              style={[
                styles.lockIconCircle,
                { backgroundColor: `${colors.primary}20` },
              ]}
            >
              <Feather name="lock" size={28} color={colors.primary} />
            </View>
            <Text style={[styles.lockTitle, { color: colors.text }]}>
              Boost your profile to unlock
            </Text>
            <Text
              style={[styles.lockSubtitle, { color: colors.mutedForeground }]}
            >
              Boosted candidates can see every company that has viewed their
              profile and get a notification when a new recruiter opens it.
            </Text>
            <Pressable
              onPress={() => router.push("/(tabs)/profile")}
              style={[styles.cta, { backgroundColor: colors.primary }]}
            >
              <Feather name="zap" size={16} color="white" />
              <Text style={styles.ctaText}>Boost my profile</Text>
            </Pressable>
          </View>
        )}

        {!boostRequired && isLoading && (
          <View style={{ paddingTop: 64, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {!boostRequired && data && data.items.length === 0 && (
          <View style={{ paddingTop: 80, alignItems: "center", gap: 8 }}>
            <Feather name="eye-off" size={28} color={colors.mutedForeground} />
            <Text style={{ color: colors.text, fontWeight: "600" }}>
              No profile views yet
            </Text>
            <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>
              When recruiters open your profile, they'll appear here.
            </Text>
          </View>
        )}

        {!boostRequired && data && data.items.length > 0 && (
          <>
            <View style={styles.statsRow}>
              <View
                style={[
                  styles.statPill,
                  { borderColor: colors.border, backgroundColor: colors.card },
                ]}
              >
                <Feather name="eye" size={14} color={colors.mutedForeground} />
                <Text style={[styles.statText, { color: colors.text }]}>
                  {data.totalViews} view{data.totalViews === 1 ? "" : "s"}
                </Text>
              </View>
              <View
                style={[
                  styles.statPill,
                  { borderColor: colors.border, backgroundColor: colors.card },
                ]}
              >
                <Feather name="briefcase" size={14} color={colors.mutedForeground} />
                <Text style={[styles.statText, { color: colors.text }]}>
                  {data.uniqueEmployers} compan
                  {data.uniqueEmployers === 1 ? "y" : "ies"}
                </Text>
              </View>
            </View>

            {data.items.map((item, i) => (
              <View
                key={`${item.employer.id}-${i}`}
                style={[
                  styles.itemCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.itemHeader}>
                  {item.employer.logoUrl ? (
                    <Image
                      source={{ uri: item.employer.logoUrl }}
                      style={styles.logo}
                      contentFit="cover"
                    />
                  ) : (
                    <View
                      style={[
                        styles.logo,
                        {
                          backgroundColor: colors.muted,
                          alignItems: "center",
                          justifyContent: "center",
                        },
                      ]}
                    >
                      <Feather name="briefcase" size={20} color={colors.mutedForeground} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={styles.nameRow}>
                      <Text
                        style={[styles.companyName, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {item.employer.name}
                      </Text>
                      {item.employer.verified && (
                        <Feather
                          name="check-circle"
                          size={14}
                          color={colors.primary}
                        />
                      )}
                    </View>
                    {!!item.employer.tagline && (
                      <Text
                        style={[
                          styles.tagline,
                          { color: colors.mutedForeground },
                        ]}
                        numberOfLines={1}
                      >
                        {item.employer.tagline}
                      </Text>
                    )}
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                    {formatRelative(item.lastViewedAt)}
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  {!!item.employer.industry && (
                    <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                      {item.employer.industry}
                    </Text>
                  )}
                  {!!item.employer.location && (
                    <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                      · {item.employer.location}
                    </Text>
                  )}
                  <View
                    style={[
                      styles.viewCountBadge,
                      { borderColor: colors.border },
                    ]}
                  >
                    <Text style={{ color: colors.text, fontSize: 11, fontWeight: "600" }}>
                      {item.viewCount} view{item.viewCount === 1 ? "" : "s"}
                    </Text>
                  </View>
                </View>

                {!!item.viewerName && (
                  <Text style={[styles.viewerLine, { color: colors.text }]}>
                    Viewed by {item.viewerName}
                    {item.viewerTitle ? ` · ${item.viewerTitle}` : ""}
                  </Text>
                )}

                {!!item.employer.websiteUrl && (
                  <Pressable
                    onPress={() => Linking.openURL(item.employer.websiteUrl)}
                    style={[
                      styles.websiteBtn,
                      { borderColor: colors.border },
                    ]}
                  >
                    <Feather name="external-link" size={14} color={colors.text} />
                    <Text style={{ color: colors.text, fontWeight: "500" }}>
                      Visit website
                    </Text>
                  </Pressable>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  lockCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  lockIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  lockTitle: { fontSize: 18, fontWeight: "700" },
  lockSubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  cta: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ctaText: { color: "white", fontWeight: "600" },
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  statPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statText: { fontSize: 13, fontWeight: "600" },
  itemCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 10,
  },
  itemHeader: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  logo: { width: 44, height: 44, borderRadius: 8 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  companyName: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
  tagline: { fontSize: 13, marginTop: 2 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  metaText: { fontSize: 13 },
  viewCountBadge: {
    marginLeft: "auto",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  viewerLine: { fontSize: 13, fontStyle: "italic" },
  websiteBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});
