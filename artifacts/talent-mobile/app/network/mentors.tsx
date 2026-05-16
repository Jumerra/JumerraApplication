import { Feather } from "@expo/vector-icons";
import { customFetch } from "@workspace/api-client-react";
import { Image } from "expo-image";
import { router, Stack } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";

type Mentor = {
  id: number;
  fullName: string;
  headline: string | null;
  avatarUrl: string | null;
  location: string | null;
  yearsExperience: number;
  institutions: { id: number; name: string; logoUrl: string | null }[];
  requestStatus: "pending" | "accepted" | "declined" | null;
};

export default function MentorsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const candidateId = user?.candidateId;
  const [mentors, setMentors] = React.useState<Mentor[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<Mentor | null>(null);
  const [message, setMessage] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!candidateId) {
      setLoading(false);
      return;
    }
    customFetch<{ mentors: Mentor[] }>(
      `/api/candidates/${candidateId}/mentors`,
    )
      .then((d) => setMentors(d?.mentors ?? []))
      .catch(() => setMentors([]))
      .finally(() => setLoading(false));
  }, [candidateId]);

  const submit = async () => {
    if (!selected || !candidateId) return;
    if (message.trim().length < 10) {
      Alert.alert("Add a short intro", "Tell your mentor a little about why you're reaching out (at least 10 characters).");
      return;
    }
    setSubmitting(true);
    try {
      await customFetch(
        `/api/candidates/${candidateId}/mentor-requests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mentorCandidateId: selected.id,
            message: message.trim(),
          }),
        },
      );
      setSelected(null);
      setMessage("");
      Alert.alert(
        "Request sent",
        "Your mentor will get a notification and can respond from their inbox.",
      );
    } catch (err) {
      Alert.alert("Couldn't send request", (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: "Find a mentor" }} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 20,
          gap: 14,
        }}
      >
        <View style={{ gap: 4, paddingTop: 8 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Alumni mentors</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            Verified alumni from your institution who opted in to help.
          </Text>
        </View>

        <Pressable
          onPress={() => router.push("/network/mentor-requests")}
          style={({ pressed }) => [
            styles.linkRow,
            {
              backgroundColor: colors.secondary,
              borderColor: colors.border,
              borderRadius: colors.radius,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Feather name="inbox" size={16} color={colors.foreground} />
          <Text style={[styles.linkText, { color: colors.foreground }]}>My mentor requests</Text>
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </Pressable>

        {loading ? (
          <LoadingSpinner />
        ) : mentors.length === 0 ? (
          <EmptyState
            icon="users"
            title="No mentors yet"
            subtitle="As alumni opt in at your institution, you'll see them here."
          />
        ) : (
          mentors.map((m) => (
            <View
              key={m.id}
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <View style={styles.cardHead}>
                {m.avatarUrl ? (
                  <Image source={{ uri: m.avatarUrl }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View
                    style={[
                      styles.avatar,
                      {
                        backgroundColor: colors.secondary,
                        alignItems: "center",
                        justifyContent: "center",
                      },
                    ]}
                  >
                    <Feather name="user" size={20} color={colors.mutedForeground} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                    {m.fullName}
                  </Text>
                  {m.headline ? (
                    <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {m.headline}
                    </Text>
                  ) : null}
                </View>
              </View>
              <View style={styles.metaRow}>
                {m.institutions.map((i) => (
                  <View key={i.id} style={styles.metaItem}>
                    <Feather name="award" size={12} color={colors.mutedForeground} />
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>{i.name}</Text>
                  </View>
                ))}
                {m.location ? (
                  <View style={styles.metaItem}>
                    <Feather name="map-pin" size={12} color={colors.mutedForeground} />
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>{m.location}</Text>
                  </View>
                ) : null}
              </View>
              <Pressable
                onPress={() => {
                  if (m.requestStatus) return;
                  setSelected(m);
                  setMessage("");
                }}
                disabled={!!m.requestStatus}
                style={({ pressed }) => [
                  styles.cta,
                  {
                    backgroundColor: m.requestStatus ? colors.secondary : colors.primary,
                    borderRadius: colors.radius,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.ctaText,
                    { color: m.requestStatus ? colors.secondaryForeground : colors.primaryForeground },
                  ]}
                >
                  {m.requestStatus === "accepted"
                    ? "Accepted"
                    : m.requestStatus === "declined"
                      ? "Declined"
                      : m.requestStatus === "pending"
                        ? "Request pending"
                        : "Request intro"}
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>

      <Modal
        transparent
        visible={!!selected}
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBg}
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              Message {selected?.fullName ?? "mentor"}
            </Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              They'll see your name and a one-line intro. They can accept or
              decline; if accepted you'll get an email handoff.
            </Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Hi! I'm a junior at the same institution and would love 15 minutes to ask about your career path."
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[
                styles.input,
                {
                  borderColor: colors.border,
                  color: colors.foreground,
                  backgroundColor: colors.background,
                  borderRadius: colors.radius,
                },
              ]}
            />
            <View style={styles.modalRow}>
              <Pressable
                onPress={() => setSelected(null)}
                style={({ pressed }) => [
                  styles.cancelBtn,
                  { borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.submitBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed || submitting ? 0.7 : 1,
                  },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }}>
                    Send request
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: "Inter_700Bold", fontSize: 24, letterSpacing: -0.5 },
  sub: { fontFamily: "Inter_400Regular", fontSize: 13 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  linkText: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 14 },
  card: { padding: 16, borderWidth: 1, gap: 12 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  name: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 12 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  cta: { paddingVertical: 10, alignItems: "center" },
  ctaText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  modalBg: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalCard: {
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    gap: 12,
  },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  input: {
    minHeight: 100,
    borderWidth: 1,
    padding: 12,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlignVertical: "top",
  },
  modalRow: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  submitBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 130,
    alignItems: "center",
  },
});
