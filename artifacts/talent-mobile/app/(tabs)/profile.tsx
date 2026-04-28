import { Feather } from "@expo/vector-icons";
import { useGetCandidate } from "@workspace/api-client-react";
import { Image } from "expo-image";
import React from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { SkillChip } from "@/components/SkillChip";
import { useColors } from "@/hooks/useColors";

const WEB_TOP_INSET = Platform.OS === "web" ? 67 : 0;

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: candidate, isLoading, isError } = useGetCandidate(0);

  if (isLoading) {
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
      <View style={styles.heroWrap}>
        <View
          style={[
            styles.avatarWrap,
            { backgroundColor: colors.secondary, borderColor: colors.border },
          ]}
        >
          {candidate.avatarUrl ? (
            <Image
              source={{ uri: candidate.avatarUrl }}
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
    </ScrollView>
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
        <View style={{ gap: 6 }}>
          {institutions.map((inst) => (
            <View
              key={inst.id}
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
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
});
