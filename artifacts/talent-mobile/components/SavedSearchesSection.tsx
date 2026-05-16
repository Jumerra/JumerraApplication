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
  currentFilters: { searchText?: string; jobType?: string };
};

export function SavedSearchesSection({ candidateId, currentFilters }: Props) {
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
          alertsEnabled: true,
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
          <Switch
            value={s.alertsEnabled}
            onValueChange={(checked) =>
              updateMut.mutate({
                id: candidateId,
                searchId: s.id,
                data: { alertsEnabled: checked },
              })
            }
          />
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
});
