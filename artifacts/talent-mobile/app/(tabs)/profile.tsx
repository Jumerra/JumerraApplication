import { Feather } from "@expo/vector-icons";
import {
  getGetCandidateQueryKey,
  getGetBoostSettingsQueryKey,
  getGetCvSettingsQueryKey,
  getGetCandidateCvQueryKey,
  useGetCandidate,
  useGetBoostSettings,
  useGetCvSettings,
  useGetCandidateCv,
  useCreateBoostCheckout,
  useVerifyBoostCheckout,
  useCreateCvCheckout,
  useVerifyCvCheckout,
  useGenerateCandidateCv,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Image } from "expo-image";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { SkillChip } from "@/components/SkillChip";
import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";
import { avatarSrc } from "@/lib/avatar";

const WEB_TOP_INSET = Platform.OS === "web" ? 67 : 0;

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, signOut, signOutPending } = useAuth();
  const onSignOut = React.useCallback(() => {
    void signOut().catch(() => {
      Alert.alert(
        "Couldn't sign out",
        "We couldn't sign you out. Check your connection and try again.",
      );
    });
  }, [signOut]);

  const isCandidateRole = user?.role === "candidate";
  const candidateId = user?.candidateId ?? 0;
  const hasCandidateRecord = isCandidateRole && user.candidateId != null;
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

  if (user && !isCandidateRole) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="user-x"
          title="Candidate-only view"
          subtitle="The mobile app is built for candidates. Sign in with a candidate account to see your profile."
        />
        <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 32 }}>
          <SignOutButton onPress={onSignOut} pending={signOutPending} />
        </View>
      </View>
    );
  }

  if (user && isCandidateRole && !hasCandidateRecord) {
    // Legacy candidate accounts created before the auto-link change won't
    // have a candidateId yet. Show a recovery state instead of locking
    // them out, and let them sign out so support can repair the account.
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="user-check"
          title="Profile not ready yet"
          subtitle="Your candidate profile hasn't been set up. Please contact support so we can finish creating it."
        />
        <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 32 }}>
          <SignOutButton onPress={onSignOut} pending={signOutPending} />
        </View>
      </View>
    );
  }

  if (isLoading || !user) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <LoadingSpinner />
      </View>
    );
  }

  if (isError || !candidate) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="alert-circle"
          title="Profile unavailable"
          subtitle="We couldn't load your profile right now. Please try again in a moment."
        />
        <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 32 }}>
          <SignOutButton onPress={onSignOut} pending={signOutPending} />
        </View>
      </View>
    );
  }

  const isOpen = candidate.availability === "open";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + WEB_TOP_INSET + 8,
        paddingBottom: insets.bottom + 120,
        paddingHorizontal: 20,
        gap: 20,
      }}
    >
      <View style={styles.editButtonRow}>
        <Pressable
          onPress={() => router.push("/profile-edit")}
          style={({ pressed }) => [
            styles.editButton,
            {
              backgroundColor: colors.secondary,
              borderColor: colors.border,
              borderRadius: colors.radius * 1.25,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          accessibilityLabel="Edit profile"
        >
          <Feather name="edit-2" size={14} color={colors.foreground} />
          <Text style={[styles.editButtonText, { color: colors.foreground }]}>
            Edit
          </Text>
        </Pressable>
      </View>

      <View style={styles.heroWrap}>
        <View
          style={[
            styles.avatarWrap,
            { backgroundColor: colors.secondary, borderColor: colors.border },
          ]}
        >
          {avatarSrc(candidate.avatarUrl) ? (
            <Image
              source={{ uri: avatarSrc(candidate.avatarUrl) }}
              style={styles.avatar}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <Feather name="user" size={48} color={colors.mutedForeground} />
          )}
        </View>
        <Text style={[styles.name, { color: colors.foreground }]}>
          {candidate.fullName}
        </Text>
        {candidate.headline ? (
          <Text style={[styles.headline, { color: colors.mutedForeground }]}>
            {candidate.headline}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          {candidate.location ? (
            <View
              style={[
                styles.metaPill,
                {
                  backgroundColor: colors.secondary,
                  borderRadius: colors.radius * 2,
                },
              ]}
            >
              <Feather
                name="map-pin"
                size={12}
                color={colors.mutedForeground}
              />
              <Text
                style={[styles.metaText, { color: colors.secondaryForeground }]}
              >
                {candidate.location}
              </Text>
            </View>
          ) : null}
          <View
            style={[
              styles.metaPill,
              {
                backgroundColor: isOpen ? colors.primary : colors.secondary,
                borderRadius: colors.radius * 2,
              },
            ]}
          >
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: isOpen
                    ? colors.primaryForeground
                    : colors.mutedForeground,
                },
              ]}
            />
            <Text
              style={[
                styles.metaText,
                {
                  color: isOpen
                    ? colors.primaryForeground
                    : colors.secondaryForeground,
                },
              ]}
            >
              {isOpen
                ? "Open to work"
                : candidate.availability === "employed"
                  ? "Employed"
                  : "Not looking"}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.scoreRow}>
        <View
          style={[
            styles.scoreCard,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius * 1.5,
            },
          ]}
        >
          <Text
            style={[styles.scoreLabel, { color: colors.primaryForeground }]}
          >
            Talent Score
          </Text>
          <Text
            style={[styles.scoreValue, { color: colors.primaryForeground }]}
          >
            {candidate.talentScore}
          </Text>
        </View>
        <View
          style={[
            styles.scoreCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: colors.radius * 1.5,
            },
          ]}
        >
          <Text style={[styles.scoreLabel, { color: colors.mutedForeground }]}>
            Profile
          </Text>
          <Text style={[styles.scoreValue, { color: colors.foreground }]}>
            {candidate.talentScore}%
          </Text>
        </View>
      </View>

      {candidate.skills?.length ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Skills
          </Text>
          <View style={styles.chipCloud}>
            {candidate.skills.map((s) => (
              <SkillChip key={s} label={s} />
            ))}
          </View>
        </View>
      ) : null}

      {candidate.bio ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            About
          </Text>
          <Text style={[styles.bio, { color: colors.mutedForeground }]}>
            {candidate.bio}
          </Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Details
        </Text>
        <View
          style={[
            styles.infoCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius * 1.5,
            },
          ]}
        >
          <InfoRow
            icon="briefcase"
            label="Experience"
            value={`${candidate.yearsExperience} ${
              candidate.yearsExperience === 1 ? "year" : "years"
            }`}
          />
          <Divider />
          <InfoRow icon="mail" label="Email" value={candidate.email} />
          <Divider />
          <InfoRow icon="phone" label="Phone" value={candidate.phone} />
          {candidate.institutions && candidate.institutions.length > 0 ? (
            <>
              <Divider />
              <InstitutionsRow institutions={candidate.institutions} />
            </>
          ) : candidate.institutionName ? (
            <>
              <Divider />
              <InfoRow
                icon="book"
                label="Institution"
                value={candidate.institutionName}
              />
            </>
          ) : null}
        </View>
      </View>

      {candidate.education && candidate.education.length > 0 ? (
        <EducationSection entries={candidate.education} />
      ) : null}

      <PremiumSection candidateId={candidateId} />

      <SignOutButton onPress={onSignOut} pending={signOutPending} />
    </ScrollView>
  );
}

function SignOutButton({
  onPress,
  pending,
}: {
  onPress: () => void;
  pending: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={pending}
      style={({ pressed }) => [
        styles.signOutButton,
        {
          backgroundColor: colors.secondary,
          borderColor: colors.border,
          borderRadius: colors.radius * 1.25,
          opacity: pressed || pending ? 0.85 : 1,
        },
      ]}
    >
      {pending ? (
        <ActivityIndicator color={colors.foreground} />
      ) : (
        <>
          <Feather name="log-out" size={16} color={colors.foreground} />
          <Text style={[styles.signOutText, { color: colors.foreground }]}>
            Sign out
          </Text>
        </>
      )}
    </Pressable>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.infoRow}>
      <View
        style={[
          styles.infoIcon,
          { backgroundColor: colors.secondary, borderRadius: colors.radius },
        ]}
      >
        <Feather name={icon} size={14} color={colors.foreground} />
      </View>
      <View style={styles.infoText}>
        <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>
          {label}
        </Text>
        <Text style={[styles.infoValue, { color: colors.foreground }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function Divider() {
  const colors = useColors();
  return (
    <View style={[styles.divider, { backgroundColor: colors.border }]} />
  );
}

function InstitutionsRow({
  institutions,
}: {
  institutions: Array<{
    id: number;
    name: string;
    type: string;
    logoUrl: string;
    isPrimary: boolean;
    departmentName?: string | null;
  }>;
}) {
  const colors = useColors();
  const label = institutions.length > 1 ? "Institutions" : "Institution";
  return (
    <View style={styles.infoRow}>
      <View
        style={[
          styles.infoIcon,
          { backgroundColor: colors.secondary, borderRadius: colors.radius },
        ]}
      >
        <Feather name="book" size={14} color={colors.foreground} />
      </View>
      <View style={[styles.infoText, { gap: 6 }]}>
        <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>
          {label}
        </Text>
        <View style={{ gap: 8 }}>
          {institutions.map((inst) => (
            <View key={inst.id} style={{ gap: 2 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <Text
                  style={[styles.infoValue, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {inst.name}
                </Text>
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 999,
                    backgroundColor: inst.isPrimary
                      ? colors.primary
                      : colors.secondary,
                    borderWidth: inst.isPrimary ? 0 : 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 10,
                      color: inst.isPrimary
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                      letterSpacing: 0.3,
                    }}
                  >
                    {inst.isPrimary ? "PRIMARY" : "AFFILIATED"}
                  </Text>
                </View>
              </View>
              {inst.departmentName ? (
                <Text
                  style={{
                    fontFamily: "Inter_400Regular",
                    fontSize: 12,
                    color: colors.mutedForeground,
                  }}
                  numberOfLines={1}
                >
                  {inst.departmentName}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function EducationSection({
  entries,
}: {
  entries: Array<{
    id: number;
    institution: string;
    degree: string;
    fieldOfStudy: string;
    startYear: number;
    endYear?: number | null;
  }>;
}) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        Education
      </Text>
      <View
        style={[
          styles.infoCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius * 1.5,
          },
        ]}
      >
        {entries.map((e, idx) => (
          <React.Fragment key={e.id}>
            {idx > 0 ? <Divider /> : null}
            <View style={styles.infoRow}>
              <View
                style={[
                  styles.infoIcon,
                  {
                    backgroundColor: colors.secondary,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <Feather name="award" size={14} color={colors.foreground} />
              </View>
              <View style={[styles.infoText, { gap: 2 }]}>
                <Text
                  style={[styles.infoValue, { color: colors.foreground }]}
                  numberOfLines={2}
                >
                  {e.degree} in {e.fieldOfStudy}
                </Text>
                <Text
                  style={{
                    fontFamily: "Inter_500Medium",
                    fontSize: 12,
                    color: colors.mutedForeground,
                  }}
                  numberOfLines={1}
                >
                  {e.institution}
                </Text>
                <Text
                  style={{
                    fontFamily: "Inter_400Regular",
                    fontSize: 11,
                    color: colors.mutedForeground,
                    marginTop: 2,
                  }}
                >
                  {e.startYear} — {e.endYear ?? "Present"}
                </Text>
              </View>
            </View>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  editButtonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  editButtonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  heroWrap: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  avatarWrap: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    marginBottom: 6,
  },
  avatar: {
    width: "100%",
    height: "100%",
  },
  name: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
    letterSpacing: -0.4,
    textAlign: "center",
  },
  headline: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    textAlign: "center",
    marginTop: 2,
  },
  metaRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  metaText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  scoreRow: {
    flexDirection: "row",
    gap: 12,
  },
  scoreCard: {
    flex: 1,
    padding: 18,
    gap: 4,
    minHeight: 100,
    justifyContent: "center",
  },
  scoreLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  scoreValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 32,
    letterSpacing: -0.5,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
  },
  chipCloud: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  bio: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 22,
  },
  infoCard: {
    borderWidth: 1,
    paddingVertical: 4,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  infoIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  infoText: {
    flex: 1,
    gap: 2,
  },
  infoLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
  },
  infoValue: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  divider: {
    height: 1,
    marginHorizontal: 14,
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderWidth: 1,
    marginTop: 4,
  },
  signOutText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
});

function formatPriceMobile(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function getWebOrigin(): string {
  if (Platform.OS === "web") return window.location.origin;
  const raw = process.env.EXPO_PUBLIC_DOMAIN;
  if (!raw) {
    throw new Error(
      "EXPO_PUBLIC_DOMAIN is not configured. Cannot start checkout.",
    );
  }
  // Tolerate misconfigured env values like "https://example.com" or
  // trailing slashes — the rest of the app expects a bare host.
  const domain = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${domain}`;
}

// On native, build a deep-link URL the in-app browser can hand back to
// the app via openAuthSessionAsync. On web, returns null (we just use
// window.location.href for redirects).
function getDeepLinkPrefix(suffix: string): string | null {
  if (Platform.OS === "web") return null;
  return Linking.createURL(suffix.replace(/^\//, ""));
}

function buildSuccessUrl(suffix: string): string {
  const origin = getWebOrigin();
  const base = `${origin}${suffix}?session_id={CHECKOUT_SESSION_ID}`;
  if (Platform.OS === "web") return base;
  // Native: tell the web return page to bounce back into the app via a
  // deep link instead of rendering its own confirmation UI.
  const deepLink = getDeepLinkPrefix(suffix);
  if (!deepLink) return base;
  return `${base}&mobile_redirect=${encodeURIComponent(deepLink)}`;
}

function buildCancelUrl(suffix: string): string {
  const origin = getWebOrigin();
  if (Platform.OS === "web") return `${origin}/dashboard/candidate`;
  // Reuse the return page so it bounces back to the app with a
  // cancelled marker — keeps the in-app browser from getting stuck on
  // the web dashboard after the user cancels Stripe.
  const deepLink = getDeepLinkPrefix(suffix);
  if (!deepLink) return `${origin}/dashboard/candidate`;
  return `${origin}${suffix}?cancelled=1&mobile_redirect=${encodeURIComponent(deepLink)}`;
}

// Strip the "HTTP 400 Bad Request: " prefix added by our shared API
// client so the user sees the actual server message.
function humanizeError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  return err.message.replace(/^HTTP \d+ [^:]+: /, "") || fallback;
}

function PremiumSection({ candidateId }: { candidateId: number }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { data: boostSettings } = useGetBoostSettings();
  const { data: cvSettings } = useGetCvSettings();
  const { data: cv, refetch: refetchCv } = useGetCandidateCv(candidateId, {
    query: {
      enabled: candidateId > 0,
      queryKey: getGetCandidateCvQueryKey(candidateId),
    },
  });
  const { data: candidateData, refetch: refetchCandidate } = useGetCandidate(
    candidateId,
    {
      query: {
        enabled: candidateId > 0,
        queryKey: getGetCandidateQueryKey(candidateId),
      },
    },
  );

  const createBoostCheckout = useCreateBoostCheckout();
  const verifyBoost = useVerifyBoostCheckout();
  const createCvCheckout = useCreateCvCheckout();
  const verifyCv = useVerifyCvCheckout();
  const generate = useGenerateCandidateCv();

  const [busy, setBusy] = React.useState<"boost" | "cv" | "generate" | null>(
    null,
  );

  const boostExpiresAt = candidateData?.boostExpiresAt
    ? new Date(candidateData.boostExpiresAt)
    : null;
  const isBoosted = !!boostExpiresAt && boostExpiresAt.getTime() > Date.now();

  const showBoost = boostSettings?.isActive || isBoosted;
  const showCv = cvSettings?.isActive || cv?.unlocked;
  if (!showBoost && !showCv) return null;

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getGetCandidateQueryKey(candidateId),
      }),
      queryClient.invalidateQueries({
        queryKey: getGetBoostSettingsQueryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: getGetCvSettingsQueryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: getGetCandidateCvQueryKey(candidateId),
      }),
    ]);
    await Promise.all([refetchCv(), refetchCandidate()]);
  };

  const runCheckout = async (
    kind: "boost" | "cv",
    suffix: "/boost/return" | "/cv/return",
    createUrl: (urls: {
      successUrl: string;
      cancelUrl: string;
    }) => Promise<{ checkoutUrl: string; sessionId: string }>,
    verify: (sessionId: string) => Promise<void>,
  ) => {
    setBusy(kind);
    try {
      const { checkoutUrl, sessionId } = await createUrl({
        successUrl: buildSuccessUrl(suffix),
        cancelUrl: buildCancelUrl(suffix),
      });
      if (Platform.OS === "web") {
        window.location.href = checkoutUrl;
        return;
      }
      const deepLink = getDeepLinkPrefix(suffix) ?? Linking.createURL("");
      const result = await WebBrowser.openAuthSessionAsync(
        checkoutUrl,
        deepLink,
      );
      if (result.type !== "success") {
        // User dismissed the browser without reaching the success URL.
        return;
      }
      const parsed = Linking.parse(result.url);
      const cancelled = parsed.queryParams?.cancelled;
      if (cancelled === "1") {
        // User clicked "Back" on Stripe; cancel URL bounced us home.
        return;
      }
      const fromUrl = parsed.queryParams?.session_id;
      const sid =
        typeof fromUrl === "string" && fromUrl.length > 0 ? fromUrl : sessionId;
      await verify(sid);
      await refreshAll();
    } catch (err) {
      Alert.alert(
        "Checkout failed",
        humanizeError(err, "Please try again."),
      );
    } finally {
      setBusy(null);
    }
  };

  const onBoost = () =>
    runCheckout(
      "boost",
      "/boost/return",
      async ({ successUrl, cancelUrl }) =>
        createBoostCheckout.mutateAsync({
          id: candidateId,
          data: { successUrl, cancelUrl },
        }),
      async (sid) => {
        await verifyBoost.mutateAsync({ data: { sessionId: sid } });
      },
    );

  const onUnlockCv = () =>
    runCheckout(
      "cv",
      "/cv/return",
      async ({ successUrl, cancelUrl }) =>
        createCvCheckout.mutateAsync({
          id: candidateId,
          data: { successUrl, cancelUrl },
        }),
      async (sid) => {
        await verifyCv.mutateAsync({ data: { sessionId: sid } });
      },
    );

  const onGenerate = async () => {
    setBusy("generate");
    try {
      await generate.mutateAsync({ id: candidateId, data: { focus: null } });
      await refreshAll();
    } catch (err) {
      Alert.alert(
        "Couldn't generate CV",
        humanizeError(err, "Please try again."),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={premiumStyles.section}>
      <Text style={[premiumStyles.sectionTitle, { color: colors.foreground }]}>
        Premium
      </Text>

      {showBoost ? (
        <View
          style={[
            premiumStyles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius * 1.5,
            },
          ]}
        >
          <View style={premiumStyles.row}>
            <View
              style={[
                premiumStyles.iconWrap,
                { backgroundColor: colors.primary + "1A" },
              ]}
            >
              <Feather name="zap" size={20} color={colors.primary} />
            </View>
            <View style={premiumStyles.body}>
              <Text
                style={[premiumStyles.title, { color: colors.foreground }]}
              >
                Profile Boost
              </Text>
              {isBoosted && boostExpiresAt ? (
                <Text
                  style={[
                    premiumStyles.subtitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Active until {boostExpiresAt.toLocaleDateString()}
                </Text>
              ) : boostSettings ? (
                <Text
                  style={[
                    premiumStyles.subtitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Stand out for {boostSettings.durationDays} days for {" "}
                  {formatPriceMobile(
                    boostSettings.priceCents,
                    boostSettings.currency,
                  )}
                  .
                </Text>
              ) : null}
            </View>
          </View>
          {!isBoosted && boostSettings?.isActive ? (
            <Pressable
              onPress={onBoost}
              disabled={busy !== null}
              style={({ pressed }) => [
                premiumStyles.cta,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius,
                  opacity: pressed || busy ? 0.85 : 1,
                },
              ]}
              accessibilityLabel="Boost profile"
            >
              {busy === "boost" ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Feather
                    name="zap"
                    size={14}
                    color={colors.primaryForeground}
                  />
                  <Text
                    style={[
                      premiumStyles.ctaText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    Boost now
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {showCv ? (
        <View
          style={[
            premiumStyles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius * 1.5,
            },
          ]}
        >
          <View style={premiumStyles.row}>
            <View
              style={[
                premiumStyles.iconWrap,
                { backgroundColor: colors.primary + "1A" },
              ]}
            >
              <Feather name="file-text" size={20} color={colors.primary} />
            </View>
            <View style={premiumStyles.body}>
              <Text
                style={[premiumStyles.title, { color: colors.foreground }]}
              >
                AI CV Builder
              </Text>
              {cv?.unlocked ? (
                <Text
                  style={[
                    premiumStyles.subtitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {cv.cvText
                    ? `Last generated ${cv.generatedAt ? new Date(cv.generatedAt).toLocaleDateString() : "recently"}.`
                    : "Tap generate to create your CV from your profile."}
                </Text>
              ) : cvSettings ? (
                <Text
                  style={[
                    premiumStyles.subtitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  One-time unlock for {" "}
                  {formatPriceMobile(
                    cvSettings.priceCents,
                    cvSettings.currency,
                  )}
                  . Generate as many CVs as you like.
                </Text>
              ) : null}
            </View>
          </View>

          {cv?.unlocked ? (
            <>
              <Pressable
                onPress={onGenerate}
                disabled={busy !== null}
                style={({ pressed }) => [
                  premiumStyles.cta,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: colors.radius,
                    opacity: pressed || busy ? 0.85 : 1,
                  },
                ]}
                accessibilityLabel="Generate CV"
              >
                {busy === "generate" ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <>
                    <Feather
                      name="refresh-cw"
                      size={14}
                      color={colors.primaryForeground}
                    />
                    <Text
                      style={[
                        premiumStyles.ctaText,
                        { color: colors.primaryForeground },
                      ]}
                    >
                      {cv.cvText ? "Regenerate" : "Generate CV"}
                    </Text>
                  </>
                )}
              </Pressable>
              {cv.cvText ? (
                <View
                  style={[
                    premiumStyles.cvBox,
                    {
                      backgroundColor: colors.secondary,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                    },
                  ]}
                >
                  <Text
                    style={[
                      premiumStyles.cvText,
                      { color: colors.secondaryForeground },
                    ]}
                  >
                    {cv.cvText}
                  </Text>
                </View>
              ) : null}
            </>
          ) : cvSettings?.isActive ? (
            <Pressable
              onPress={onUnlockCv}
              disabled={busy !== null}
              style={({ pressed }) => [
                premiumStyles.cta,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius,
                  opacity: pressed || busy ? 0.85 : 1,
                },
              ]}
              accessibilityLabel="Unlock AI CV builder"
            >
              {busy === "cv" ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <Feather
                    name="unlock"
                    size={14}
                    color={colors.primaryForeground}
                  />
                  <Text
                    style={[
                      premiumStyles.ctaText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    Unlock now
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const premiumStyles = StyleSheet.create({
  section: { gap: 12 },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  card: {
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  row: { flexDirection: "row", gap: 12 },
  iconWrap: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  body: { flex: 1, gap: 4 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
  },
  ctaText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  cvBox: { borderWidth: 1, padding: 12, maxHeight: 320 },
  cvText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
});
