import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Users,
  Building2,
  GraduationCap,
  ShieldAlert,
  UserPlus,
  Sparkles,
  UsersRound,
  Compass,
  Briefcase,
  Trophy,
  Network,
  ShieldCheck,
  Rocket,
  FileText,
  Crown,
  Handshake,
  TrendingUp,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { SidebarLogoutButton } from "@/components/sidebar-logout";

const SIDEBAR_COOKIE_NAME = "sidebar_state";

function readSidebarCookie(): boolean {
  if (typeof document === "undefined") return true;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${SIDEBAR_COOKIE_NAME}=`));
  if (!match) return true;
  return match.split("=")[1] !== "false";
}

type AdminNavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * Permission key required to see this nav item. Items with no
   * `permission` are always visible (e.g. the dashboard landing page).
   */
  permission?: string;
  /** Only super-admins ever see items flagged with this. */
  superAdminOnly?: boolean;
};

type AdminNavGroup = {
  label: string;
  items: AdminNavItem[];
};

const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard/admin", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/dashboard/admin/candidates", label: "Candidates", icon: Users, permission: "candidates:view" },
      { href: "/dashboard/admin/employers", label: "Employers", icon: Building2, permission: "employers:view" },
      { href: "/dashboard/admin/institutions", label: "Institutions", icon: GraduationCap, permission: "institutions:view" },
      { href: "/dashboard/admin/applications", label: "Applications", icon: Briefcase, permission: "applications:view" },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        href: "/dashboard/admin/revenue",
        label: "Platform revenue",
        icon: TrendingUp,
        permission: "payments:view",
      },
      { href: "/dashboard/admin/hires", label: "Hires analytics", icon: Trophy, permission: "hires:view" },
      {
        href: "/dashboard/admin/partner-analytics",
        label: "Partner analytics",
        icon: Network,
        permission: "partner-analytics:view",
      },
      {
        href: "/dashboard/admin/account-managers",
        label: "Account managers",
        icon: UsersRound,
        permission: "account-managers:view",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/dashboard/admin/registrations", label: "Registrations", icon: ShieldAlert, permission: "registrations:view" },
      { href: "/dashboard/admin/onboard", label: "Onboard partner", icon: UserPlus, permission: "onboard:create" },
      { href: "/dashboard/admin/site-content", label: "Site content", icon: Sparkles, permission: "site-content:edit" },
      { href: "/dashboard/admin/network", label: "Network moderation", icon: Users, permission: "site-content:edit" },
      { href: "/dashboard/admin/partners", label: "Our Partners", icon: Handshake },
      { href: "/dashboard/admin/boost-settings", label: "Profile Boost", icon: Rocket },
      { href: "/dashboard/admin/cv-settings", label: "AI CV Builder", icon: FileText },
      { href: "/dashboard/admin/institution-subscription-settings", label: "Institution Subscription", icon: Crown },
      { href: "/dashboard/admin/job-tier-settings", label: "Job Tiers (Promote/Sponsor)", icon: Briefcase },
      { href: "/dashboard/admin/staff", label: "Admin team", icon: UsersRound, permission: "staff:view" },
      { href: "/dashboard/admin/roles", label: "Roles & permissions", icon: ShieldCheck, superAdminOnly: true },
      { href: "/dashboard/admin/trash", label: "Trash", icon: Trash2, permission: "candidates:manage" },
    ],
  },
];

function isActive(current: string, href: string): boolean {
  if (href === "/dashboard/admin") return current === href;
  return current === href || current.startsWith(href + "/");
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { sessionUser, role, hasPermission } = useAuth();

  // Centralized admin guard so every page wrapped in AdminLayout is
  // protected without each page repeating the check. The underlying API
  // middleware also enforces admin-only on every action endpoint.
  const isAdmin = sessionUser?.role === "admin" || role === "admin";
  const isSuperAdmin =
    (sessionUser?.role === "admin" &&
      (sessionUser.orgRole === "super_admin" || sessionUser.orgRole === null)) ||
    (!sessionUser && role === "admin");

  // Filter nav items by what this admin can access. Super-admin sees
  // everything; demo "View as Admin" also sees everything (hasPermission
  // returns true for it). Other admins only see permitted items.
  const visibleNav = ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.superAdminOnly) return isSuperAdmin;
      if (!item.permission) return true;
      return hasPermission(item.permission);
    }),
  })).filter((group) => group.items.length > 0);

  if (!isAdmin) {
    return (
      <div className="container max-w-md py-16">
        <Card>
          <CardContent className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">Admin access required</p>
            <p className="text-sm text-muted-foreground mt-2">
              Sign in with an administrator account to open the admin console.
            </p>
            <Button asChild className="mt-4">
              <Link href="/login">Sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <SidebarProvider defaultOpen={readSidebarCookie()}>
      <Sidebar collapsible="icon" className="top-16 h-[calc(100svh-4rem)]">
        <SidebarHeader>
          <Link
            href="/dashboard/admin"
            className="flex items-center gap-2 px-2 py-1.5 font-semibold text-sm"
          >
            <Compass className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate group-data-[collapsible=icon]:hidden">
              Admin Console
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          {visibleNav.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(location, item.href);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.label}
                        >
                          <Link href={item.href}>
                            <Icon className="h-4 w-4" />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <div className="px-2 py-1.5 text-xs text-muted-foreground truncate group-data-[collapsible=icon]:hidden">
            Signed in as {sessionUser?.fullName ?? "Admin"}
          </div>
          <SidebarLogoutButton />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <div className="sticky top-16 z-30 flex items-center gap-2 border-b border-border/40 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger />
          <span className="text-sm font-medium text-muted-foreground">
            Admin
          </span>
        </div>
        <div className="min-h-[calc(100svh-4rem-3rem)]">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
