import { createContext, useContext, ReactNode, useMemo, useState } from "react";
import {
  useGetCurrentUser,
  type AuthUser,
} from "@workspace/api-client-react";

export type Role = "candidate" | "employer" | "institution" | "admin" | null;

interface AuthState {
  /** Effective role used for UI gating (real session > demo). */
  role: Role;
  /** Effective userId used for legacy /dashboard endpoints. */
  userId: number | null;
  /** The real authenticated user (null if no session). */
  sessionUser: AuthUser | null;
  /** True while the initial /auth/me check is in flight. */
  isLoading: boolean;
  /** Demo "View as" role (only used when no real session is present). */
  demoRole: Role;
  setDemoRole: (role: Role) => void;
  /** Refetch current session — call after login/logout/setup. */
  refresh: () => Promise<unknown>;
  /**
   * True if the signed-in user has the given admin permission key.
   * Demo (non-session) admin role is treated as full super-admin so
   * the existing "View as Admin" workflow keeps working.
   */
  hasPermission: (key: string) => boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [demoRole, setDemoRoleState] = useState<Role>(() => {
    if (typeof window === "undefined") return null;
    const saved = localStorage.getItem("talentlink_role");
    return (saved as Role) || null;
  });

  const setDemoRole = (newRole: Role) => {
    setDemoRoleState(newRole);
    if (typeof window !== "undefined") {
      if (newRole) {
        localStorage.setItem("talentlink_role", newRole);
      } else {
        localStorage.removeItem("talentlink_role");
      }
    }
  };

  const { data, isLoading, refetch } = useGetCurrentUser({
    query: { staleTime: 30_000, retry: false },
  });

  const sessionUser = (data?.user ?? null) as AuthUser | null;

  const value = useMemo<AuthState>(() => {
    if (sessionUser) {
      const linkedId =
        sessionUser.candidateId ??
        sessionUser.employerId ??
        sessionUser.institutionId ??
        null;
      const permsSet = new Set(sessionUser.permissions ?? []);
      return {
        role: sessionUser.role as Role,
        userId: linkedId,
        sessionUser,
        isLoading,
        demoRole,
        setDemoRole,
        refresh: refetch,
        hasPermission: (key: string) => permsSet.has(key),
      };
    }
    // While the initial /auth/me check is in flight, do NOT fall back to
    // the persisted demo role — that would briefly render a wrong-role UI
    // and fire dashboard requests with the demo userId before the real
    // session resolves.
    if (isLoading) {
      return {
        role: null,
        userId: null,
        sessionUser: null,
        isLoading,
        demoRole,
        setDemoRole,
        refresh: refetch,
        hasPermission: () => false,
      };
    }
    return {
      role: demoRole,
      userId: demoRole && demoRole !== "admin" ? 1 : null,
      sessionUser: null,
      isLoading,
      demoRole,
      setDemoRole,
      refresh: refetch,
      // Demo admin (View as Admin without a real session) is treated as
      // a super-admin so the demo experience still shows everything.
      hasPermission: () => demoRole === "admin",
    };
  }, [sessionUser, isLoading, demoRole, refetch]);

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/**
 * For convenience in legacy components that still import setRole.
 * Maps onto demoRole so the "View as" dropdown keeps working.
 */
export function useDemoRoleSetter() {
  const { setDemoRole } = useAuth();
  return setDemoRole;
}

export type { AuthUser };
