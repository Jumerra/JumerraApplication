import { customFetch } from "@workspace/api-client-react";
import { Stack } from "expo-router";
import React from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";

type Req = {
  id: number;
  direction: "incoming" | "outgoing";
  status: "pending" | "accepted" | "declined";
  message: string;
  counterpart: {
    id: number;
    fullName: string;
    headline: string;
    avatarUrl: string;
    email: string | null;
  };
  createdAt: string;
};

export default function MentorRequestsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const candidateId = user?.candidateId;
  const [items, setItems] = React.useState<Req[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(() => {
    if (!candidateId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    customFetch<{ requests: Req[] }>(
      `/api/candidates/${candidateId}/mentor-requests`,
    )
      .then((d) =>
        setItems((d?.requests ?? []).filter((r) => r.direction === "incoming")),
      )
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [candidateId]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const respond = async (id: number, action: "accepted" | "declined") => {
    try {
      await customFetch(`/api/mentor-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action }),
      });
      refresh();
    } catch (err) {
      Alert.alert("Couldn't update request", (err as Error).message);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: "Mentor requests" }} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 20,
          gap: 12,
        }}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>Incoming</Text>
        {loading ? (
          <LoadingSpinner />
        ) : items.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="No requests yet"
            subtitle="When students reach out to you for mentorship, they'll appear here."
          />
        ) : (
          items.map((r) => (
            <View
              key={r.id}
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
              ]}
            >
              <Text style={[styles.name, { color: colors.foreground }]}>
                {r.counterpart.fullName}
              </Text>
              {r.counterpart.headline ? (
                <Text style={[styles.status, { color: colors.mutedForeground }]}>
                  {r.counterpart.headline}
                </Text>
              ) : null}
              <Text style={[styles.body, { color: colors.foreground }]}>{r.message}</Text>
              {r.status === "pending" ? (
                <View style={styles.row}>
                  <Pressable
                    onPress={() => respond(r.id, "declined")}
                    style={({ pressed }) => [
                      styles.btn,
                      { borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
                      Decline
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => respond(r.id, "accepted")}
                    style={({ pressed }) => [
                      styles.btn,
                      { backgroundColor: colors.primary, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }}>
                      Accept
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={[styles.status, { color: colors.mutedForeground }]}>
                  {r.status === "accepted"
                    ? "Accepted — we sent both of you an email intro."
                    : "Declined."}
                </Text>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: "Inter_700Bold", fontSize: 24, letterSpacing: -0.5, marginTop: 8 },
  card: { padding: 16, borderWidth: 1, gap: 10 },
  name: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  body: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderRadius: 8 },
  status: { fontFamily: "Inter_500Medium", fontSize: 12 },
});
