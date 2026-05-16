import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Bell, ShieldAlert, Info } from "lucide-react";

import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Prefs = {
  strongMatch: boolean;
  applicationStatus: boolean;
  interviewReminder: boolean;
  profileViewed: boolean;
};

const ROWS: { key: keyof Prefs; title: string; body: string }[] = [
  {
    key: "strongMatch",
    title: "Strong matches",
    body: "Tell me when we surface a great-fit role for my profile.",
  },
  {
    key: "applicationStatus",
    title: "Application updates",
    body: "Tell me when an employer changes the status of one of my applications.",
  },
  {
    key: "interviewReminder",
    title: "Interview reminders",
    body: "Send a reminder 24 hours and 1 hour before each interview.",
  },
  {
    key: "profileViewed",
    title: "Profile views (Boost)",
    body: "Tell me when an employer views my profile while my Boost is active.",
  },
];

export default function NotificationsPage() {
  const { sessionUser, isLoading } = useAuth();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<keyof Prefs | null>(null);

  useEffect(() => {
    if (!sessionUser) return;
    let cancelled = false;
    fetch("/api/me/notification-prefs", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setPrefs(
          (data as Prefs) ?? {
            strongMatch: true,
            applicationStatus: true,
            interviewReminder: true,
            profileViewed: true,
          },
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionUser]);

  async function toggle(key: keyof Prefs, next: boolean) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: next });
    setSaving(key);
    try {
      const res = await fetch("/api/me/notification-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ [key]: next }),
      });
      if (!res.ok) throw new Error("save failed");
      const updated = (await res.json()) as Prefs;
      setPrefs(updated);
    } catch {
      setPrefs(previous);
      toast.error("Couldn't save your preference. Try again.");
    } finally {
      setSaving(null);
    }
  }

  if (isLoading) {
    return (
      <div className="container max-w-2xl py-12 px-4">
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading…</CardContent></Card>
      </div>
    );
  }

  if (!sessionUser) {
    return (
      <div className="container max-w-md py-16 px-4">
        <Card>
          <CardContent className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">You need to sign in first</p>
            <Button asChild className="mt-4"><Link href="/login">Sign in</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-10 px-4 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Bell className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Notification preferences</h1>
          <p className="text-sm text-muted-foreground">
            Choose which alerts we send to your inbox.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alerts</CardTitle>
          <CardDescription>
            We always keep a copy in your in-app inbox even if you turn alerts off.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading || !prefs ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            ROWS.map((row) => (
              <div
                key={row.key}
                className="flex items-start justify-between gap-4 py-3 border-b last:border-b-0"
              >
                <div className="flex-1">
                  <Label className="text-sm font-medium">{row.title}</Label>
                  <p className="text-xs text-muted-foreground mt-1">{row.body}</p>
                </div>
                <Switch
                  checked={prefs[row.key]}
                  onCheckedChange={(v) => toggle(row.key, Boolean(v))}
                  disabled={saving === row.key}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 p-3 rounded-md bg-muted text-muted-foreground text-xs">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Push notifications to your phone are sent only by the Jumerra mobile
          app. Install it and sign in to start receiving them. These web
          preferences also control the mobile push channel.
        </span>
      </div>
    </div>
  );
}
