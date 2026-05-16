import { Feather } from "@expo/vector-icons";
import { customFetch } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { Stack } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Dimensions,
  PanResponder,
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

type DeckItem = {
  candidate: {
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

type ShortlistResponse = { ok: boolean; poolId?: number };

type SwipeAction = "shortlist" | "dismiss";

type SnackbarState = {
  message: string;
  /**
   * Action handler invoked when the user taps "Undo". When null, the
   * snackbar renders without an action button — used for confirmation
   * messages (e.g. after a successful undo) and for error states where
   * there is nothing meaningful to undo.
   */
  onUndo: (() => Promise<void>) | null;
  /** Used to ignore stale auto-dismiss timers when a new snackbar replaces this one. */
  id: number;
};

const SCREEN_WIDTH = Dimensions.get("window").width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.28;
const ROTATE_RANGE = 12;
const SNACKBAR_DURATION_MS = 5000;

export default function EmployerDeckScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [data, setData] = useState<DeckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);

  const pan = useRef(new Animated.ValueXY()).current;
  const snackbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDeck = useCallback(async () => {
    setError(null);
    try {
      const res = await customFetch<DeckResponse>("/api/me/daily-deck");
      setData(res);
      setIndex(0);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 403) {
        setError("Daily picks are only available on employer accounts.");
      } else {
        setError("Could not load today's deck. Please try again.");
      }
      setData(null);
    }
  }, []);

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

  useEffect(() => {
    return () => {
      if (snackbarTimer.current) clearTimeout(snackbarTimer.current);
    };
  }, []);

  const showSnackbar = useCallback(
    (next: Omit<SnackbarState, "id">) => {
      const id = Date.now() + Math.random();
      if (snackbarTimer.current) clearTimeout(snackbarTimer.current);
      setSnackbar({ ...next, id });
      snackbarTimer.current = setTimeout(() => {
        // Only clear if this is still the current snackbar (a newer one
        // would have replaced `id`).
        setSnackbar((current) => (current?.id === id ? null : current));
      }, SNACKBAR_DURATION_MS);
    },
    [],
  );

  const dismissSnackbar = useCallback(() => {
    if (snackbarTimer.current) clearTimeout(snackbarTimer.current);
    setSnackbar(null);
  }, []);

  /**
   * Reverses a swipe by calling the matching DELETE endpoint and
   * rewinding the deck pointer so the original card resurfaces. The
   * underlying `data.items` array still contains the card — we only
   * advance `index` on swipe — so rewinding is enough to restore it.
   */
  const undoSwipe = useCallback(
    async (
      swipedIndex: number,
      item: DeckItem,
      action: SwipeAction,
      extra: { poolId?: number },
    ) => {
      try {
        const url = `/api/me/daily-deck/${item.candidate.id}/${action}`;
        const body =
          action === "shortlist"
            ? JSON.stringify({ poolId: extra.poolId })
            : JSON.stringify({});
        await customFetch(url, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body,
        });
        setIndex((i) => (i > swipedIndex ? swipedIndex : i));
        pan.setValue({ x: 0, y: 0 });
        showSnackbar({
          message: `Restored ${item.candidate.fullName}`,
          onUndo: null,
        });
      } catch {
        showSnackbar({
          message: "Could not undo — please refresh",
          onUndo: null,
        });
      }
    },
    [pan, showSnackbar],
  );

  /**
   * Rewinds the optimistic advance when the server-side write fails,
   * so the card the user just swiped is not silently lost. Only moves
   * `index` backwards (never forwards) so a slow failed POST that lands
   * after the user has already swiped further does not yank them back.
   */
  const rollbackAdvance = useCallback(
    (swipedIndex: number) => {
      setIndex((i) => (i > swipedIndex ? swipedIndex : i));
      pan.setValue({ x: 0, y: 0 });
    },
    [pan],
  );

  const performShortlist = useCallback(
    async (item: DeckItem, swipedIndex: number) => {
      try {
        const res = await customFetch<ShortlistResponse>(
          `/api/me/daily-deck/${item.candidate.id}/shortlist`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId: item.bestJobId ?? undefined,
            }),
          },
        );
        showSnackbar({
          message: `${item.candidate.fullName} added to your shortlist`,
          onUndo:
            res.poolId != null
              ? () =>
                  undoSwipe(swipedIndex, item, "shortlist", {
                    poolId: res.poolId,
                  })
              : null,
        });
      } catch {
        rollbackAdvance(swipedIndex);
        showSnackbar({
          message: "Could not add to shortlist — please try again",
          onUndo: null,
        });
      }
    },
    [rollbackAdvance, showSnackbar, undoSwipe],
  );

  const performDismiss = useCallback(
    async (item: DeckItem, swipedIndex: number) => {
      try {
        await customFetch(`/api/me/daily-deck/${item.candidate.id}/dismiss`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        showSnackbar({
          message: `${item.candidate.fullName} skipped`,
          onUndo: () => undoSwipe(swipedIndex, item, "dismiss", {}),
        });
      } catch {
        rollbackAdvance(swipedIndex);
        showSnackbar({
          message: "Could not skip candidate — please try again",
          onUndo: null,
        });
      }
    },
    [rollbackAdvance, showSnackbar, undoSwipe],
  );

  const current = data?.items[index];

  const advanceAfterSwipe = useCallback(
    (toX: number) => {
      Animated.timing(pan, {
        toValue: { x: toX, y: 0 },
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        pan.setValue({ x: 0, y: 0 });
        setIndex((i) => i + 1);
      });
    },
    [pan],
  );

  const onShortlist = useCallback(() => {
    if (!current || busy) return;
    const swipedItem = current;
    const swipedIndex = index;
    setBusy(true);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    advanceAfterSwipe(SCREEN_WIDTH * 1.4);
    void performShortlist(swipedItem, swipedIndex).finally(() =>
      setBusy(false),
    );
  }, [advanceAfterSwipe, busy, current, index, performShortlist]);

  const onDismiss = useCallback(() => {
    if (!current || busy) return;
    const swipedItem = current;
    const swipedIndex = index;
    setBusy(true);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    advanceAfterSwipe(-SCREEN_WIDTH * 1.4);
    void performDismiss(swipedItem, swipedIndex).finally(() => setBusy(false));
  }, [advanceAfterSwipe, busy, current, index, performDismiss]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 10 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_, gesture) => {
          if (!current) return;
          if (gesture.dx > SWIPE_THRESHOLD) {
            onShortlist();
          } else if (gesture.dx < -SWIPE_THRESHOLD) {
            onDismiss();
          } else {
            Animated.spring(pan, {
              toValue: { x: 0, y: 0 },
              useNativeDriver: true,
              friction: 6,
            }).start();
          }
        },
      }),
    [current, onDismiss, onShortlist, pan],
  );

  const rotate = pan.x.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: [`-${ROTATE_RANGE}deg`, "0deg", `${ROTATE_RANGE}deg`],
  });
  const likeOpacity = pan.x.interpolate({
    inputRange: [0, SWIPE_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const nopeOpacity = pan.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  const screenChrome = (
    <Stack.Screen
      options={{
        title: "Daily picks",
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: {
          color: colors.foreground,
          fontFamily: "Inter_700Bold",
        },
        headerTintColor: colors.foreground,
      }}
    />
  );

  if (user && user.role !== "employer") {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        {screenChrome}
        <View style={[styles.center, { paddingTop: insets.top + 32 }]}>
          <EmptyState
            icon="info"
            title="Employer-only screen"
            subtitle="Daily picks are available on employer accounts."
          />
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        {screenChrome}
        <LoadingSpinner />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        {screenChrome}
        <View style={[styles.center, { paddingTop: insets.top + 32 }]}>
          <EmptyState
            icon="alert-triangle"
            title="Couldn't load deck"
            subtitle={error}
          />
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.flex,
        { backgroundColor: colors.background, paddingTop: insets.top + 8 },
      ]}
    >
      {screenChrome}
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Daily picks
        </Text>
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: "Inter_500Medium",
          }}
        >
          {data ? Math.max(data.items.length - index, 0) : 0} left today
        </Text>
      </View>

      {current ? (
        <View style={styles.deck}>
          <Animated.View
            {...panResponder.panHandlers}
            style={[
              styles.cardWrap,
              {
                transform: [
                  { translateX: pan.x },
                  { translateY: pan.y },
                  { rotate },
                ],
              },
            ]}
          >
            <CandidateCard colors={colors} item={current} />

            <Animated.View
              style={[
                styles.badge,
                styles.badgeLeft,
                { borderColor: colors.primary, opacity: likeOpacity },
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
                { borderColor: colors.destructive, opacity: nopeOpacity },
              ]}
            >
              <Text style={[styles.badgeText, { color: colors.destructive }]}>
                SKIP
              </Text>
            </Animated.View>
          </Animated.View>
        </View>
      ) : (
        <View style={[styles.center, { paddingTop: 24 }]}>
          <EmptyState
            icon="check-circle"
            title="You're all caught up"
            subtitle="No more candidates today — check back tomorrow."
          />
        </View>
      )}

      {current ? (
        <View style={[styles.actions, { paddingBottom: insets.bottom + 24 }]}>
          <Pressable
            onPress={onDismiss}
            disabled={busy}
            style={[
              styles.actionBtn,
              { backgroundColor: colors.muted, borderColor: colors.border },
            ]}
            accessibilityLabel="Skip"
            testID="employer-deck-skip"
          >
            <Feather name="x" size={28} color={colors.destructive} />
          </Pressable>
          <Pressable
            onPress={onShortlist}
            disabled={busy}
            style={[
              styles.actionBtn,
              { backgroundColor: colors.primary, borderColor: colors.primary },
            ]}
            accessibilityLabel="Add to shortlist"
            testID="employer-deck-shortlist"
          >
            <Feather name="heart" size={28} color={colors.primaryForeground} />
          </Pressable>
        </View>
      ) : null}

      {snackbar ? (
        <View
          style={[
            styles.snackbarWrap,
            { bottom: insets.bottom + 96 },
          ]}
          pointerEvents="box-none"
        >
          <View
            style={[
              styles.snackbar,
              {
                backgroundColor: colors.foreground,
                shadowColor: colors.foreground,
              },
            ]}
          >
            <Text
              numberOfLines={2}
              style={[
                styles.snackbarMessage,
                { color: colors.background },
              ]}
              testID="employer-deck-snackbar-message"
            >
              {snackbar.message}
            </Text>
            {snackbar.onUndo ? (
              <Pressable
                onPress={() => {
                  const { onUndo } = snackbar;
                  dismissSnackbar();
                  if (onUndo) void onUndo();
                }}
                testID="employer-deck-snackbar-undo"
                accessibilityLabel="Undo"
                style={({ pressed }) => [
                  styles.snackbarAction,
                  pressed ? { opacity: 0.7 } : null,
                ]}
              >
                <Text
                  style={{
                    color: colors.primary,
                    fontFamily: "Inter_700Bold",
                    fontSize: 14,
                    letterSpacing: 0.4,
                  }}
                >
                  UNDO
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function CandidateCard({
  colors,
  item,
}: {
  colors: ReturnType<typeof useColors>;
  item: DeckItem;
}) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.cardHeader}>
        {item.candidate.avatarUrl ? (
          <Image
            source={{ uri: item.candidate.avatarUrl }}
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
            numberOfLines={2}
            style={{
              fontFamily: "Inter_700Bold",
              fontSize: 18,
              color: colors.foreground,
            }}
          >
            {item.candidate.fullName}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              marginTop: 2,
              color: colors.mutedForeground,
              fontFamily: "Inter_500Medium",
            }}
          >
            {item.candidate.headline}
          </Text>
        </View>
        <View
          style={[styles.score, { backgroundColor: colors.primary }]}
        >
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
        style={{
          marginTop: 14,
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {item.candidate.location ? (
          <Pill colors={colors} icon="map-pin" label={item.candidate.location} />
        ) : null}
        <Pill
          colors={colors}
          icon="briefcase"
          label={`${item.candidate.yearsExperience}y exp`}
        />
        {item.bestJobTitle ? (
          <Pill
            colors={colors}
            icon="target"
            label={`Best: ${item.bestJobTitle}`}
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
            <Text
              style={[
                styles.sectionLabel,
                { color: colors.mutedForeground },
              ]}
            >
              Matches your roles
            </Text>
            <View style={styles.chipRow}>
              {item.matchedSkills.slice(0, 8).map((s) => (
                <SkillChip key={s} label={s} tone="primary" />
              ))}
            </View>
          </>
        ) : null}

        {item.candidate.bio ? (
          <Text
            numberOfLines={6}
            style={{
              marginTop: 14,
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            {item.candidate.bio}
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
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 24 },
  deck: { flex: 1, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4 },
  cardWrap: { ...StyleSheet.absoluteFillObject, margin: 16 },
  card: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    overflow: "hidden",
  },
  cardHeader: { flexDirection: "row", alignItems: "center" },
  avatar: { width: 56, height: 56, borderRadius: 14 },
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
  snackbarWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "stretch",
  },
  snackbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 8,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  snackbarMessage: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    marginRight: 8,
  },
  snackbarAction: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
