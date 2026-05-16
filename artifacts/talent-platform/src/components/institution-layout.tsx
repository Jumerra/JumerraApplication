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
  useSidebar,
} from "@/components/ui/sidebar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  GraduationCap,
  BookOpen,
  Building,
  Pencil,
  Crown,
  ShieldAlert,
  BarChart3,
  Trophy,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  useGetInstitution,
  getGetInstitutionQueryKey,
} from "@workspace/api-client-react";
import { academicUnitTerms } from "@/lib/institution-kinds";
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

type InstitutionNavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * If set, the item is only shown when the auth helper grants this
   * permission OR when the org-role check below also passes.
   */
  permission?: string;
  /** Restrict to specific org roles. If absent, visible to any member. */
  orgRoles?: ReadonlyArray<
    "owner" | "registrar" | "dean" | "hod" | "coordinator" | "staff"
  >;
};

type InstitutionNavGroup = {
  label: string;
  items: InstitutionNavItem[];
};

function isActive(current: string, href: string): boolean {
  if (href === "/dashboard/institution") return current === href;
  return current === href || current.startsWith(href + "/");
}

/**
 * Renders one sidebar link. On mobile (where the sidebar is an
 * off-canvas Sheet) we close the sheet on click — otherwise the user
 * has to manually dismiss it after every navigation, which feels
 * broken on phones.
 */
function NavLink({
  href,
  label,
  icon: Icon,
  active,
  testId,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  active: boolean;
  testId: string;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <Link
          href={href}
          data-testid={testId}
          onClick={() => {
            if (isMobile) setOpenMobile(false);
          }}
        >
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function InstitutionLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { sessionUser, role, hasPermission } = useAuth();

  const isInstitutionUser =
    sessionUser?.role === "institution" || role === "institution";
  const orgRole = sessionUser?.orgRole ?? null;
  const isOwner = orgRole === "owner";
  // Registrars are owner-equivalent for institution operations and should
  // see the same nav items as owners.
  const isOwnerOrRegistrar = isOwner || orgRole === "registrar";

  // Read the institution kind so the "Programs" vs "Departments" label
  // stays in sync with whatever the institution type is.
  const institutionId =
    sessionUser?.role === "institution" ? sessionUser.institutionId : null;
  const { data: currentInstitution } = useGetInstitution(institutionId ?? 0, {
    query: {
      queryKey: getGetInstitutionQueryKey(institutionId ?? 0),
      enabled: institutionId != null,
    },
  });
  const academicTerms = academicUnitTerms(currentInstitution?.type);

  const NAV: InstitutionNavGroup[] = [
    {
      label: "Overview",
      items: [
        {
          href: "/dashboard/institution",
          label: "Dashboard",
          icon: LayoutDashboard,
        },
        {
          href: "/dashboard/institution/analytics",
          label: "Placement analytics",
          icon: BarChart3,
        },
        {
          href: "/dashboard/institution/cohorts",
          label: "Cohorts",
          icon: Trophy,
        },
      ],
    },
    {
      label: "Manage",
      items: [
        // Faculties live above departments in the academic hierarchy, so
        // we surface them first when the institution actually uses them.
        ...(academicTerms.hasFaculties
          ? [
              {
                href: "/dashboard/institution/faculties",
                label: academicTerms.facultyPlural,
                icon: Building,
              } satisfies InstitutionNavItem,
            ]
          : []),
        {
          href: "/dashboard/institution/departments",
          label: academicTerms.plural,
          icon: BookOpen,
        },
        {
          href: "/dashboard/institution/facilities",
          label: "Facilities",
          icon: Building,
        },
      ],
    },
    {
      label: "Team",
      items: [
        {
          href: "/dashboard/institution/staff",
          label: "Team",
          icon: Users,
          permission: "staff:manage",
          orgRoles: ["owner", "registrar"],
        },
        {
          href: "/dashboard/institution/roles",
          label: "Roles & permissions",
          icon: ShieldCheck,
          orgRoles: ["owner", "registrar"],
        },
      ],
    },
    {
      label: "Settings",
      items: [
        {
          href: "/dashboard/institution/edit",
          label: "Edit institution",
          icon: Pencil,
          orgRoles: ["owner", "registrar"],
        },
        {
          href: "/dashboard/institution/subscription",
          label: "Subscription",
          icon: Crown,
          // Subscription/billing is owner-only — registrars manage academic
          // ops but not commercial concerns.
          orgRoles: ["owner"],
        },
      ],
    },
  ];

  // Filter each group: an item is visible if its orgRole list (when
  // present) includes the user's role, OR the requested permission is
  // granted. Keeps owners seeing everything while still letting
  // permission-based access (e.g. staff:manage delegated to a non-owner)
  // surface the link.
  const visibleNav = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (!item.orgRoles && !item.permission) return true;
      const allowedByRole =
        item.orgRoles &&
        orgRole &&
        item.orgRoles.includes(
          orgRole as
            | "owner"
            | "registrar"
            | "dean"
            | "hod"
            | "coordinator"
            | "staff",
        );
      const allowedByPermission =
        item.permission && hasPermission(item.permission);
      // Owners (and registrars, who are owner-equivalent) see every nav
      // item regardless of explicit permission.
      if (isOwnerOrRegistrar) return true;
      return Boolean(allowedByRole || allowedByPermission);
    }),
  })).filter((group) => group.items.length > 0);

  if (!isInstitutionUser) {
    return (
      <div className="container max-w-md py-16">
        <Card>
          <CardContent className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">Institution access required</p>
            <p className="text-sm text-muted-foreground mt-2">
              Sign in with an institution account to open this dashboard.
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
            href="/dashboard/institution"
            className="flex items-center gap-2 px-2 py-1.5 font-semibold text-sm"
            data-testid="link-institution-sidebar-home"
          >
            <GraduationCap className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate group-data-[collapsible=icon]:hidden">
              {currentInstitution?.name ?? "Institution"}
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          {visibleNav.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      active={isActive(location, item.href)}
                      testId={`link-institution-${item.href.split("/").pop()}`}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <div className="px-2 py-1.5 text-xs text-muted-foreground truncate group-data-[collapsible=icon]:hidden">
            Signed in as {sessionUser?.fullName ?? "Institution"}
          </div>
          <SidebarLogoutButton />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <div className="sticky top-16 z-30 flex items-center gap-2 border-b border-border/40 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger data-testid="button-institution-sidebar-toggle" />
          <span className="text-sm font-medium text-muted-foreground">
            Institution
          </span>
        </div>
        <div className="min-h-[calc(100svh-4rem-3rem)]">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
