import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type Role = "candidate" | "employer" | "institution" | "admin" | null;

interface AuthState {
  role: Role;
  userId: number | null; // usually 1 if not admin/null
  setRole: (role: Role) => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => {
    const saved = localStorage.getItem("talentlink_role");
    return (saved as Role) || null;
  });

  const setRole = (newRole: Role) => {
    setRoleState(newRole);
    if (newRole) {
      localStorage.setItem("talentlink_role", newRole);
    } else {
      localStorage.removeItem("talentlink_role");
    }
  };

  const userId = role && role !== "admin" ? 1 : null;

  return (
    <AuthContext.Provider value={{ role, userId, setRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
