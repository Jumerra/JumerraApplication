import { useGetJob } from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";

import { ApplyConfirmSheet } from "@/components/ApplyConfirmSheet";
import { EmptyState } from "@/components/EmptyState";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useColors } from "@/hooks/useColors";

/**
 * One-tap apply screen. The legacy multi-step cover-note form has
 * been replaced by `<ApplyConfirmSheet>`, which surfaces the saved
 * profile + CV snapshot the employer will see and submits with a
 * single tap. Same backend (`POST /applications`) — the server
 * derives the candidate from the session and stores the application
 * against their saved profile data.
 */
export default function ApplyScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ id: string }>();
  const jobId = Number(params.id);
  const { data: job, isLoading, isError } = useGetJob(jobId);

  // Open the sheet immediately so this route behaves like a modal
  // confirmation, matching the For You swipe-right experience.
  const [open, setOpen] = useState(true);

  // Cancel path: dismiss the sheet and go back. NOT used for success —
  // success uses `onSubmitted` which navigates to /applications, so we
  // must not also fire `router.back()` or we end up double-navigating.
  const close = () => {
    setOpen(false);
    if (router.canGoBack()) {
      router.back();
    }
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingSpinner />
      </View>
    );
  }

  if (isError || !job) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <EmptyState
          icon="alert-circle"
          title="Couldn't load this job"
          subtitle="Please go back and try again."
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ApplyConfirmSheet
        visible={open}
        jobId={jobId}
        jobTitle={job.title}
        employerName={job.employerName}
        onClose={close}
        onSubmitted={() => {
          setOpen(false);
          router.replace("/applications" as never);
        }}
      />
    </View>
  );
}
