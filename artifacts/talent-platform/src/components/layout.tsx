import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Compass,
  Building2,
  GraduationCap,
  LayoutDashboard,
  Search,
  UserCircle2,
  Sun,
  Moon,
  LogOut,
  ShieldAlert,
  UserPlus,
  LogIn,
  KeyRound,
  Users,
  UserCog,
  ShieldCheck,
  User,
  BookOpen,
  Building,
  Pencil,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NotificationBell } from "@/components/notification-bell";
import { useTheme } from "@/components/theme-provider";
import {
  useLogoutUser,
  useGetInstitution,
  getGetCurrentUserQueryKey,
  getGetInstitutionQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { academicUnitTerms } from "@/lib/institution-kinds";

function avatarSrc(avatarUrl: string | null | undefined): string | undefined {
  if (!avatarUrl) return undefined;
  if (avatarUrl.startsWith("/objects/")) {
    return `/api/storage${avatarUrl}`;
  }
  return avatarUrl;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { role, sessionUser, demoRole, setDemoRole, hasPermission } = useAuth();
  const [location, navigate] = useLocation();
  const { theme, setTheme } = useTheme();
  const logout = useLogoutUser();
  const queryClient = useQueryClient();

  const navLinks = [
    { href: "/jobs", label: "Find Jobs", icon: Search },
    { href: "/employers", label: "Employers", icon: Building2 },
    { href: "/institutions", label: "Institutions", icon: GraduationCap },
    ...(role === "employer" || role === "admin"
      ? [{ href: "/candidates", label: "Talent", icon: UserCircle2 }]
      : []),
  ];

  // Pull the institution kind so the dropdown link can read "Programs"
  // for SHS schools and "Departments" everywhere else. Cached query so
  // this is essentially free across pages.
  const institutionId =
    sessionUser?.role === "institution" ? sessionUser.institutionId : null;
  const { data: currentInstitution } = useGetInstitution(institutionId ?? 0, {
    query: {
      queryKey: getGetInstitutionQueryKey(institutionId ?? 0),
      enabled: institutionId != null,
    },
  });
  const academicTerms = academicUnitTerms(currentInstitution?.type);

  async function handleLogout() {
    await logout.mutateAsync();
    await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
    navigate("/");
  }

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="flex items-center gap-2 font-bold text-xl tracking-tight text-primary"
            >
              <Compass className="h-6 w-6" />
              TalentLink
            </Link>
            <nav className="hidden md:flex gap-6">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm font-medium transition-colors hover:text-primary ${
                    location.startsWith(link.href)
                      ? "text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {!sessionUser && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider hidden sm:inline-block">
                  View as
                </span>
                <Select
                  value={demoRole || "none"}
                  onValueChange={(val: string) =>
                    setDemoRole(val === "none" ? null : (val as typeof demoRole))
                  }
                >
                  <SelectTrigger className="w-[140px] h-9">
                    <SelectValue placeholder="Select Role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Public</SelectItem>
                    <SelectItem value="candidate">Candidate</SelectItem>
                    <SelectItem value="employer">Employer</SelectItem>
                    <SelectItem value="institution">Institution</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <NotificationBell />

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
            </Button>

            {role && (
              <Button
                asChild
                variant="default"
                size="sm"
                className="gap-2 hidden sm:flex"
              >
                <Link href={`/dashboard/${role}`}>
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </Link>
              </Button>
            )}
            {role === "employer" && (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="hidden lg:flex"
              >
                <Link href="/post-job">Post a Job</Link>
              </Button>
            )}

            {sessionUser ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2 max-w-[200px]">
                    <Avatar className="h-7 w-7">
                      {avatarSrc(sessionUser.avatarUrl) && (
                        <AvatarImage
                          src={avatarSrc(sessionUser.avatarUrl)}
                          alt={sessionUser.fullName}
                        />
                      )}
                      <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                        {sessionUser.fullName.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate hidden sm:inline">
                      {sessionUser.fullName}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <p className="font-semibold text-sm">{sessionUser.fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {sessionUser.email}
                    </p>
                    <p className="text-xs text-muted-foreground capitalize mt-1">
                      Role: {sessionUser.role}
                    </p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {sessionUser.role === "admin" && (
                    <>
                      <DropdownMenuItem asChild>
                        <Link href="/dashboard/admin" className="gap-2 cursor-pointer">
                          <ShieldAlert className="w-4 h-4" /> Admin console
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href="/dashboard/admin/staff" className="gap-2 cursor-pointer">
                          <Users className="w-4 h-4" /> Team
                        </Link>
                      </DropdownMenuItem>
                      {(sessionUser.orgRole === "super_admin" ||
                        sessionUser.orgRole === null) && (
                        <DropdownMenuItem asChild>
                          <Link href="/dashboard/admin/roles" className="gap-2 cursor-pointer">
                            <ShieldCheck className="w-4 h-4" /> Roles & permissions
                          </Link>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem asChild>
                        <Link
                          href="/dashboard/admin/account-managers"
                          className="gap-2 cursor-pointer"
                        >
                          <UserCog className="w-4 h-4" /> Account managers
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {(sessionUser.role === "employer" || sessionUser.role === "institution") &&
                    sessionUser.orgRole && (
                      <>
                        {(sessionUser.orgRole === "owner" ||
                          hasPermission("staff:manage")) && (
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/dashboard/${sessionUser.role}/staff`}
                              className="gap-2 cursor-pointer"
                            >
                              <Users className="w-4 h-4" /> Team
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {sessionUser.orgRole === "owner" && (
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/dashboard/${sessionUser.role}/roles`}
                              className="gap-2 cursor-pointer"
                            >
                              <ShieldCheck className="w-4 h-4" /> Roles & permissions
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {sessionUser.role === "institution" && (
                          <>
                            <DropdownMenuItem asChild>
                              <Link
                                href="/dashboard/institution/departments"
                                className="gap-2 cursor-pointer"
                              >
                                <BookOpen className="w-4 h-4" />{" "}
                                {academicTerms.plural}
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link
                                href="/dashboard/institution/facilities"
                                className="gap-2 cursor-pointer"
                              >
                                <Building className="w-4 h-4" /> Facilities
                              </Link>
                            </DropdownMenuItem>
                            {sessionUser.orgRole === "owner" && (
                              <DropdownMenuItem asChild>
                                <Link
                                  href="/dashboard/institution/edit"
                                  className="gap-2 cursor-pointer"
                                >
                                  <Pencil className="w-4 h-4" /> Edit institution
                                </Link>
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                        <DropdownMenuSeparator />
                      </>
                    )}
                  <DropdownMenuItem asChild>
                    <Link href="/account/profile" className="gap-2 cursor-pointer">
                      <User className="w-4 h-4" /> Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/account/password" className="gap-2 cursor-pointer">
                      <KeyRound className="w-4 h-4" /> Change password
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleLogout} className="gap-2 cursor-pointer">
                    <LogOut className="w-4 h-4" /> Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="flex items-center gap-2">
                <Button asChild variant="ghost" size="sm" className="hidden sm:flex">
                  <Link href="/login">
                    <LogIn className="w-4 h-4 mr-1" /> Sign in
                  </Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/signup">
                    <UserPlus className="w-4 h-4 mr-1" /> Sign up
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 flex flex-col relative z-0">{children}</main>
      <footer className="border-t bg-muted/20 py-10 mt-auto">
        <div className="container text-center text-sm text-muted-foreground">
          <p>
            &copy; {new Date().getFullYear()} TalentLink. Where ambition meets
            opportunity.
          </p>
        </div>
      </footer>
    </div>
  );
}
