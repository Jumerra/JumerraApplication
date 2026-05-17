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
  UserCircle2,
  Users,
  Handshake,
  Inbox,
  Eye,
  Bell,
  KeyRound,
  User,
  Briefcase,
  ShieldAlert,
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

type CandidateNavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

type CandidateNavGroup = {
  label: string;
  items: CandidateNavItem[];
};

const NAV: CandidateNavGroup[] = [
  {
    label: "Overview",
    items: [
      {
        href: "/dashboard/candidate",
        label: "Dashboard",
        icon: LayoutDashboard,
      },
      { href: "/jobs", label: "Find jobs", icon: Briefcase },
    ],
  },
  {
    label: "Network",
    items: [
      {
        href: "/dashboard/candidate/mentors",
        label: "Mentors",
        icon: Users,
      },
      {
        href: "/dashboard/candidate/mentor-requests",
        label: "Mentor requests",
        icon: Handshake,
      },
      {
        href: "/dashboard/candidate/intro-requests",
        label: "Intro requests",
        icon: Inbox,
      },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/account/profile", label: "Profile", icon: User },
      { href: "/account/offers", label: "Offers", icon: Inbox },
      {
        href: "/account/profile-views",
        label: "Profile views",
        icon: Eye,
      },
      {
        href: "/account/notifications",
        label: "Notifications",
        icon: Bell,
      },
      {
        href: "/account/password",
        label: "Change password",
        icon: KeyRound,
      },
    ],
  },
];

function isActive(current: string, href: string): boolean {
  if (href === "/dashboard/candidate") return current === href;
  return current === href || current.startsWith(href + "/");
}

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

export function CandidateLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { sessionUser, role } = useAuth();

  const isCandidate =
    sessionUser?.role === "candidate" || role === "candidate";

  if (!isCandidate) {
    return (
      <div className="container max-w-md py-16">
        <Card>
          <CardContent className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">Candidate access required</p>
            <p className="text-sm text-muted-foreground mt-2">
              Sign in with a candidate account to open this page.
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
            href="/dashboard/candidate"
            className="flex items-center gap-2 px-2 py-1.5 font-semibold text-sm"
            data-testid="link-candidate-sidebar-home"
          >
            <UserCircle2 className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate group-data-[collapsible=icon]:hidden">
              {sessionUser?.fullName ?? "Candidate"}
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          {NAV.map((group) => (
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
                      testId={`link-candidate-${item.href.split("/").pop()}`}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <div className="px-2 py-1.5 text-xs text-muted-foreground truncate group-data-[collapsible=icon]:hidden">
            Signed in as {sessionUser?.fullName ?? "Candidate"}
          </div>
          <SidebarLogoutButton />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <div className="sticky top-16 z-30 flex items-center gap-2 border-b border-border/40 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger data-testid="button-candidate-sidebar-toggle" />
          <span className="text-sm font-medium text-muted-foreground">
            Candidate
          </span>
        </div>
        <div className="min-h-[calc(100svh-4rem-3rem)]">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
