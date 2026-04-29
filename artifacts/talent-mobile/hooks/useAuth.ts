import { useQueryClient } from "@tanstack/react-query";
import {
  type AuthUser,
  getGetCurrentUserQueryKey,
  useGetCurrentUser,
  useLogoutUser,
} from "@workspace/api-client-react";
import { useCallback } from "react";

export type UseAuthResult = {
  user: AuthUser | null;
  isLoading: boolean;
  isError: boolean;
  signOut: () => Promise<void>;
  signOutPending: boolean;
};

export function useAuth(): UseAuthResult {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useGetCurrentUser({
    query: {
      queryKey: getGetCurrentUserQueryKey(),
      staleTime: 30_000,
      retry: 0,
    },
  });
  const logout = useLogoutUser();

  const signOut = useCallback(async (): Promise<void> => {
    // Only clear local auth state on confirmed server logout. If the request
    // fails we surface the error so the UI can inform the user; otherwise
    // we'd be lying to them ("signed out" while the server session is alive),
    // and the next /auth/me refetch would silently log them back in.
    await logout.mutateAsync();
    queryClient.setQueryData(getGetCurrentUserQueryKey(), { user: null });
    await queryClient.invalidateQueries({
      queryKey: getGetCurrentUserQueryKey(),
    });
  }, [logout, queryClient]);

  return {
    user: data?.user ?? null,
    isLoading,
    isError,
    signOut,
    signOutPending: logout.isPending,
  };
}
