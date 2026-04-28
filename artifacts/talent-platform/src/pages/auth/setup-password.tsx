import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  useGetSetupTokenInfo,
  useSetupPassword,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { KeyRound, AlertCircle, CheckCircle2 } from "lucide-react";

export default function SetupPasswordPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const queryClient = useQueryClient();
  const params = new URLSearchParams(search);
  const token = params.get("token") ?? "";

  const { data: info, isLoading, error: tokenError } = useGetSetupTokenInfo(token, {
    query: { enabled: token.length > 0, retry: false },
  });

  const setup = useSetupPassword();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    try {
      await setup.mutateAsync({ data: { token, password } });
      await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      const role = info?.role;
      setLocation(role === "admin" ? "/dashboard/admin" : role ? `/dashboard/${role}` : "/");
    } catch (err: any) {
      setError(err?.data?.error ?? "Setup failed");
    }
  }

  if (!token) {
    return (
      <div className="container max-w-md py-16 px-4">
        <Card className="shadow-md">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">Missing setup token</p>
            <p className="text-sm text-muted-foreground mt-1">
              Use the setup link your administrator shared with you.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="container max-w-md py-16 px-4">
        <Card className="shadow-md">
          <CardContent className="p-8 text-center text-muted-foreground">
            Validating link…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (tokenError || !info) {
    return (
      <div className="container max-w-md py-16 px-4">
        <Card className="shadow-md">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">This link is invalid or has expired</p>
            <p className="text-sm text-muted-foreground mt-1">
              Please ask your administrator to issue a fresh setup link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-md py-16 px-4">
      <Card className="shadow-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-3">
            <KeyRound className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl">Set your password</CardTitle>
          <CardDescription>
            Welcome, {info.fullName}. Choose a password to activate your{" "}
            <span className="font-semibold">{info.role}</span> account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={info.email} readOnly disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <PasswordInput
                id="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <PasswordInput
                id="confirm"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={setup.isPending}>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              {setup.isPending ? "Activating…" : "Activate account"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
