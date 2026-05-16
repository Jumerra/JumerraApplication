import { Feather } from "@expo/vector-icons";
import {
  ApiError,
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
import { CvCritiqueCard } from "@/components/CvCritiqueCard";
import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";
import { avatarSrc } from "@/lib/avatar";
import {
  buildCancelUrl as buildCancelUrlPure,
  buildSuccessUrl as buildSuccessUrlPure,
  buildWebOrigin,
  getDeepLinkPrefix as getDeepLinkPrefixPure,
} from "@/lib/checkout-urls";
import { runMobileCheckoutFlow } from "@/lib/checkout-flow";

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
            {candidate.skills.map((s) => {
              const verified = candidate.verifiedSkills?.some(
                (v) => v.skill.toLowerCase() === s.toLowerCase(),
              );
              return (
                <SkillChip key={s} label={s} tone={verified ? "primary" : "default"} />
              );
            })}
          </View>
        </View>
      ) : null}

      {(candidate.verifiedSkills?.length ?? 0) > 0 ||
      candidate.backgroundCheck?.status === "passed" ||
      (candidate.references?.length ?? 0) > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Trust signals
          </Text>
          <View
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: colors.radius * 1.5,
              padding: 16,
              gap: 10,
            }}
          >
            {candidate.backgroundCheck?.status === "passed" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Feather name="shield" size={16} color={colors.primary} />
                <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                  Background check passed
                </Text>
              </View>
            ) : null}
            {(candidate.verifiedSkills ?? []).slice(0, 6).map((v) => {
              const issued = new Date(v.issuedAt).toLocaleDateString(undefined, {
                month: "short",
                year: "numeric",
              });
              return (
                <View key={v.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Feather name="check-circle" size={14} color={colors.primary} />
                  <Text style={{ color: colors.foreground, fontSize: 13, flex: 1 }}>
                    {v.skill}{" "}
                    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                      · {v.institutionName} · {issued}
                    </Text>
                  </Text>
                </View>
              );
            })}
            {(candidate.references?.length ?? 0) > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Feather name="message-circle" size={14} color={colors.primary} />
                <Text style={{ color: colors.foreground, fontSize: 13 }}>
                  {candidate.references!.length} verified reference
                  {candidate.references!.length === 1 ? "" : "s"}
                </Text>
              </View>
            ) : null}
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

      <View style={styles.section}>
        <CvCritiqueCard candidateId={candidateId} />
      </View>

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
  return buildWebOrigin({
    isWeb: Platform.OS === "web",
    windowOrigin: Platform.OS === "web" ? window.location.origin : null,
    envDomain: process.env.EXPO_PUBLIC_DOMAIN ?? null,
  });
}

function getDeepLinkPrefix(suffix: string): string | null {
  return getDeepLinkPrefixPure({
    isWeb: Platform.OS === "web",
    suffix,
    createUrl: (path) => Linking.createURL(path),
  });
}

function buildSuccessUrl(suffix: string): string {
  return buildSuccessUrlPure({
    suffix,
    origin: getWebOrigin(),
    deepLink: getDeepLinkPrefix(suffix),
  });
}

function buildCancelUrl(suffix: string): string {
  return buildCancelUrlPure({
    suffix,
    origin: getWebOrigin(),
    deepLink: getDeepLinkPrefix(suffix),
  });
}

// Network failures from `fetch` look different on RN vs the web. We
// match on the message so we can show "can't reach server" instead of
// the cryptic raw error.
function isLikelyNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /network request failed|failed to fetch|network ?error|aborted/i.test(
    err.message,
  );
}

// Stripe-related failure codes the server emits (see
// `mapStripeCheckoutError` in `artifacts/api-server/src/stripeClient.ts`).
// We split them into two groups so the alert title matches what the
// candidate should actually do about it.

// Likely to clear on its own — encourage a retry.
const TRANSIENT_STRIPE_CODES = new Set([
  "stripe_connector_unreachable",
  "stripe_connector_status",
  "stripe_connection_error",
  "stripe_rate_limited",
  "stripe_api_error",
]);

// Configuration / contract-level — retrying won't help. The server's
// own message tells the candidate to contact support.
const NEEDS_ATTENTION_STRIPE_CODES = new Set([
  "stripe_not_configured",
  "stripe_token_missing",
  "stripe_auth_error",
  "stripe_permission_error",
  "stripe_invalid_request",
  "stripe_no_url",
  "stripe_error",
]);

// Build an alert title + message tailored to *why* a checkout (or any
// API call) failed. We distinguish:
//   * No connectivity / can't reach the server   -> retry hint
//   * Transient Stripe / payment outage          -> "try again in a moment"
//   * Stripe config / contract issue             -> "needs attention"
//   * Other 5xx server errors                    -> generic server error
//   * 4xx errors                                 -> show the server's own copy
function describeApiError(
  err: unknown,
  fallback: { title: string; message: string },
): { title: string; message: string } {
  if (err instanceof ApiError) {
    const data =
      err.data && typeof err.data === "object"
        ? (err.data as { error?: unknown; code?: unknown })
        : null;
    const serverMessage =
      typeof data?.error === "string" && data.error.length > 0
        ? data.error
        : null;
    const code =
      typeof data?.code === "string" && data.code.length > 0
        ? data.code
        : null;

    if (code && NEEDS_ATTENTION_STRIPE_CODES.has(code)) {
      return {
        title: "Payments need attention",
        message:
          serverMessage ??
          "Something is wrong with the payment setup. Please contact support.",
      };
    }

    if (
      (code && TRANSIENT_STRIPE_CODES.has(code)) ||
      (err.status === 503 && (!code || code.startsWith("stripe_")))
    ) {
      return {
        title: "Payments temporarily unavailable",
        message:
          serverMessage ??
          "Stripe is temporarily unavailable. Please try again in a moment.",
      };
    }

    if (err.status >= 500) {
      return {
        title: "Server error",
        message:
          serverMessage ??
          "Something went wrong on our end. Please try again.",
      };
    }

    // 4xx — server has a specific reason; surface it.
    return {
      title: fallback.title,
      message: serverMessage ?? fallback.message,
    };
  }

  if (isLikelyNetworkError(err)) {
    return {
      title: "Can't reach the server",
      message: "Check your internet connection and try again.",
    };
  }

  if (err instanceof Error && err.message) {
    return { title: fallback.title, message: err.message };
  }

  return fallback;
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
      const successUrl = buildSuccessUrl(suffix);
      const cancelUrl = buildCancelUrl(suffix);
      if (Platform.OS === "web") {
        // On web we don't have an in-app browser to bounce back; just
        // create the session and navigate.
        const { checkoutUrl } = await createUrl({ successUrl, cancelUrl });
        window.location.href = checkoutUrl;
        return;
      }
      await runMobileCheckoutFlow({
        successUrl,
        cancelUrl,
        deepLink: getDeepLinkPrefix(suffix) ?? Linking.createURL(""),
        createCheckout: createUrl,
        openAuthSession: (url, redirect) =>
          WebBrowser.openAuthSessionAsync(url, redirect),
        parseReturnUrl: (url) => {
          const parsed = Linking.parse(url);
          return { queryParams: parsed.queryParams ?? null };
        },
        verify,
        onVerified: refreshAll,
      });
    } catch (err) {
      const { title, message } = describeApiError(err, {
        title: "Checkout failed",
        message: "Please try again.",
      });
      Alert.alert(title, message);
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
      const { title, message } = describeApiError(err, {
        title: "Couldn't generate CV",
        message: "Please try again.",
      });
      Alert.alert(title, message);
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
