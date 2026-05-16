import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { customFetch } from "@workspace/api-client-react";
import React, { useCallback, useMemo } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";

const WEB_TOP_INSET = Platform.OS === "web" ? 67 : 0;

type InboxItem = {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

const QUERY_KEY = ["inbox", "notifications"] as const;

// Notifications endpoints are not (yet) part of the OpenAPI spec, so we
// can't use the generated client. Use the same shared `customFetch` so
// requests go to the configured base URL and the AsyncStorage cookie jar
// (set up in app/_layout.tsx) is honored on native.
async function fetchInbox(): Promise<InboxItem[]> {
  const data = await customFetch<{ notifications: InboxItem[] }>(
    "/api/notifications?limit=50",
    { method: "GET" },
  );
  return data?.notifications ?? [];
}

async function markRead(id: number): Promise<void> {
  await customFetch<unknown>(`/api/notifications/${id}/read`, {
    method: "POST",
  });
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export default function InboxScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();

  const enabled = user?.role === "candidate";
  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchInbox,
    enabled,
    staleTime: 30_000,
  });

  const items = useMemo(() => data ?? [], [data]);

  const onPressItem = useCallback(
    async (item: InboxItem) => {
      if (!item.readAt) {
        try {
          await markRead(item.id);
          qc.invalidateQueries({ queryKey: QUERY_KEY });
        } catch {
          // swallow — pressing should still feel instant.
        }
      }
    },
    [qc],
  );

  if (!enabled) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="mail"
          title="Inbox"
          subtitle="Sign in as a candidate to see messages from employers."
        />
      </View>
    );
  }

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          styles.center,
          { backgroundColor: colors.background },
        ]}
      >
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={items}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{
          paddingTop: insets.top + WEB_TOP_INSET + 16,
          paddingBottom: 100,
          paddingHorizontal: 16,
        }}
        ListHeaderComponent={
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 28,
              marginBottom: 16,
            }}
          >
            Inbox
          </Text>
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => refetch()}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="mail"
            title="Nothing new yet"
            subtitle="Messages from employers will show up here."
          />
        }
        renderItem={({ item }) => {
          const unread = !item.readAt;
          return (
            <Pressable
              onPress={() => onPressItem(item)}
              style={({ pressed }) => [
                styles.row,
                {
                  borderColor: colors.border,
                  backgroundColor: unread
                    ? colors.primary + "0D"
                    : colors.card,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: colors.primary + "1A" },
                ]}
              >
                <Feather name="mail" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.rowHeader}>
                  <Text
                    style={[
                      styles.title,
                      { color: colors.foreground },
                      unread && { fontFamily: "Inter_700Bold" },
                    ]}
                    numberOfLines={1}
                  >
                    {item.title || "Message"}
                  </Text>
                  <Text
                    style={[styles.time, { color: colors.mutedForeground }]}
                  >
                    {relativeTime(item.createdAt)}
                  </Text>
                </View>
                <Text
                  style={[styles.body, { color: colors.mutedForeground }]}
                  numberOfLines={3}
                >
                  {item.body}
                </Text>
              </View>
              {unread ? (
                <View
                  style={[styles.dot, { backgroundColor: colors.primary }]}
                />
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 15, flex: 1 },
  time: { fontFamily: "Inter_500Medium", fontSize: 12 },
  body: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
});
