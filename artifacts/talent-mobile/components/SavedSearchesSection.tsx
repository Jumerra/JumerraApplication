import { useQueryClient } from "@tanstack/react-query";
import {
  getListSavedSearchesQueryKey,
  useCreateSavedSearch,
  useDeleteSavedSearch,
  useListSavedSearches,
  useUpdateSavedSearch,
  type SavedSearch,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

type Props = {
  candidateId: number;
  /** Opaque snapshot of the search screen's full query state. Saved as
   *  a JSON blob server-side so the saved search can fully restore
   *  every facet, not just the two columns the alert matcher uses. */
  currentFilters: Record<string, unknown> & {
    searchText?: string;
    jobType?: string;
  };
  currentSortBy?: string;
};

export function SavedSearchesSection({
  candidateId,
  currentFilters,
  currentSortBy,
}: Props) {
  const colors = useColors();
  const qc = useQueryClient();
  const queryKey = getListSavedSearchesQueryKey(candidateId);
  const { data: searches } = useListSavedSearches(candidateId, {
    query: { queryKey, enabled: candidateId > 0 },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const createMut = useCreateSavedSearch({
    mutation: { onSuccess: invalidate },
  });
  const updateMut = useUpdateSavedSearch({
    mutation: { onSuccess: invalidate },
  });
  const deleteMut = useDeleteSavedSearch({
    mutation: { onSuccess: invalidate },
  });

  const [name, setName] = useState("");

  if (candidateId <= 0) return null;

  const onSave = () => {
    if (!name.trim()) return;
    createMut.mutate(
      {
        id: candidateId,
        data: {
          name: name.trim(),
          searchText: currentFilters.searchText ?? null,
          jobType: (currentFilters.jobType as never) ?? null,
          sortBy: currentSortBy ?? null,
          filters: currentFilters,
          emailAlerts: true,
          inAppAlerts: true,
        },
      },
      { onSuccess: () => setName("") },
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Feather name="bookmark" size={16} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground }]}>
          Saved searches
        </Text>
      </View>

      <View
        style={[
          styles.composerRow,
          {
            backgroundColor: colors.secondary,
            borderRadius: colors.radius,
          },
        ]}
      >
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name this search"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground }]}
        />
        <Pressable
          onPress={onSave}
          disabled={!name.trim() || createMut.isPending}
          style={[
            styles.saveBtn,
            {
              backgroundColor: name.trim() ? colors.primary : colors.muted,
              borderRadius: colors.radius,
              opacity: createMut.isPending ? 0.6 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.saveBtnText,
              { color: colors.primaryForeground },
            ]}
          >
            Save
          </Text>
        </Pressable>
      </View>

      {(searches ?? []).map((s: SavedSearch) => (
        <View
          key={s.id}
          style={[
            styles.row,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius,
            },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.rowTitle, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {s.name}
            </Text>
            <Text
              style={[styles.rowSub, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {[s.searchText, s.jobType?.replace("_", " ")]
                .filter(Boolean)
                .join(" · ") || "All jobs"}
              {s.newMatchCount > 0 ? `  ·  ${s.newMatchCount} new` : ""}
            </Text>
          </View>
          <View style={styles.channelStack}>
            <View style={styles.channelRow}>
              <Text
                style={[
                  styles.channelLabel,
                  { color: colors.mutedForeground },
                ]}
              >
                In-app
              </Text>
              <Switch
                value={s.inAppAlerts}
                onValueChange={(checked) =>
                  updateMut.mutate({
                    id: candidateId,
                    searchId: s.id,
                    data: { inAppAlerts: checked },
                  })
                }
              />
            </View>
            <View style={styles.channelRow}>
              <Text
                style={[
                  styles.channelLabel,
                  { color: colors.mutedForeground },
                ]}
              >
                Email
              </Text>
              <Switch
                value={s.emailAlerts}
                onValueChange={(checked) =>
                  updateMut.mutate({
                    id: candidateId,
                    searchId: s.id,
                    data: { emailAlerts: checked },
                  })
                }
              />
            </View>
          </View>
          <Pressable
            onPress={() =>
              deleteMut.mutate({ id: candidateId, searchId: s.id })
            }
            hitSlop={8}
          >
            <Feather name="trash-2" size={16} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
    gap: 6,
  },
  input: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    paddingVertical: 8,
  },
  saveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderWidth: 1,
  },
  rowTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  rowSub: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    marginTop: 2,
  },
  channelStack: {
    gap: 4,
  },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  channelLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    minWidth: 36,
    textAlign: "right",
  },
});
