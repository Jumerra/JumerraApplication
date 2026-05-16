import { Feather } from "@expo/vector-icons";
import { customFetch } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { SkillChip } from "@/components/SkillChip";
import { useAuth } from "@/hooks/useAuth";
import { useColors } from "@/hooks/useColors";

type DeckCandidate = {
  id: number;
  fullName: string;
  headline: string;
  location: string;
  avatarUrl: string;
  bio: string;
  skills: string[];
  talentScore: number;
  yearsExperience: number;
  openToOffers: boolean;
};

type DeckItem = {
  candidate: DeckCandidate;
  bestJobId: number | null;
  bestJobTitle: string | null;
  matchScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  summary: string;
};

type DeckResponse = {
  deckDate: string;
  openJobsCount: number;
  items: DeckItem[];
};

const SCREEN_WIDTH = Dimensions.get("window").width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.28;
const SWIPE_OUT_DISTANCE = SCREEN_WIDTH * 1.4;
const ROTATE_RANGE = 12;

function triggerHaptic(style: "light" | "medium") {
  if (Platform.OS === "web") return;
  const impact =
    style === "medium"
      ? Haptics.ImpactFeedbackStyle.Medium
      : Haptics.ImpactFeedbackStyle.Light;
  Haptics.impactAsync(impact).catch(() => {});
}

export default function DailyPicksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const isEmployer = user?.role === "employer";

  const [data, setData] = useState<DeckResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);

  // Reanimated shared values drive the swipe animation on the UI thread,
  // so drag tracking and the fling-out tween never block JS.
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  // Guards against double-advancement when a rapid tap arrives mid-tween
  // or two gesture-end callbacks race (e.g. cancelled animation + a
  // follow-up tap fired before the JS thread caught up).
  const swipingRef = useRef(false);

  const loadDeck = useCallback(async () => {
    if (!isEmployer) return;
    setError(null);
    try {
      const res = await customFetch<DeckResponse>("/api/me/daily-deck");
      setData(res);
      setIndex(0);
      setReviewedCount(0);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 403) {
        setError("Daily picks are only available on employer accounts.");
      } else {
        setError("Couldn't load today's deck. Please try again.");
      }
      setData(null);
    }
  }, [isEmployer]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadDeck().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadDeck]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDeck();
    setRefreshing(false);
  }, [loadDeck]);

  const advance = useCallback(() => {
    translateX.value = 0;
    translateY.value = 0;
    setIndex((i) => i + 1);
    setReviewedCount((c) => c + 1);
    swipingRef.current = false;
  }, [translateX, translateY]);

  const shortlistRequest = useCallback(async (item: DeckItem) => {
    try {
      await customFetch(`/api/me/daily-deck/${item.candidate.id}/shortlist`, {
        method: "POST",
        body: JSON.stringify({
          jobId: item.bestJobId ?? undefined,
        }),
      });
    } catch {
      // best-effort; local advance is fine even if persistence fails
    }
  }, []);

  const dismissRequest = useCallback(async (item: DeckItem) => {
    try {
      await customFetch(`/api/me/daily-deck/${item.candidate.id}/dismiss`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch {
      // best-effort
    }
  }, []);

  const handleSwipeRight = useCallback(
    (item: DeckItem) => {
      triggerHaptic("medium");
      void shortlistRequest(item);
      advance();
    },
    [advance, shortlistRequest],
  );

  const handleSwipeLeft = useCallback(
    (item: DeckItem) => {
      triggerHaptic("light");
      void dismissRequest(item);
      advance();
    },
    [advance, dismissRequest],
  );

  const current = data?.items[index];
  const next = data?.items[index + 1];

  const finishSwipe = useCallback(
    (direction: "left" | "right", finished: boolean) => {
      // Reanimated invokes the completion callback even when the
      // animation is cancelled (e.g. a new gesture interrupts the
      // fling-out tween). Skip the action in that case, and also skip
      // if another swipe already won the race.
      if (!finished) {
        swipingRef.current = false;
        return;
      }
      if (!current) {
        swipingRef.current = false;
        return;
      }
      if (direction === "right") handleSwipeRight(current);
      else handleSwipeLeft(current);
    },
    [current, handleSwipeLeft, handleSwipeRight],
  );

  // The pan gesture is enabled only while a card is on screen — without
  // this guard the worklet would still read `translateX` after the deck
  // is exhausted and produce a stale offset on the next card.
  const panGesture = Gesture.Pan()
    .enabled(Boolean(current))
    .activeOffsetX([-10, 10])
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationX > SWIPE_THRESHOLD) {
        translateX.value = withTiming(
          SWIPE_OUT_DISTANCE,
          { duration: 220 },
          (finished) => {
            runOnJS(finishSwipe)("right", finished ?? false);
          },
        );
      } else if (e.translationX < -SWIPE_THRESHOLD) {
        translateX.value = withTiming(
          -SWIPE_OUT_DISTANCE,
          { duration: 220 },
          (finished) => {
            runOnJS(finishSwipe)("left", finished ?? false);
          },
        );
      } else {
        translateX.value = withSpring(0, { damping: 18, stiffness: 180 });
        translateY.value = withSpring(0, { damping: 18, stiffness: 180 });
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      {
        rotate: `${interpolate(
          translateX.value,
          [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
          [-ROTATE_RANGE, 0, ROTATE_RANGE],
          Extrapolation.CLAMP,
        )}deg`,
      },
    ],
  }));

  const likeBadgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [0, SWIPE_THRESHOLD],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  const nopeBadgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [-SWIPE_THRESHOLD, 0],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  const swipeOutLeft = useCallback(() => {
    if (!current || swipingRef.current) return;
    swipingRef.current = true;
    translateX.value = withTiming(
      -SWIPE_OUT_DISTANCE,
      { duration: 220 },
      (finished) => {
        runOnJS(finishSwipe)("left", finished ?? false);
      },
    );
  }, [current, finishSwipe, translateX]);

  const swipeOutRight = useCallback(() => {
    if (!current || swipingRef.current) return;
    swipingRef.current = true;
    translateX.value = withTiming(
      SWIPE_OUT_DISTANCE,
      { duration: 220 },
      (finished) => {
        runOnJS(finishSwipe)("right", finished ?? false);
      },
    );
  }, [current, finishSwipe, translateX]);

  if (!isEmployer) {
    return (
      <View
        style={[
          styles.flex,
          styles.center,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
      >
        <View style={{ paddingHorizontal: 24 }}>
          <EmptyState
            icon="briefcase"
            title="For employers"
            subtitle="Daily picks are only available on employer accounts. Sign in with your employer account to triage top candidates with a swipe."
          />
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View
        style={[styles.flex, styles.center, { backgroundColor: colors.background }]}
      >
        <LoadingSpinner />
      </View>
    );
  }

  if (error) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={[styles.center, { paddingTop: insets.top + 32 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <EmptyState
          icon="alert-triangle"
          title="Couldn't load Daily picks"
          subtitle={error}
        />
      </ScrollView>
    );
  }

  if (!data) return null;

  const remaining = Math.max(data.items.length - index, 0);
  const openJobsCount = data.openJobsCount;

  return (
    <View
      style={[
        styles.flex,
        { backgroundColor: colors.background, paddingTop: insets.top + 8 },
      ]}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Daily picks
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_500Medium",
              fontSize: 12,
              marginTop: 2,
            }}
            numberOfLines={2}
          >
            {openJobsCount > 0
              ? `Top candidates across your ${openJobsCount} open ${
                  openJobsCount === 1 ? "role" : "roles"
                } — refreshed daily.`
              : "Post a role to see candidates matched to your hiring needs."}
          </Text>
        </View>
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: "Inter_500Medium",
            marginLeft: 12,
          }}
        >
          {remaining > 0 ? `${remaining} left` : "Done"}
        </Text>
      </View>

      {current ? (
        <>
          <View style={styles.deck}>
            {next ? (
              <CardView
                colors={colors}
                item={next}
                style={[styles.cardBehind]}
                pointerEvents="none"
              />
            ) : null}

            <GestureDetector gesture={panGesture}>
              <Animated.View style={[styles.cardWrap, cardStyle]}>
                <CardView colors={colors} item={current} />

                <Animated.View
                  style={[
                    styles.badge,
                    styles.badgeLeft,
                    { borderColor: colors.primary },
                    likeBadgeStyle,
                  ]}
                >
                  <Text style={[styles.badgeText, { color: colors.primary }]}>
                    SHORTLIST
                  </Text>
                </Animated.View>
                <Animated.View
                  style={[
                    styles.badge,
                    styles.badgeRight,
                    { borderColor: colors.destructive },
                    nopeBadgeStyle,
                  ]}
                >
                  <Text
                    style={[styles.badgeText, { color: colors.destructive }]}
                  >
                    SKIP
                  </Text>
                </Animated.View>
              </Animated.View>
            </GestureDetector>
          </View>

          <View style={[styles.actions, { paddingBottom: 8 }]}>
            <Pressable
              onPress={swipeOutLeft}
              style={[
                styles.actionBtn,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
              accessibilityLabel="Skip"
            >
              <Feather name="x" size={28} color={colors.destructive} />
            </Pressable>
            <Pressable
              onPress={swipeOutRight}
              style={[
                styles.actionBtn,
                { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
              accessibilityLabel="Shortlist"
            >
              <Feather name="heart" size={26} color={colors.primaryForeground} />
            </Pressable>
          </View>
          <Text
            style={{
              textAlign: "center",
              color: colors.mutedForeground,
              fontFamily: "Inter_500Medium",
              fontSize: 12,
              paddingHorizontal: 24,
              paddingTop: 8,
              paddingBottom: insets.bottom + 80,
            }}
          >
            Swipe right to shortlist, left to skip. Skipped candidates won't
            show up again.
          </Text>
        </>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.center,
            { paddingTop: 24, paddingBottom: insets.bottom + 80 },
          ]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          <View style={{ paddingHorizontal: 32, alignItems: "center" }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: colors.muted,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name="check-circle" size={28} color={colors.primary} />
            </View>
            <Text
              style={{
                marginTop: 16,
                fontFamily: "Inter_700Bold",
                fontSize: 20,
                color: colors.foreground,
                textAlign: "center",
              }}
            >
              You're all caught up
            </Text>
            <Text
              style={{
                marginTop: 8,
                color: colors.mutedForeground,
                textAlign: "center",
                fontFamily: "Inter_400Regular",
                fontSize: 14,
                lineHeight: 20,
              }}
            >
              {openJobsCount === 0
                ? "Post a role to see candidates matched to your hiring needs."
                : reviewedCount > 0
                  ? `You reviewed ${reviewedCount} ${
                      reviewedCount === 1 ? "candidate" : "candidates"
                    } today. Come back tomorrow for a fresh deck.`
                  : "No new candidates today — check back tomorrow."}
            </Text>
            <Pressable
              onPress={() => void loadDeck()}
              style={{
                marginTop: 20,
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: colors.muted,
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 999,
              }}
              accessibilityLabel="Refresh"
            >
              <Feather
                name="refresh-ccw"
                size={14}
                color={colors.foreground}
              />
              <Text
                style={{
                  marginLeft: 8,
                  color: colors.foreground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 13,
                }}
              >
                Refresh
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function CardView({
  colors,
  item,
  style,
  pointerEvents,
}: {
  colors: ReturnType<typeof useColors>;
  item: DeckItem;
  style?: object | object[];
  pointerEvents?: "auto" | "none";
}) {
  const { candidate } = item;
  return (
    <View
      pointerEvents={pointerEvents}
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
        style,
      ]}
    >
      <View style={styles.cardHeader}>
        {candidate.avatarUrl ? (
          <Image
            source={{ uri: candidate.avatarUrl }}
            style={styles.avatar}
            contentFit="cover"
          />
        ) : (
          <View
            style={[
              styles.avatar,
              {
                backgroundColor: colors.muted,
                alignItems: "center",
                justifyContent: "center",
              },
            ]}
          >
            <Feather name="user" size={22} color={colors.mutedForeground} />
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 18,
              color: colors.foreground,
            }}
          >
            {candidate.fullName}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              marginTop: 2,
              color: colors.mutedForeground,
              fontFamily: "Inter_500Medium",
              fontSize: 13,
            }}
          >
            {candidate.headline}
          </Text>
        </View>
        <View style={[styles.score, { backgroundColor: colors.primary }]}>
          <Text
            style={{
              color: colors.primaryForeground,
              fontFamily: "Inter_700Bold",
              fontSize: 14,
            }}
          >
            {Math.round(item.matchScore)}%
          </Text>
        </View>
      </View>

      <View
        style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 6 }}
      >
        {candidate.location ? (
          <Pill colors={colors} icon="map-pin" label={candidate.location} />
        ) : null}
        <Pill
          colors={colors}
          icon="award"
          label={`${candidate.yearsExperience}y exp`}
        />
        {item.bestJobTitle ? (
          <Pill
            colors={colors}
            icon="briefcase"
            label={`Best fit: ${item.bestJobTitle}`}
          />
        ) : null}
      </View>

      <ScrollView style={{ marginTop: 16, flex: 1 }}>
        {item.summary ? (
          <View
            style={{
              backgroundColor: colors.muted,
              borderRadius: 12,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_500Medium",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                marginBottom: 4,
              }}
            >
              Why this match
            </Text>
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_500Medium",
                fontSize: 13,
                lineHeight: 18,
              }}
            >
              {item.summary}
            </Text>
          </View>
        ) : null}

        {item.matchedSkills.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              Matched skills
            </Text>
            <View style={styles.chipRow}>
              {item.matchedSkills.slice(0, 8).map((s) => (
                <SkillChip key={s} label={s} tone="primary" />
              ))}
            </View>
          </>
        ) : null}

        {item.missingSkills.length > 0 ? (
          <>
            <Text
              style={[
                styles.sectionLabel,
                { color: colors.mutedForeground, marginTop: 12 },
              ]}
            >
              Gaps
            </Text>
            <View style={styles.chipRow}>
              {item.missingSkills.slice(0, 6).map((s) => (
                <SkillChip key={s} label={s} />
              ))}
            </View>
          </>
        ) : null}

        {candidate.bio ? (
          <Text
            numberOfLines={5}
            style={{
              marginTop: 14,
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            {candidate.bio}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Pill({
  colors,
  icon,
  label,
}: {
  colors: ReturnType<typeof useColors>;
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: colors.secondary,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
      }}
    >
      <Feather name={icon} size={12} color={colors.mutedForeground} />
      <Text
        style={{
          marginLeft: 4,
          fontSize: 12,
          color: colors.secondaryForeground,
          fontFamily: "Inter_500Medium",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 24 },
  deck: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  cardWrap: {
    ...StyleSheet.absoluteFillObject,
    margin: 16,
  },
  cardBehind: {
    ...StyleSheet.absoluteFillObject,
    margin: 16,
    transform: [{ scale: 0.95 }],
    opacity: 0.6,
  },
  card: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    overflow: "hidden",
  },
  cardHeader: { flexDirection: "row", alignItems: "center" },
  avatar: { width: 48, height: 48, borderRadius: 12 },
  score: {
    minWidth: 52,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: {
    position: "absolute",
    top: 32,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 3,
    borderRadius: 8,
  },
  badgeLeft: { left: 32, transform: [{ rotate: "-12deg" }] },
  badgeRight: { right: 32, transform: [{ rotate: "12deg" }] },
  badgeText: { fontFamily: "Inter_700Bold", fontSize: 20, letterSpacing: 1 },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 18,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  actionBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
