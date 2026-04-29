import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCandidateQueryKey,
  getGetCurrentUserQueryKey,
  useGetCandidate,
  useUpdateCandidate,
} from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";

type Availability = "open" | "employed" | "not_looking";

const AVAILABILITY_OPTIONS: Array<{ value: Availability; label: string }> = [
  { value: "open", label: "Open" },
  { value: "employed", label: "Employed" },
  { value: "not_looking", label: "Not looking" },
];

const HEADLINE_MAX = 120;
const BIO_MAX = 1000;
const SKILL_MAX = 30;
const SKILLS_MAX_COUNT = 30;

export default function ProfileEditScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const candidateId = user?.candidateId ?? 0;
  const hasCandidateRecord =
    user?.role === "candidate" && user.candidateId != null;

  const {
    data: candidate,
    isLoading,
    isError,
  } = useGetCandidate(candidateId, {
    query: {
      queryKey: getGetCandidateQueryKey(candidateId),
      enabled: hasCandidateRecord,
    },
  });

  const updateMutation = useUpdateCandidate();

  const [fullName, setFullName] = React.useState("");
  const [headline, setHeadline] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [yearsExperienceText, setYearsExperienceText] = React.useState("0");
  const [availability, setAvailability] = React.useState<Availability>("open");
  const [bio, setBio] = React.useState("");
  const [skills, setSkills] = React.useState<string[]>([]);
  const [skillDraft, setSkillDraft] = React.useState("");
  const [hydrated, setHydrated] = React.useState(false);

  // Hydrate the form once the candidate loads. We use a flag so the user's
  // edits aren't blown away on a background refetch.
  React.useEffect(() => {
    if (!candidate || hydrated) return;
    setFullName(candidate.fullName ?? "");
    setHeadline(candidate.headline ?? "");
    setLocation(candidate.location ?? "");
    setPhone(candidate.phone ?? "");
    setYearsExperienceText(String(candidate.yearsExperience ?? 0));
    setAvailability((candidate.availability as Availability) ?? "open");
    setBio(candidate.bio ?? "");
    setSkills(Array.isArray(candidate.skills) ? [...candidate.skills] : []);
    setHydrated(true);
  }, [candidate, hydrated]);

  const trimmedFullName = fullName.trim();
  const yearsExperienceNum = Number(yearsExperienceText);
  const yearsExperienceValid =
    Number.isInteger(yearsExperienceNum) &&
    yearsExperienceNum >= 0 &&
    yearsExperienceNum <= 80;

  const canSave =
    hasCandidateRecord &&
    trimmedFullName.length > 0 &&
    yearsExperienceValid &&
    !updateMutation.isPending;

  const addSkill = React.useCallback(() => {
    const next = skillDraft.trim();
    if (!next) return;
    if (next.length > SKILL_MAX) {
      Alert.alert("Skill is too long", `Keep skills under ${SKILL_MAX} characters.`);
      return;
    }
    if (skills.length >= SKILLS_MAX_COUNT) {
      Alert.alert(
        "Skill limit reached",
        `You can add up to ${SKILLS_MAX_COUNT} skills.`,
      );
      return;
    }
    const exists = skills.some(
      (s) => s.toLowerCase() === next.toLowerCase(),
    );
    if (exists) {
      setSkillDraft("");
      return;
    }
    setSkills((prev) => [...prev, next]);
    setSkillDraft("");
  }, [skillDraft, skills]);

  const removeSkill = React.useCallback((skill: string) => {
    setSkills((prev) => prev.filter((s) => s !== skill));
  }, []);

  const handleSave = React.useCallback(() => {
    if (!canSave || !hasCandidateRecord) return;

    updateMutation.mutate(
      {
        id: candidateId,
        data: {
          fullName: trimmedFullName,
          headline: headline.trim(),
          location: location.trim(),
          phone: phone.trim(),
          bio: bio.trim(),
          yearsExperience: yearsExperienceNum,
          availability,
          skills,
        },
      },
      {
        onSuccess: () => {
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            ).catch(() => {});
          }
          // Invalidate the candidate detail and the session user so any
          // header/avatar/name surfaces refresh too.
          void queryClient.invalidateQueries({
            queryKey: getGetCandidateQueryKey(candidateId),
          });
          void queryClient.invalidateQueries({
            queryKey: getGetCurrentUserQueryKey(),
          });
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace("/(tabs)/profile");
          }
        },
        onError: (err: unknown) => {
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Error,
            ).catch(() => {});
          }
          const message =
            err instanceof Error
              ? err.message
              : "We couldn't save your changes. Please try again.";
          Alert.alert("Couldn't save profile", message);
        },
      },
    );
  }, [
    canSave,
    hasCandidateRecord,
    updateMutation,
    candidateId,
    trimmedFullName,
    headline,
    location,
    phone,
    bio,
    yearsExperienceNum,
    availability,
    skills,
    queryClient,
  ]);

  if (!user || !hasCandidateRecord) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="user-x"
          title="Profile not editable"
          subtitle="Sign in with a candidate account to edit your profile."
        />
      </View>
    );
  }

  // Order matters: check isError first, otherwise a failed fetch
  // (isError=true, candidate=undefined, isLoading=false) would fall through
  // to the loading branch and trap the user on a perpetual spinner.
  if (isError) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="alert-circle"
          title="Profile unavailable"
          subtitle="We couldn't load your profile right now. Please try again in a moment."
        />
      </View>
    );
  }

  if (isLoading || !candidate) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: insets.bottom + 120,
          gap: 18,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Field
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your full name"
          autoCapitalize="words"
          maxLength={120}
        />

        <Field
          label="Headline"
          value={headline}
          onChangeText={setHeadline}
          placeholder="e.g. Senior React Native Developer"
          autoCapitalize="sentences"
          maxLength={HEADLINE_MAX}
          helper={`${headline.length}/${HEADLINE_MAX}`}
        />

        <Field
          label="Location"
          value={location}
          onChangeText={setLocation}
          placeholder="City, Country"
          autoCapitalize="words"
          maxLength={120}
        />

        <Field
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          placeholder="Phone number"
          keyboardType="phone-pad"
          maxLength={32}
        />

        <Field
          label="Years of experience"
          value={yearsExperienceText}
          onChangeText={(t) =>
            setYearsExperienceText(t.replace(/[^0-9]/g, "").slice(0, 2))
          }
          placeholder="0"
          keyboardType="number-pad"
          error={
            yearsExperienceText.length === 0 || yearsExperienceValid
              ? undefined
              : "Enter a whole number between 0 and 80"
          }
        />

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.foreground }]}>
            Availability
          </Text>
          <View
            style={[
              styles.segmented,
              {
                backgroundColor: colors.secondary,
                borderColor: colors.border,
                borderRadius: colors.radius * 1.25,
              },
            ]}
          >
            {AVAILABILITY_OPTIONS.map((opt) => {
              const active = availability === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setAvailability(opt.value)}
                  style={({ pressed }) => [
                    styles.segment,
                    {
                      backgroundColor: active
                        ? colors.primary
                        : "transparent",
                      borderRadius: colors.radius,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text
                    style={{
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                      color: active
                        ? colors.primaryForeground
                        : colors.secondaryForeground,
                    }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.foreground }]}>About</Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder="Tell employers a little about yourself"
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={5}
            maxLength={BIO_MAX}
            style={[
              styles.input,
              styles.multiline,
              {
                color: colors.foreground,
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius * 1.25,
              },
            ]}
          />
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            {bio.length}/{BIO_MAX}
          </Text>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.foreground }]}>
            Skills
          </Text>
          <View style={styles.skillRow}>
            <TextInput
              value={skillDraft}
              onChangeText={setSkillDraft}
              onSubmitEditing={addSkill}
              placeholder="Add a skill (e.g. React)"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              returnKeyType="done"
              maxLength={SKILL_MAX}
              style={[
                styles.input,
                {
                  flex: 1,
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius * 1.25,
                },
              ]}
            />
            <Pressable
              onPress={addSkill}
              disabled={skillDraft.trim().length === 0}
              style={({ pressed }) => [
                styles.addButton,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius * 1.25,
                  opacity:
                    pressed || skillDraft.trim().length === 0 ? 0.6 : 1,
                },
              ]}
            >
              <Feather
                name="plus"
                size={18}
                color={colors.primaryForeground}
              />
            </Pressable>
          </View>
          {skills.length > 0 ? (
            <View style={styles.chipCloud}>
              {skills.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => removeSkill(s)}
                  style={({ pressed }) => [
                    styles.skillChip,
                    {
                      backgroundColor: colors.secondary,
                      borderColor: colors.border,
                      borderRadius: 999,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text
                    style={{
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 12,
                      color: colors.secondaryForeground,
                    }}
                  >
                    {s}
                  </Text>
                  <Feather
                    name="x"
                    size={12}
                    color={colors.mutedForeground}
                  />
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>
              Tap a skill to remove it.
            </Text>
          )}
        </View>
      </KeyboardAwareScrollViewCompat>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/profile");
          }}
          disabled={updateMutation.isPending}
          style={({ pressed }) => [
            styles.cancelButton,
            {
              backgroundColor: colors.secondary,
              borderColor: colors.border,
              borderRadius: colors.radius * 1.25,
              opacity: pressed || updateMutation.isPending ? 0.85 : 1,
            },
          ]}
        >
          <Text
            style={{
              fontFamily: "Inter_600SemiBold",
              fontSize: 14,
              color: colors.foreground,
            }}
          >
            Cancel
          </Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          style={({ pressed }) => [
            styles.saveButton,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius * 1.25,
              opacity: pressed || !canSave ? 0.6 : 1,
            },
          ]}
        >
          {updateMutation.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather
                name="check"
                size={16}
                color={colors.primaryForeground}
              />
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                  color: colors.primaryForeground,
                }}
              >
                Save changes
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: React.ComponentProps<typeof TextInput>["keyboardType"];
  maxLength?: number;
  helper?: string;
  error?: string;
};

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize = "sentences",
  keyboardType,
  maxLength,
  helper,
  error,
}: FieldProps) {
  const colors = useColors();
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        maxLength={maxLength}
        style={[
          styles.input,
          {
            color: colors.foreground,
            backgroundColor: colors.card,
            borderColor: error ? colors.destructive ?? "#dc2626" : colors.border,
            borderRadius: colors.radius * 1.25,
          },
        ]}
      />
      {error ? (
        <Text style={[styles.helper, { color: colors.destructive ?? "#dc2626" }]}>
          {error}
        </Text>
      ) : helper ? (
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fieldGroup: { gap: 8 },
  label: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    minHeight: 46,
  },
  multiline: {
    minHeight: 110,
    paddingTop: 12,
    textAlignVertical: "top",
  },
  helper: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
  },
  segmented: {
    flexDirection: "row",
    padding: 4,
    borderWidth: 1,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  skillRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "stretch",
  },
  addButton: {
    width: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  chipCloud: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  skillChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  cancelButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderWidth: 1,
  },
  saveButton: {
    flex: 1.4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
});
