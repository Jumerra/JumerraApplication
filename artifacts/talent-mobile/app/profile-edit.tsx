import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCandidateQueryKey,
  getGetCurrentUserQueryKey,
  requestUploadUrl,
  useGetCandidate,
  useGetInstitution,
  useUpdateCandidate,
} from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
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
import { avatarSrc } from "@/lib/avatar";

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
const EDUCATION_TEXT_MAX = 200;
const YEAR_MIN = 1900;
const YEAR_MAX = 2100;
const EDUCATION_MAX_COUNT = 20;

// Local-only stable id for education drafts. Existing entries keep the
// server id; new ones get a "new-<n>" key so React lists stay stable
// even before the row is persisted.
let nextEduKey = 1;
const makeEduKey = () => `new-${nextEduKey++}`;

type EduDraft = {
  key: string;
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startYearText: string;
  endYearText: string; // empty string means "Present"
};

function eduDraftValid(d: EduDraft): boolean {
  if (d.institution.trim().length === 0) return false;
  if (d.degree.trim().length === 0) return false;
  if (d.fieldOfStudy.trim().length === 0) return false;
  const sy = Number(d.startYearText);
  if (!Number.isInteger(sy) || sy < YEAR_MIN || sy > YEAR_MAX) return false;
  if (d.endYearText.length > 0) {
    const ey = Number(d.endYearText);
    if (!Number.isInteger(ey) || ey < YEAR_MIN || ey > YEAR_MAX) return false;
    if (ey < sy) return false;
  }
  return true;
}

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
  const [avatarUrl, setAvatarUrl] = React.useState<string>("");
  // institutionId -> selected departmentId (null = "Not assigned")
  const [deptByInst, setDeptByInst] = React.useState<
    Record<number, number | null>
  >({});
  const [educationDrafts, setEducationDrafts] = React.useState<EduDraft[]>([]);
  const [avatarUploading, setAvatarUploading] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);
  // Synchronous in-flight guard. State updates are async, so a fast
  // double-tap on the avatar can re-enter pickAndUploadAvatar before
  // setAvatarUploading(true) has flushed. A ref is set/cleared
  // synchronously and prevents that race.
  const uploadInFlightRef = React.useRef(false);

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
    setAvatarUrl(candidate.avatarUrl ?? "");
    const initialDept: Record<number, number | null> = {};
    for (const inst of candidate.institutions ?? []) {
      initialDept[inst.id] = inst.departmentId ?? null;
    }
    setDeptByInst(initialDept);
    setEducationDrafts(
      (candidate.education ?? []).map((e) => ({
        key: `srv-${e.id}`,
        institution: e.institution,
        degree: e.degree,
        fieldOfStudy: e.fieldOfStudy,
        startYearText: String(e.startYear),
        endYearText: e.endYear != null ? String(e.endYear) : "",
      })),
    );
    setHydrated(true);
  }, [candidate, hydrated]);

  const trimmedFullName = fullName.trim();
  const yearsExperienceNum = Number(yearsExperienceText);
  const yearsExperienceValid =
    Number.isInteger(yearsExperienceNum) &&
    yearsExperienceNum >= 0 &&
    yearsExperienceNum <= 80;

  const educationValid = educationDrafts.every(eduDraftValid);

  const canSave =
    hasCandidateRecord &&
    trimmedFullName.length > 0 &&
    yearsExperienceValid &&
    educationValid &&
    !updateMutation.isPending &&
    !avatarUploading;

  const updateEducationDraft = React.useCallback(
    (key: string, patch: Partial<EduDraft>) => {
      setEducationDrafts((prev) =>
        prev.map((d) => (d.key === key ? { ...d, ...patch } : d)),
      );
    },
    [],
  );

  const addEducationDraft = React.useCallback(() => {
    setEducationDrafts((prev) => {
      if (prev.length >= EDUCATION_MAX_COUNT) {
        Alert.alert(
          "Education limit reached",
          `You can add up to ${EDUCATION_MAX_COUNT} education entries.`,
        );
        return prev;
      }
      return [
        ...prev,
        {
          key: makeEduKey(),
          institution: "",
          degree: "",
          fieldOfStudy: "",
          startYearText: "",
          endYearText: "",
        },
      ];
    });
  }, []);

  const removeEducationDraft = React.useCallback((key: string) => {
    const doRemove = () =>
      setEducationDrafts((prev) => prev.filter((d) => d.key !== key));
    // Alert.alert with multiple buttons is unreliable on Expo Web. Use the
    // browser's native confirm there and Alert.alert on native platforms.
    if (Platform.OS === "web") {
      const ok =
        typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm(
              "Remove this education entry? It will be removed from your profile when you save.",
            )
          : true;
      if (ok) doRemove();
      return;
    }
    Alert.alert(
      "Remove education entry?",
      "This entry will be removed from your profile when you save.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: doRemove },
      ],
    );
  }, []);

  const setDepartmentForInstitution = React.useCallback(
    (institutionId: number, departmentId: number | null) => {
      setDeptByInst((prev) => ({ ...prev, [institutionId]: departmentId }));
    },
    [],
  );

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

  const pickAndUploadAvatar = React.useCallback(async () => {
    // Synchronous re-entry guard. setAvatarUploading is async; the ref is
    // not, so a double-tap still hits this guard reliably.
    if (uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    try {
      // On native, ask for media-library permission. On web this is a no-op
      // (the browser file picker is permission-less).
      if (Platform.OS !== "web") {
        const perm =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            "Permission needed",
            "We need access to your photos so you can choose a profile picture.",
          );
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;

      // Resolve the binary. RN supports `fetch(uri).blob()` on both web
      // and native runtimes.
      const fileResp = await fetch(asset.uri);
      const blob = await fileResp.blob();
      const size =
        typeof asset.fileSize === "number" && asset.fileSize > 0
          ? asset.fileSize
          : blob.size;
      const contentType =
        asset.mimeType ||
        (blob.type && blob.type !== "" ? blob.type : "image/jpeg");
      const name =
        asset.fileName ||
        `avatar.${contentType.split("/")[1] ?? "jpg"}`;

      // Server allowlist: png/jpg/jpeg/gif/webp; max 10MB.
      const allowed = new Set([
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/gif",
        "image/webp",
      ]);
      if (!allowed.has(contentType.toLowerCase())) {
        Alert.alert(
          "Unsupported image",
          "Please choose a PNG, JPEG, GIF, or WebP image.",
        );
        return;
      }
      if (size > 10 * 1024 * 1024) {
        Alert.alert(
          "Image too large",
          "Please choose an image under 10 MB.",
        );
        return;
      }

      setAvatarUploading(true);

      // Step 1: ask the API for a presigned PUT URL.
      const upload = await requestUploadUrl({ name, size, contentType });

      // Step 2: PUT the bytes directly to GCS. Note: GCS presigned PUTs
      // require the same Content-Type that the URL was signed for; the
      // server signs without a content-type constraint, but setting one
      // here is still correct for GCS to store the metadata.
      const putResp = await fetch(upload.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: blob,
      });
      if (!putResp.ok) {
        throw new Error(`Upload failed (${putResp.status})`);
      }

      setAvatarUrl(upload.objectPath);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "We couldn't upload your photo. Please try again.";
      Alert.alert("Upload failed", message);
    } finally {
      uploadInFlightRef.current = false;
      setAvatarUploading(false);
    }
  }, []);

  const handleSave = React.useCallback(() => {
    if (!canSave || !hasCandidateRecord) return;

    // Affiliations: only send rows whose departmentId actually changed,
    // so the request stays a no-op on the junction table when the user
    // didn't touch the department picker.
    const affiliations = (candidate?.institutions ?? [])
      .filter((inst) => {
        const original = inst.departmentId ?? null;
        const current = deptByInst[inst.id] ?? null;
        return original !== current;
      })
      .map((inst) => ({
        institutionId: inst.id,
        departmentId: deptByInst[inst.id] ?? null,
      }));

    // Education: full replacement. We always send the array (even when
    // empty) so a user clearing all entries persists correctly.
    const education = educationDrafts.map((d) => ({
      institution: d.institution.trim(),
      degree: d.degree.trim(),
      fieldOfStudy: d.fieldOfStudy.trim(),
      startYear: Number(d.startYearText),
      endYear: d.endYearText.length > 0 ? Number(d.endYearText) : null,
    }));

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
          avatarUrl,
          ...(affiliations.length > 0 ? { affiliations } : {}),
          education,
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
    avatarUrl,
    candidate,
    deptByInst,
    educationDrafts,
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
        <View style={styles.avatarSection}>
          <Pressable
            onPress={pickAndUploadAvatar}
            disabled={avatarUploading}
            accessibilityLabel="Change profile photo"
            style={({ pressed }) => [
              styles.avatarWrap,
              {
                backgroundColor: colors.secondary,
                borderColor: colors.border,
                opacity: pressed && !avatarUploading ? 0.85 : 1,
              },
            ]}
          >
            {avatarSrc(avatarUrl) ? (
              <Image
                source={{ uri: avatarSrc(avatarUrl) }}
                style={styles.avatar}
                contentFit="cover"
                transition={150}
              />
            ) : (
              <Feather
                name="user"
                size={42}
                color={colors.mutedForeground}
              />
            )}
            <View
              style={[
                styles.avatarBadge,
                {
                  backgroundColor: colors.primary,
                  borderColor: colors.background,
                },
              ]}
            >
              {avatarUploading ? (
                <ActivityIndicator
                  size="small"
                  color={colors.primaryForeground}
                />
              ) : (
                <Feather
                  name="camera"
                  size={14}
                  color={colors.primaryForeground}
                />
              )}
            </View>
          </Pressable>
          <Text style={[styles.avatarHelper, { color: colors.mutedForeground }]}>
            {avatarUploading
              ? "Uploading..."
              : "Tap to change profile photo"}
          </Text>
        </View>

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

        {candidate.institutions && candidate.institutions.length > 0 ? (
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>
              Affiliated institutions
            </Text>
            <Text style={[styles.helper, { color: colors.mutedForeground }]}>
              Pick the department or program you&apos;re enrolled in at each
              institution.
            </Text>
            <View style={{ gap: 12, marginTop: 4 }}>
              {candidate.institutions.map((inst) => (
                <InstitutionAffiliationRow
                  key={inst.id}
                  institutionId={inst.id}
                  institutionName={inst.name}
                  institutionType={inst.type}
                  isPrimary={inst.isPrimary}
                  selectedDepartmentId={deptByInst[inst.id] ?? null}
                  onChange={(deptId) =>
                    setDepartmentForInstitution(inst.id, deptId)
                  }
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.fieldGroup}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={[styles.label, { color: colors.foreground }]}>
              Education
            </Text>
            <Pressable
              onPress={addEducationDraft}
              accessibilityLabel="Add education entry"
              style={({ pressed }) => [
                styles.addEduButton,
                {
                  backgroundColor: colors.secondary,
                  borderColor: colors.border,
                  borderRadius: colors.radius * 1.25,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Feather name="plus" size={14} color={colors.foreground} />
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 12,
                  color: colors.foreground,
                }}
              >
                Add
              </Text>
            </Pressable>
          </View>
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
            Self-reported degrees, diplomas, and programs.
          </Text>
          {educationDrafts.length === 0 ? (
            <Text
              style={[
                styles.helper,
                { color: colors.mutedForeground, marginTop: 6 },
              ]}
            >
              No entries yet. Tap Add to share your education history.
            </Text>
          ) : (
            <View style={{ gap: 14, marginTop: 4 }}>
              {educationDrafts.map((d) => (
                <EducationDraftCard
                  key={d.key}
                  draft={d}
                  onChange={(patch) => updateEducationDraft(d.key, patch)}
                  onRemove={() => removeEducationDraft(d.key)}
                />
              ))}
            </View>
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

// Renders a single affiliated-institution row with a department picker.
// Each instance owns its own `useGetInstitution` query so we don't have
// to use `useQueries` (which is awkward here because hooks must be called
// at top level and the institution count comes from server data).
function InstitutionAffiliationRow({
  institutionId,
  institutionName,
  institutionType,
  isPrimary,
  selectedDepartmentId,
  onChange,
}: {
  institutionId: number;
  institutionName: string;
  institutionType: string;
  isPrimary: boolean;
  selectedDepartmentId: number | null;
  onChange: (departmentId: number | null) => void;
}) {
  const colors = useColors();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const { data: detail, isLoading } = useGetInstitution(institutionId);
  const departments = detail?.departments ?? [];
  // SHS schools are organized by "Programs"; everything else by "Departments".
  // We accept the broader institution `type` string and only branch on "shs".
  const singularLabel = institutionType === "shs" ? "Program" : "Department";

  const selectedName =
    selectedDepartmentId != null
      ? (departments.find((d) => d.id === selectedDepartmentId)?.name ??
        `${singularLabel} #${selectedDepartmentId}`)
      : null;

  const options: Array<{ id: number | null; label: string }> = [
    { id: null, label: "Not assigned" },
    ...departments.map((d) => ({ id: d.id as number | null, label: d.name })),
  ];

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: colors.radius * 1.25,
        backgroundColor: colors.card,
        padding: 12,
        gap: 8,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <Text
          style={{
            fontFamily: "Inter_600SemiBold",
            fontSize: 14,
            color: colors.foreground,
            flexShrink: 1,
          }}
          numberOfLines={1}
        >
          {institutionName}
        </Text>
        {isPrimary ? (
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 999,
              backgroundColor: colors.primary,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter_600SemiBold",
                fontSize: 10,
                color: colors.primaryForeground,
                letterSpacing: 0.3,
              }}
            >
              PRIMARY
            </Text>
          </View>
        ) : null}
      </View>

      <Pressable
        onPress={() => setPickerOpen(true)}
        disabled={isLoading || departments.length === 0}
        style={({ pressed }) => [
          styles.input,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
            borderRadius: colors.radius * 1.25,
            opacity:
              pressed || isLoading || departments.length === 0 ? 0.7 : 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: 10,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Choose ${singularLabel.toLowerCase()} for ${institutionName}`}
      >
        <Text
          style={{
            fontFamily: "Inter_500Medium",
            fontSize: 14,
            color: selectedName ? colors.foreground : colors.mutedForeground,
            flex: 1,
          }}
          numberOfLines={1}
        >
          {isLoading
            ? `Loading ${singularLabel.toLowerCase()}s...`
            : departments.length === 0
              ? `No ${singularLabel.toLowerCase()}s available`
              : (selectedName ?? `Choose a ${singularLabel.toLowerCase()}`)}
        </Text>
        <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
      </Pressable>

      <PickerModal
        visible={pickerOpen}
        title={`Choose ${singularLabel.toLowerCase()}`}
        options={options}
        selectedId={selectedDepartmentId}
        onClose={() => setPickerOpen(false)}
        onSelect={(id) => {
          onChange(id);
          setPickerOpen(false);
        }}
      />
    </View>
  );
}

// Inline editor for a single self-reported education entry. Validation
// is handled at the parent (canSave); we surface inline errors per field
// so the user knows which row blocks the save.
function EducationDraftCard({
  draft,
  onChange,
  onRemove,
}: {
  draft: EduDraft;
  onChange: (patch: Partial<EduDraft>) => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  const startNum = Number(draft.startYearText);
  const startYearError =
    draft.startYearText.length === 0
      ? undefined
      : Number.isInteger(startNum) && startNum >= YEAR_MIN && startNum <= YEAR_MAX
        ? undefined
        : `Enter a year between ${YEAR_MIN} and ${YEAR_MAX}`;
  const endNum = Number(draft.endYearText);
  const endYearError =
    draft.endYearText.length === 0
      ? undefined
      : !Number.isInteger(endNum) || endNum < YEAR_MIN || endNum > YEAR_MAX
        ? `Enter a year between ${YEAR_MIN} and ${YEAR_MAX}`
        : Number.isInteger(startNum) && endNum < startNum
          ? "End year is before start year"
          : undefined;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: colors.radius * 1.25,
        backgroundColor: colors.card,
        padding: 12,
        gap: 10,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text
          style={{
            fontFamily: "Inter_600SemiBold",
            fontSize: 12,
            color: colors.mutedForeground,
            letterSpacing: 0.3,
          }}
        >
          EDUCATION ENTRY
        </Text>
        <Pressable
          onPress={onRemove}
          accessibilityLabel="Remove education entry"
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Feather name="trash-2" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>
      <Field
        label="Institution"
        value={draft.institution}
        onChangeText={(t) => onChange({ institution: t })}
        placeholder="e.g. Northstar University"
        autoCapitalize="words"
        maxLength={EDUCATION_TEXT_MAX}
      />
      <Field
        label="Degree"
        value={draft.degree}
        onChangeText={(t) => onChange({ degree: t })}
        placeholder="e.g. BSc, Diploma, Certificate"
        autoCapitalize="words"
        maxLength={EDUCATION_TEXT_MAX}
      />
      <Field
        label="Field of study"
        value={draft.fieldOfStudy}
        onChangeText={(t) => onChange({ fieldOfStudy: t })}
        placeholder="e.g. Computer Science"
        autoCapitalize="words"
        maxLength={EDUCATION_TEXT_MAX}
      />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Start year"
            value={draft.startYearText}
            onChangeText={(t) =>
              onChange({ startYearText: t.replace(/[^0-9]/g, "").slice(0, 4) })
            }
            placeholder="2021"
            keyboardType="number-pad"
            maxLength={4}
            error={startYearError}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="End year"
            value={draft.endYearText}
            onChangeText={(t) =>
              onChange({ endYearText: t.replace(/[^0-9]/g, "").slice(0, 4) })
            }
            placeholder="Present"
            keyboardType="number-pad"
            maxLength={4}
            error={endYearError}
            helper={
              draft.endYearText.length === 0 && !endYearError
                ? "Leave blank if ongoing"
                : undefined
            }
          />
        </View>
      </View>
    </View>
  );
}

// Reusable bottom-sheet style picker. Keeps native UX consistent across
// affiliations (and any future single-select fields) without pulling in
// a picker library.
function PickerModal({
  visible,
  title,
  options,
  selectedId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: Array<{ id: number | null; label: string }>;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.4)",
          justifyContent: "flex-end",
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingTop: 8,
            paddingBottom: insets.bottom + 12,
            maxHeight: "70%",
          }}
        >
          <View
            style={{
              alignSelf: "center",
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.border,
              marginBottom: 8,
            }}
          />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingVertical: 12,
            }}
          >
            <Text
              style={{
                fontFamily: "Inter_700Bold",
                fontSize: 16,
                color: colors.foreground,
              }}
            >
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityLabel="Close picker"
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <FlatList
            data={options}
            keyExtractor={(item) => `${item.id ?? "none"}`}
            renderItem={({ item }) => {
              const active = item.id === selectedId;
              return (
                <Pressable
                  onPress={() => onSelect(item.id)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 20,
                    paddingVertical: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    backgroundColor: pressed ? colors.secondary : "transparent",
                  })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    style={{
                      fontFamily: active
                        ? "Inter_600SemiBold"
                        : "Inter_500Medium",
                      fontSize: 15,
                      color: colors.foreground,
                      flex: 1,
                    }}
                  >
                    {item.label}
                  </Text>
                  {active ? (
                    <Feather name="check" size={18} color={colors.primary} />
                  ) : null}
                </Pressable>
              );
            }}
            ItemSeparatorComponent={() => (
              <View
                style={{
                  height: 1,
                  backgroundColor: colors.border,
                  marginHorizontal: 20,
                }}
              />
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  avatarSection: {
    alignItems: "center",
    gap: 8,
    paddingTop: 4,
    paddingBottom: 8,
  },
  avatarWrap: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
    borderWidth: 1,
    position: "relative",
  },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
  },
  avatarBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  avatarHelper: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
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
  addEduButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
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
