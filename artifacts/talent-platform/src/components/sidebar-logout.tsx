import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useLogoutUser,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { LogOut } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { clearWebSessionToken } from "@/lib/web-session";

/**
 * Sign-out button shown in the footer of every authenticated dashboard
 * sidebar (institution, employer, admin). Mirrors the logout flow used
 * by the public layout's account dropdown so behaviour stays consistent.
 */
export function SidebarLogoutButton() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const logout = useLogoutUser();

  async function handleLogout() {
    try {
      await logout.mutateAsync();
    } finally {
      clearWebSessionToken();
      await queryClient.invalidateQueries({
        queryKey: getGetCurrentUserQueryKey(),
      });
      navigate("/");
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={handleLogout}
          disabled={logout.isPending}
          tooltip="Sign out"
          data-testid="button-sidebar-logout"
        >
          <LogOut className="h-4 w-4" />
          <span>Sign out</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
