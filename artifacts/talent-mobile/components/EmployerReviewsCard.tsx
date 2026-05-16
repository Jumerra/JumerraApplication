import { Feather } from "@expo/vector-icons";
import { customFetch } from "@workspace/api-client-react";
import { Image } from "expo-image";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

type Review = {
  id: number;
  rating: number;
  body: string;
  createdAt: string;
  candidate: { id: number; fullName: string; avatarUrl: string; headline: string };
  institution: { id: number; name: string; logoUrl: string };
};

type Eligibility = {
  canReview: boolean;
  institutions: { id: number; name: string }[];
};

export function EmployerReviewsCard({ employerId }: { employerId: number }) {
  const colors = useColors();
  const [reviews, setReviews] = React.useState<Review[] | null>(null);
  const [eligibility, setEligibility] = React.useState<Eligibility | null>(null);
  const [open, setOpen] = React.useState(false);
  const [rating, setRating] = React.useState(5);
  const [body, setBody] = React.useState("");
  const [institutionId, setInstitutionId] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const reload = React.useCallback(() => {
    customFetch<{ reviews: Review[] }>(`/api/employers/${employerId}/reviews`)
      .then((d) => setReviews(d?.reviews ?? []))
      .catch(() => setReviews([]));
  }, [employerId]);

  React.useEffect(() => {
    reload();
    customFetch<Eligibility>(`/api/employers/${employerId}/reviews/eligibility`)
      .then((d) => {
        setEligibility(d ?? { canReview: false, institutions: [] });
        if (d?.canReview && d.institutions[0]) {
          setInstitutionId(d.institutions[0].id);
        }
      })
      .catch(() => setEligibility({ canReview: false, institutions: [] }));
  }, [employerId, reload]);

  const submit = async () => {
    if (body.trim().length < 20) {
      Alert.alert("Reviews must be at least 20 characters.");
      return;
    }
    if (institutionId == null) return;
    setSubmitting(true);
    try {
      await customFetch(`/api/employers/${employerId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, body: body.trim(), institutionId }),
      });
      Alert.alert("Submitted", "Your review will appear once an admin approves it.");
      setOpen(false);
      setBody("");
      reload();
    } catch (err) {
      Alert.alert("Couldn't submit", (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const grouped = (reviews ?? []).reduce<Record<string, Review[]>>((acc, r) => {
    const k = r.institution?.name ?? "Other";
    (acc[k] ||= []).push(r);
    return acc;
  }, {});

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius * 1.25,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Feather name="message-square" size={16} color={colors.foreground} />
          <Text style={[styles.title, { color: colors.foreground }]}>
            Employee reviews
          </Text>
        </View>
        {eligibility?.canReview ? (
          <Pressable
            onPress={() => setOpen(true)}
            style={({ pressed }) => [
              styles.writeBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[styles.writeBtnText, { color: colors.primaryForeground }]}>
              Write
            </Text>
          </Pressable>
        ) : null}
      </View>

      {reviews == null ? (
        <ActivityIndicator color={colors.primary} />
      ) : reviews.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          No reviews yet — only verified hires can post.
        </Text>
      ) : (
        Object.entries(grouped).map(([instName, list]) => (
          <View key={instName} style={{ gap: 8 }}>
            <Text style={[styles.groupTitle, { color: colors.mutedForeground }]}>
              From {instName} alumni
            </Text>
            {list.map((r) => (
              <View
                key={r.id}
                style={[
                  styles.review,
                  { borderColor: colors.border, borderRadius: colors.radius },
                ]}
              >
                <View style={styles.reviewHead}>
                  {r.candidate.avatarUrl ? (
                    <Image
                      source={{ uri: r.candidate.avatarUrl }}
                      style={styles.avatar}
                      contentFit="cover"
                    />
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
                      <Feather name="user" size={14} color={colors.mutedForeground} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.reviewer, { color: colors.foreground }]} numberOfLines={1}>
                      {r.candidate.fullName}
                    </Text>
                    {r.candidate.headline ? (
                      <Text
                        style={[styles.reviewerSub, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {r.candidate.headline}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: "row" }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Feather
                        key={n}
                        name="star"
                        size={12}
                        color={n <= r.rating ? "#facc15" : colors.border}
                      />
                    ))}
                  </View>
                </View>
                <Text style={[styles.body, { color: colors.foreground }]}>{r.body}</Text>
              </View>
            ))}
          </View>
        ))
      )}

      <Modal
        transparent
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
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
              Share your experience
            </Text>
            <View style={styles.row}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} onPress={() => setRating(n)} hitSlop={8}>
                  <Feather
                    name="star"
                    size={26}
                    color={n <= rating ? "#facc15" : colors.border}
                  />
                </Pressable>
              ))}
            </View>
            {(eligibility?.institutions.length ?? 0) > 1 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {eligibility!.institutions.map((i) => {
                  const active = i.id === institutionId;
                  return (
                    <Pressable
                      key={i.id}
                      onPress={() => setInstitutionId(i.id)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primary : colors.secondary,
                          borderRadius: colors.radius,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: active ? colors.primaryForeground : colors.foreground,
                          fontFamily: "Inter_500Medium",
                          fontSize: 12,
                        }}
                      >
                        {i.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="What was the work culture, growth, day-to-day actually like?"
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
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setOpen(false)}
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
                    Submit
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
  card: { padding: 16, borderWidth: 1, gap: 14 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontFamily: "Inter_700Bold", fontSize: 16 },
  writeBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  writeBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  empty: { fontFamily: "Inter_400Regular", fontSize: 13 },
  groupTitle: { fontFamily: "Inter_600SemiBold", fontSize: 12, textTransform: "uppercase" },
  review: { padding: 12, borderWidth: 1, gap: 8 },
  reviewHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  reviewer: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  reviewerSub: { fontFamily: "Inter_400Regular", fontSize: 11 },
  body: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
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
  row: { flexDirection: "row", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6 },
  input: {
    minHeight: 110,
    borderWidth: 1,
    padding: 12,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlignVertical: "top",
  },
  modalActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderRadius: 8 },
  submitBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 110,
    alignItems: "center",
  },
});
