import { ReactNode, useEffect, useState } from "react";
import { Link } from "wouter";
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
import { Landmark, ShieldAlert, BarChart3, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { customFetch } from "@workspace/api-client-react";
import { SidebarLogoutButton } from "@/components/sidebar-logout";
import {
  MINISTRY_SCOPE_META,
  scopeAnchorId,
  type MinistryType,
} from "@/lib/ministry-scopes";

const SIDEBAR_COOKIE_NAME = "sidebar_state";

function readSidebarCookie(): boolean {
  if (typeof document === "undefined") return true;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${SIDEBAR_COOKIE_NAME}=`));
  if (!match) return true;
  return match.split("=")[1] !== "false";
}

type MinistryMe = {
  ministry: {
    id: number;
    name: string;
    type: MinistryType;
    dataAccess: string[];
  };
};

/**
 * Renders one section anchor link. The ministry dashboard is a single
 * page; each granted section gets an `id` so these links scroll to it.
 * Closes the off-canvas sheet on mobile after a tap.
 */
function SectionLink({
  anchor,
  label,
}: {
  anchor: string;
  label: string;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={label}>
        <a
          href={`#${anchor}`}
          data-testid={`link-ministry-${anchor}`}
          onClick={() => {
            if (isMobile) setOpenMobile(false);
          }}
        >
          <BarChart3 className="h-4 w-4" />
          <span>{label}</span>
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Sidebar link to the ministry's own team-management page. Uses wouter
 * navigation (not an in-page anchor) and closes the mobile sheet on tap.
 */
function TeamLink() {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip="Team">
        <Link
          href="/dashboard/ministry/staff"
          data-testid="link-ministry-team"
          onClick={() => {
            if (isMobile) setOpenMobile(false);
          }}
        >
          <Users className="h-4 w-4" />
          <span>Team</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function MinistryLayout({ children }: { children: ReactNode }) {
  const { sessionUser, role, hasPermission } = useAuth();
  const isMinistry =
    sessionUser?.role === "ministry" || role === "ministry";
  const canViewTeam = hasPermission("ministry-staff:view");

  const [me, setMe] = useState<MinistryMe["ministry"] | null>(null);

  useEffect(() => {
    if (!isMinistry) return;
    let active = true;
    customFetch<MinistryMe>("/api/ministry/me")
      .then((data) => {
        if (active) setMe(data.ministry);
      })
      .catch(() => {
        /* layout still renders; dashboard surfaces load errors */
      });
    return () => {
      active = false;
    };
  }, [isMinistry]);

  if (!isMinistry) {
    return (
      <div className="container max-w-md py-16">
        <Card>
          <CardContent className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">Ministry access required</p>
            <p className="text-sm text-muted-foreground mt-2">
              Sign in with a government ministry account to open this
              dashboard.
            </p>
            <Button asChild className="mt-4">
              <Link href="/login">Sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Sidebar shows only the sections this ministry has been granted,
  // in catalog order, filtered to its type.
  const granted = me
    ? MINISTRY_SCOPE_META.filter(
        (s) => s.type === me.type && me.dataAccess.includes(s.key),
      )
    : [];

  return (
    <SidebarProvider defaultOpen={readSidebarCookie()}>
      <Sidebar collapsible="icon" className="top-16 h-[calc(100svh-4rem)]">
        <SidebarHeader>
          <Link
            href="/dashboard/ministry"
            className="flex items-center gap-2 px-2 py-1.5 font-semibold text-sm"
            data-testid="link-ministry-sidebar-home"
          >
            <Landmark className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate group-data-[collapsible=icon]:hidden">
              {me?.name ?? "Ministry"}
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Sections</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {granted.map((s) => (
                  <SectionLink
                    key={s.key}
                    anchor={scopeAnchorId(s.key)}
                    label={s.label}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {canViewTeam && (
            <SidebarGroup>
              <SidebarGroupLabel>Manage</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <TeamLink />
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarFooter>
          <div className="px-2 py-1.5 text-xs text-muted-foreground truncate group-data-[collapsible=icon]:hidden">
            Signed in as {sessionUser?.fullName ?? "Ministry"}
          </div>
          <SidebarLogoutButton />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <div className="sticky top-16 z-30 flex items-center gap-2 border-b border-border/40 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger data-testid="button-ministry-sidebar-toggle" />
          <span className="text-sm font-medium text-muted-foreground">
            {me?.type === "labour"
              ? "Ministry of Labour"
              : me?.type === "education"
                ? "Ministry of Education"
                : "Ministry"}
          </span>
        </div>
        <div className="min-h-[calc(100svh-4rem-3rem)]">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
