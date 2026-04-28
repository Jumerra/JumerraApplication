import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Compass, Building2, GraduationCap, LayoutDashboard, Search, UserCircle2, Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

export function Layout({ children }: { children: React.ReactNode }) {
  const { role, setRole } = useAuth();
  const [location] = useLocation();
  const { theme, setTheme } = useTheme();

  const navLinks = [
    { href: "/jobs", label: "Find Jobs", icon: Search },
    { href: "/employers", label: "Employers", icon: Building2 },
    { href: "/institutions", label: "Institutions", icon: GraduationCap },
    ...(role === "employer" || role === "admin" ? [{ href: "/candidates", label: "Talent", icon: UserCircle2 }] : []),
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 font-bold text-xl tracking-tight text-primary">
              <Compass className="h-6 w-6" />
              TalentLink
            </Link>
            <nav className="hidden md:flex gap-6">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm font-medium transition-colors hover:text-primary ${
                    location.startsWith(link.href) ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider hidden sm:inline-block">View as</span>
              <Select value={role || "none"} onValueChange={(val: any) => setRole(val === "none" ? null : val)}>
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
              <Button asChild variant="default" size="sm" className="gap-2 hidden sm:flex">
                <Link href={`/dashboard/${role}`}>
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </Link>
              </Button>
            )}
            {role === "employer" && (
              <Button asChild variant="outline" size="sm" className="hidden lg:flex">
                <Link href="/post-job">Post a Job</Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 flex flex-col relative z-0">
        {children}
      </main>
      <footer className="border-t bg-muted/20 py-10 mt-auto">
        <div className="container text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} TalentLink. Where ambition meets opportunity.</p>
        </div>
      </footer>
    </div>
  );
}
