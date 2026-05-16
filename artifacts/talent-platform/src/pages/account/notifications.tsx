import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Bell, ShieldAlert, Info, MessageCircle } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { WhatsAppVerificationCard } from "@/components/whatsapp-verification-card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type Prefs = {
  strongMatch: boolean;
  applicationStatus: boolean;
  interviewReminder: boolean;
  profileViewed: boolean;
  weeklyDigest: boolean;
  whatsappStrongMatch: boolean;
  whatsappApplicationStatus: boolean;
  whatsappInterviewReminder: boolean;
  whatsappWeeklyDigest: boolean;
  digestDow: number;
  digestHour: number;
  digestTz: string | null;
  effectiveDigestTz?: string;
};

type WhatsAppState = {
  number: string | null;
  verified: boolean;
  verifiedAt: string | null;
  pendingVerification: boolean;
};

const DOW_LABELS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

function formatHour(h: number): string {
  const suffix = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${suffix}`;
}

type BooleanPrefKey =
  | "strongMatch"
  | "applicationStatus"
  | "interviewReminder"
  | "profileViewed"
  | "weeklyDigest";

const ROWS: { key: BooleanPrefKey; title: string; body: string }[] = [
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
  {
    key: "weeklyDigest",
    title: "Weekly digest",
    body: "Every Monday, email a recap of my week plus my top 5 new job matches.",
  },
];

export default function NotificationsPage() {
  const { sessionUser, isLoading } = useAuth();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<keyof Prefs | null>(null);
  const [sendingPreview, setSendingPreview] = useState(false);

  const [wa, setWa] = useState<WhatsAppState | null>(null);

  async function reloadPrefs() {
    const res = await fetch("/api/me/notification-prefs", {
      credentials: "include",
    });
    if (res.ok) setPrefs((await res.json()) as Prefs);
  }

  async function sendDigestPreview() {
    setSendingPreview(true);
    try {
      const res = await fetch("/api/me/digest-preview", {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 429) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        toast.error(
          data?.error ??
            "You can only send a preview once per hour. Please try again later.",
        );
        return;
      }
      if (!res.ok) throw new Error("preview failed");
      toast.success(
        "Preview sent. Check your email and in-app inbox in a moment.",
      );
    } catch {
      toast.error("Couldn't send the preview. Try again in a moment.");
    } finally {
      setSendingPreview(false);
    }
  }

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
            weeklyDigest: true,
            whatsappStrongMatch: false,
            whatsappApplicationStatus: false,
            whatsappInterviewReminder: false,
            whatsappWeeklyDigest: false,
            digestDow: 1,
            digestHour: 9,
            digestTz: null,
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

  async function patch<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });
    setSaving(key);
    try {
      const res = await fetch("/api/me/notification-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ [key]: value }),
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

  function toggle(key: BooleanPrefKey, next: boolean) {
    return patch(key, next);
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
                  checked={Boolean(prefs[row.key])}
                  onCheckedChange={(v) => toggle(row.key, Boolean(v))}
                  disabled={saving === row.key}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {prefs && !loading ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Weekly digest delivery</CardTitle>
            <CardDescription>
              Pick the day and hour we send your weekly digest. Times are in
              your local timezone
              {prefs.effectiveDigestTz ? ` (${prefs.effectiveDigestTz})` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Day</Label>
              <Select
                value={String(prefs.digestDow)}
                onValueChange={(v) => patch("digestDow", Number(v))}
                disabled={saving === "digestDow" || !prefs.weeklyDigest}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOW_LABELS.map((d) => (
                    <SelectItem key={d.value} value={String(d.value)}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Time</Label>
              <Select
                value={String(prefs.digestHour)}
                onValueChange={(v) => patch("digestHour", Number(v))}
                disabled={saving === "digestHour" || !prefs.weeklyDigest}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, h) => (
                    <SelectItem key={h} value={String(h)}>
                      {formatHour(h)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!prefs.weeklyDigest ? (
              <p className="sm:col-span-2 text-xs text-muted-foreground">
                Turn on Weekly digest above to start receiving these.
              </p>
            ) : null}
            <div className="sm:col-span-2 flex flex-col gap-2 pt-2 border-t">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={sendDigestPreview}
                  disabled={sendingPreview}
                >
                  {sendingPreview ? "Sending…" : "Send me a preview"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Sends the digest now so you can check the format. Limited
                  to once per hour.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-emerald-600" />
            WhatsApp alerts
          </CardTitle>
          <CardDescription>
            Add and verify your WhatsApp number to also receive notifications
            on WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <WhatsAppVerificationCard
            embedded
            onChange={(state) => {
              setWa(state);
              void reloadPrefs();
            }}
          />

          {prefs && !loading ? (
            <div className="space-y-3 pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                Send these on WhatsApp{wa?.verified ? "" : " (verify your number first)"}.
              </p>
              {(
                [
                  ["whatsappStrongMatch", "Strong matches"],
                  ["whatsappApplicationStatus", "Application updates"],
                  ["whatsappInterviewReminder", "Interview reminders"],
                  ["whatsappWeeklyDigest", "Weekly digest"],
                ] as const
              ).map(([key, title]) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3"
                >
                  <Label className="text-sm font-medium">{title}</Label>
                  <Switch
                    checked={Boolean(prefs[key])}
                    onCheckedChange={(v) => patch(key, Boolean(v))}
                    disabled={saving === key || !wa?.verified}
                  />
                </div>
              ))}
            </div>
          ) : null}
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
