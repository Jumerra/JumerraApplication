import { Feather } from "@expo/vector-icons";
import { customFetch } from "@workspace/api-client-react";
import { Image } from "expo-image";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type Story = {
  id: number;
  quote: string;
  photoUrl: string | null;
  candidate: {
    id: number;
    fullName: string;
    avatarUrl: string | null;
    headline: string | null;
  };
  employer: {
    id: number;
    name: string;
    logoUrl: string | null;
  };
};

export function StudentStoriesPanel() {
  const colors = useColors();
  const [stories, setStories] = React.useState<Story[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    customFetch<{ stories: Story[] }>("/api/placement-stories")
      .then((d) => setStories(d?.stories ?? []))
      .catch(() => setStories([]))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || stories.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Student stories
        </Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          Recent placements from the Jumerra community
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {stories.map((s) => (
          <View
            key={s.id}
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
              {s.candidate.avatarUrl ? (
                <Image
                  source={{ uri: s.candidate.avatarUrl }}
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
                  <Feather name="user" size={18} color={colors.mutedForeground} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.name, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {s.candidate.fullName}
                </Text>
                {s.candidate.headline ? (
                  <Text
                    style={[styles.meta, { color: colors.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {s.candidate.headline}
                  </Text>
                ) : null}
              </View>
            </View>
            <Text
              style={[styles.quote, { color: colors.foreground }]}
              numberOfLines={4}
            >
              “{s.quote}”
            </Text>
            {s.employer?.name ? (
              <View style={styles.employerRow}>
                <Feather name="briefcase" size={12} color={colors.mutedForeground} />
                <Text
                  style={[styles.employer, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  Hired at {s.employer.name}
                </Text>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 24, gap: 12 },
  header: { paddingHorizontal: 20, gap: 4 },
  title: { fontFamily: "Inter_700Bold", fontSize: 18, letterSpacing: -0.3 },
  sub: { fontFamily: "Inter_400Regular", fontSize: 13 },
  row: { paddingHorizontal: 20, gap: 12 },
  card: {
    width: 280,
    padding: 16,
    borderWidth: 1,
    gap: 12,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  name: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 12 },
  quote: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  employerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  employer: { fontFamily: "Inter_500Medium", fontSize: 12, flex: 1 },
});
