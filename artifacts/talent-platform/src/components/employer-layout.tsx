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
  Building2,
  Briefcase,
  PlusCircle,
  ShieldAlert,
  Crown,
  Users2,
  KanbanSquare,
  MessageSquare,
  Sparkles,
  ArrowLeft,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useGetEmployerSubscriptionSettings, getGetEmployerSubscriptionSettingsQueryKey } from "@workspace/api-client-react";
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

type EmployerNavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: string;
  orgRoles?: ReadonlyArray<"owner" | "coordinator" | "staff">;
};

type EmployerNavGroup = {
  label: string;
  items: EmployerNavItem[];
};

function isActive(current: string, href: string): boolean {
  if (href === "/dashboard/employer") return current === href;
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

export function EmployerLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { sessionUser, role, hasPermission } = useAuth();

  const isEmployerUser =
    sessionUser?.role === "employer" || role === "employer";
  const orgRole = sessionUser?.orgRole ?? null;
  const isOwner = orgRole === "owner";

  // The legacy recurring subscription model has been retired in
  // favour of per-post pricing (free / Promoted / Sponsored). Hide
  // the "Subscription" nav entry while the admin feature flag is
  // off so owners don't bounce into a disabled page. If an admin
  // re-enables it the link reappears automatically.
  const { data: subSettings } = useGetEmployerSubscriptionSettings({
    query: {
      queryKey: getGetEmployerSubscriptionSettingsQueryKey(),
      enabled: isEmployerUser,
    },
  });
  const subscriptionsEnabled = subSettings?.isActive === true;

  const NAV: EmployerNavGroup[] = [
    {
      label: "Overview",
      items: [
        {
          href: "/dashboard/employer",
          label: "Dashboard",
          icon: LayoutDashboard,
        },
      ],
    },
    {
      label: "Hiring",
      items: [
        {
          href: "/jobs",
          label: "Browse jobs",
          icon: Briefcase,
        },
        {
          href: "/post-job",
          label: "Post a job",
          icon: PlusCircle,
        },
        {
          href: "/candidates",
          label: "Talent",
          icon: Users,
        },
        {
          href: "/dashboard/employer/pipeline",
          label: "Pipeline",
          icon: KanbanSquare,
        },
        {
          href: "/dashboard/employer/talent-pools",
          label: "Talent pools",
          icon: Users2,
        },
        {
          href: "/dashboard/employer/open-candidates",
          label: "Open candidates",
          icon: Sparkles,
        },
        {
          href: "/dashboard/employer/templates",
          label: "Templates",
          icon: MessageSquare,
        },
      ],
    },
    ...(subscriptionsEnabled
      ? ([
          {
            label: "Billing",
            items: [
              {
                href: "/dashboard/employer/subscription",
                label: "Subscription",
                icon: Crown,
                orgRoles: ["owner"],
              },
            ],
          },
        ] as EmployerNavGroup[])
      : []),
    {
      label: "Team",
      items: [
        {
          href: "/dashboard/employer/staff",
          label: "Team",
          icon: Users,
          permission: "staff:manage",
          orgRoles: ["owner"],
        },
        {
          href: "/dashboard/employer/roles",
          label: "Roles & permissions",
          icon: ShieldCheck,
          orgRoles: ["owner"],
        },
      ],
    },
  ];

  // Filter items: owners see everything; others need the matching
  // permission OR an explicit org-role allowance.
  const visibleNav = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (!item.orgRoles && !item.permission) return true;
      if (isOwner) return true;
      const allowedByRole =
        item.orgRoles &&
        orgRole &&
        item.orgRoles.includes(orgRole as "owner" | "coordinator" | "staff");
      const allowedByPermission =
        item.permission && hasPermission(item.permission);
      return Boolean(allowedByRole || allowedByPermission);
    }),
  })).filter((group) => group.items.length > 0);

  if (!isEmployerUser) {
    return (
      <div className="container max-w-md py-16">
        <Card>
          <CardContent className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">Employer access required</p>
            <p className="text-sm text-muted-foreground mt-2">
              Sign in with an employer account to open this dashboard.
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
            href="/dashboard/employer"
            className="flex items-center gap-2 px-2 py-1.5 font-semibold text-sm"
            data-testid="link-employer-sidebar-home"
          >
            <Building2 className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate group-data-[collapsible=icon]:hidden">
              Employer
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
                      testId={`link-employer-${item.href.split("/").pop()}`}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <div className="px-2 py-1.5 text-xs text-muted-foreground truncate group-data-[collapsible=icon]:hidden">
            Signed in as {sessionUser?.fullName ?? "Employer"}
          </div>
          <SidebarLogoutButton />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <div className="sticky top-16 z-30 flex items-center gap-2 border-b border-border/40 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger data-testid="button-employer-sidebar-toggle" />
          {location !== "/dashboard/employer" && (
            <Link
              href="/dashboard/employer"
              className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
              data-testid="link-employer-back-to-dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Link>
          )}
          <span className="text-sm font-medium text-muted-foreground">
            Employer
          </span>
        </div>
        <div className="min-h-[calc(100svh-4rem-3rem)]">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
