import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLoginUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { setWebSessionToken } from "@/lib/web-session";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { LogIn, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const login = useLoginUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await login.mutateAsync({ data: { email, password } });
      const user = result.user;
      // Persist the signed session token in localStorage so it can be
      // replayed as Authorization: Bearer <token> on every API call.
      // This is the cookie-blocked-context fallback (nested iframe
      // previews, third-party-cookie-disabled browsers); the normal
      // Set-Cookie still flows in parallel for browsers that honor it.
      if (result.sessionToken) {
        setWebSessionToken(result.sessionToken);
      }
      // Seed the cache synchronously with the freshly-authenticated user so
      // the next render of any consumer of useGetCurrentUser sees the new
      // identity immediately. Without this, AdminLayout (and other
      // role-gated layouts) can briefly render with the *previous* session
      // user while the background refetch is in flight, which surfaces as
      // a spurious "Admin access required" card after switching accounts.
      queryClient.setQueryData(getGetCurrentUserQueryKey(), { user });
      // Still invalidate so any other user-scoped queries (notifications,
      // dashboards keyed off identity) refetch with the new session.
      queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      if (user?.mustChangePassword) setLocation("/account/password");
      else if (user?.role === "admin") setLocation("/dashboard/admin");
      else if (user?.role) setLocation(`/dashboard/${user.role}`);
      else setLocation("/");
    } catch (err: any) {
      const msg =
        err?.data?.error ??
        (err?.status === 401
          ? "Invalid email or password"
          : err?.status === 403
          ? "Your account is not active yet"
          : "Login failed");
      setError(msg);
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] w-full flex items-center justify-center px-4 py-12 bg-gradient-to-br from-primary/5 via-background to-primary/10">
      <Card className="w-full max-w-md shadow-xl border-border/60 backdrop-blur">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-4 ring-4 ring-primary/5">
            <LogIn className="w-7 h-7" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Welcome back</CardTitle>
          <CardDescription className="mt-1">Sign in to your Jumerra account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            New to Jumerra?{" "}
            <Link href="/signup" className="text-primary font-medium hover:underline">
              Create an account
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
