import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApplyConfirmSheet } from "@/components/ApplyConfirmSheet";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { SkillChip } from "@/components/SkillChip";
import { useColors } from "@/hooks/useColors";

type FeedItem = {
  jobId: number;
  title: string;
  description: string;
  location: string;
  type: string;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  skills: string[];
  employer: {
    id: number;
    name: string;
    logoUrl: string;
    industry: string;
    location: string;
  } | null;
  matchScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  summary: string;
  tier: "free" | "promoted" | "sponsored";
};

const SCREEN_WIDTH = Dimensions.get("window").width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.28;
const ROTATE_RANGE = 12;

export default function ForYouScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [items, setItems] = useState<FeedItem[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmJobId, setConfirmJobId] = useState<number | null>(null);
  const [confirmJobTitle, setConfirmJobTitle] = useState<string | undefined>();
  const [confirmEmployerName, setConfirmEmployerName] = useState<
    string | undefined
  >();

  const pan = useRef(new Animated.ValueXY()).current;

  const loadFeed = useCallback(async () => {
    setError(null);
    try {
      const res = await customFetch<{ items: FeedItem[] }>("/api/me/feed");
      setItems(res.items ?? []);
      setIndex(0);
    } catch {
      setError("Couldn't load your For You feed.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadFeed().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadFeed]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFeed();
    setRefreshing(false);
  }, [loadFeed]);

  const advance = useCallback(() => {
    pan.setValue({ x: 0, y: 0 });
    setIndex((i) => i + 1);
  }, [pan]);

  const dismiss = useCallback(
    async (jobId: number) => {
      try {
        await customFetch("/api/me/feed/dismiss", {
          method: "POST",
          body: JSON.stringify({ jobId }),
        });
      } catch {
        // best-effort: even if persistence fails the local advance is fine
      }
    },
    [],
  );

  const onSwipeRight = useCallback(
    (item: FeedItem) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }
      setConfirmJobId(item.jobId);
      setConfirmJobTitle(item.title);
      setConfirmEmployerName(item.employer?.name);
      Animated.timing(pan, {
        toValue: { x: SCREEN_WIDTH * 1.4, y: 0 },
        duration: 220,
        useNativeDriver: true,
      }).start();
    },
    [pan],
  );

  const onSwipeLeft = useCallback(
    (item: FeedItem) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      void dismiss(item.jobId);
      Animated.timing(pan, {
        toValue: { x: -SCREEN_WIDTH * 1.4, y: 0 },
        duration: 220,
        useNativeDriver: true,
      }).start(() => advance());
    },
    [advance, dismiss, pan],
  );

  const current = items[index];
  const next = items[index + 1];

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_, gesture) => {
          if (!current) return;
          if (gesture.dx > SWIPE_THRESHOLD) {
            onSwipeRight(current);
          } else if (gesture.dx < -SWIPE_THRESHOLD) {
            onSwipeLeft(current);
          } else {
            Animated.spring(pan, {
              toValue: { x: 0, y: 0 },
              useNativeDriver: true,
              friction: 6,
            }).start();
          }
        },
      }),
    [current, onSwipeLeft, onSwipeRight, pan],
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

  if (loading) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
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
          title="Couldn't load For You"
          subtitle={error}
        />
      </ScrollView>
    );
  }

  if (!current) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={[styles.center, { paddingTop: insets.top + 32 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={{ paddingHorizontal: 24, alignItems: "center" }}>
          <Feather name="check-circle" size={48} color={colors.primary} />
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
            }}
          >
            We'll surface new strong matches here as they come in. Pull down to
            refresh anytime.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <View
      style={[
        styles.flex,
        { backgroundColor: colors.background, paddingTop: insets.top + 8 },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>For You</Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>
          {Math.max(items.length - index, 0)} match
          {items.length - index === 1 ? "" : "es"} left
        </Text>
      </View>

      <View style={styles.deck}>
        {next ? (
          <CardView
            colors={colors}
            item={next}
            style={[styles.cardBehind]}
            pointerEvents="none"
          />
        ) : null}

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
          <CardView colors={colors} item={current} />

          <Animated.View
            style={[
              styles.badge,
              styles.badgeLeft,
              { borderColor: colors.primary, opacity: likeOpacity },
            ]}
          >
            <Text style={[styles.badgeText, { color: colors.primary }]}>
              APPLY
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

      <View style={[styles.actions, { paddingBottom: insets.bottom + 80 }]}>
        <Pressable
          onPress={() => current && onSwipeLeft(current)}
          style={[
            styles.actionBtn,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
          accessibilityLabel="Skip"
        >
          <Feather name="x" size={28} color={colors.destructive} />
        </Pressable>
        <Pressable
          onPress={() => current && onSwipeRight(current)}
          style={[
            styles.actionBtn,
            { backgroundColor: colors.primary, borderColor: colors.primary },
          ]}
          accessibilityLabel="Apply"
        >
          <Feather name="check" size={28} color={colors.primaryForeground} />
        </Pressable>
      </View>

      <ApplyConfirmSheet
        visible={confirmJobId != null}
        jobId={confirmJobId}
        jobTitle={confirmJobTitle}
        employerName={confirmEmployerName}
        applicationSource="for_you"
        onClose={() => {
          setConfirmJobId(null);
          // Snap card back to neutral if user cancels
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
            friction: 6,
          }).start();
        }}
        onSubmitted={() => {
          setConfirmJobId(null);
          queryClient.invalidateQueries({ queryKey: ["applications"] });
          // Skip past the applied card
          advance();
        }}
      />
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
  item: FeedItem;
  style?: object | object[];
  pointerEvents?: "auto" | "none";
}) {
  return (
    <View
      pointerEvents={pointerEvents}
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      <View style={styles.cardHeader}>
        {item.employer?.logoUrl ? (
          <Image
            source={{ uri: item.employer.logoUrl }}
            style={styles.logo}
            contentFit="cover"
          />
        ) : (
          <View
            style={[
              styles.logo,
              { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
            ]}
          >
            <Feather name="briefcase" size={20} color={colors.mutedForeground} />
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
            {item.title}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              marginTop: 2,
              color: colors.mutedForeground,
              fontFamily: "Inter_500Medium",
            }}
          >
            {item.employer?.name ?? "Unknown employer"}
          </Text>
        </View>
        <View
          style={[
            styles.score,
            { backgroundColor: colors.primary },
          ]}
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

      <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {item.location ? (
          <Pill colors={colors} icon="map-pin" label={item.location} />
        ) : null}
        {item.type ? <Pill colors={colors} icon="clock" label={item.type} /> : null}
        {item.salaryMin || item.salaryMax ? (
          <Pill
            colors={colors}
            icon="dollar-sign"
            label={`${item.currency ?? ""} ${item.salaryMin ?? ""}${item.salaryMax ? `–${item.salaryMax}` : ""}`.trim()}
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
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              You match
            </Text>
            <View style={styles.chipRow}>
              {item.matchedSkills.slice(0, 8).map((s) => (
                <SkillChip key={s} label={s} tone="primary" />
              ))}
            </View>
          </>
        ) : null}

        {item.description ? (
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
            {item.description}
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
  logo: { width: 44, height: 44, borderRadius: 10 },
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
  badgeText: { fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: 1 },
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
