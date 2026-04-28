import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useChangePassword } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { KeyRound, AlertCircle, CheckCircle2, ShieldAlert } from "lucide-react";

export default function ChangePasswordPage() {
  const [, setLocation] = useLocation();
  const { sessionUser, isLoading } = useAuth();
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (isLoading) {
    return (
      <div className="container max-w-md py-16 px-4">
        <Card className="shadow-md">
          <CardContent className="p-8 text-center text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!sessionUser) {
    return (
      <div className="container max-w-md py-16 px-4">
        <Card className="shadow-md">
          <CardContent className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">You need to sign in first</p>
            <Button asChild className="mt-4">
              <Link href="/login">Sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (next !== confirm) {
      setError("New passwords do not match");
      return;
    }
    if (next === current) {
      setError("New password must be different from your current password");
      return;
    }
    try {
      await change.mutateAsync({
        data: { currentPassword: current, newPassword: next },
      });
      setDone(true);
      setTimeout(() => setLocation("/"), 1500);
    } catch (err: any) {
      setError(
        err?.data?.error ??
          (err?.status === 401
            ? "Current password is incorrect"
            : "Could not update password"),
      );
    }
  }

  return (
    <div className="container max-w-md py-12 px-4">
      <Card className="shadow-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-3">
            <KeyRound className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl">Change your password</CardTitle>
          <CardDescription>
            Signed in as{" "}
            <span className="font-medium">{sessionUser.email}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="flex items-start gap-2 p-3 rounded-md bg-emerald-50 text-emerald-900 text-sm">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Password updated. Redirecting…</span>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current">Current password</Label>
                <PasswordInput
                  id="current"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="next">New password</Label>
                <PasswordInput
                  id="next"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                <p className="text-xs text-muted-foreground">
                  At least 8 characters.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm new password</Label>
                <PasswordInput
                  id="confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={change.isPending}>
                {change.isPending ? "Updating…" : "Update password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
