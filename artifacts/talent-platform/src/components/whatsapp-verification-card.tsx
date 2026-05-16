import { useEffect, useState } from "react";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type WhatsAppState = {
  number: string | null;
  verified: boolean;
  verifiedAt: string | null;
  pendingVerification: boolean;
};

type Props = {
  onChange?: (state: WhatsAppState) => void;
  /**
   * Compact mode trims the card framing — useful when embedding inside
   * another card (e.g. the notifications page where the card already
   * carries the WhatsApp branding).
   */
  embedded?: boolean;
};

/**
 * Self-contained WhatsApp number + OTP verification flow. Used on both
 * the candidate profile page and the notification preferences page so
 * users can manage the number from wherever they happen to be.
 *
 * All API calls go through the existing /me/whatsapp* endpoints and
 * the dev OTP echo (`devCode`) is shown only when the server has no
 * provider configured.
 */
export function WhatsAppVerificationCard({ onChange, embedded }: Props) {
  const [wa, setWa] = useState<WhatsAppState | null>(null);
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldownEndsAt, setCooldownEndsAt] = useState<number | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/me/whatsapp", { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as WhatsAppState;
      setWa(data);
      if (data.number) setNumber(data.number);
      onChange?.(data);
    } catch {
      /* no-op */
    }
  }

  useEffect(() => {
    void refresh();
    // refresh is stable enough for this page — intentional dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startVerification() {
    if (!number.trim()) return;
    setBusy(true);
    setDevCode(null);
    try {
      const res = await fetch("/api/me/whatsapp/start-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ number: number.trim() }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            sent?: boolean;
            devCode?: string;
            error?: string;
            retryAfter?: number;
          }
        | null;
      if (res.status === 429 && data?.retryAfter) {
        setCooldownEndsAt(Date.now() + data.retryAfter * 1000);
        toast.error(data.error ?? "Please wait before requesting another code.");
        return;
      }
      if (!res.ok) {
        toast.error(data?.error ?? "Couldn't send the code. Try again.");
        return;
      }
      toast.success(
        data?.sent
          ? "Code sent on WhatsApp. Check your messages."
          : "Verification started. Use the code shown below to confirm.",
      );
      if (data?.devCode) setDevCode(data.devCode);
      setCooldownEndsAt(Date.now() + 60_000);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/me/whatsapp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok) {
        toast.error(data?.error ?? "That code didn't match.");
        return;
      }
      toast.success("WhatsApp number verified.");
      setCode("");
      setDevCode(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/me/whatsapp", {
        method: "DELETE",
        credentials: "include",
      });
      toast.success("WhatsApp disconnected.");
      setNumber("");
      setCode("");
      setDevCode(null);
      setCooldownEndsAt(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const cooldownActive =
    cooldownEndsAt !== null && cooldownEndsAt > Date.now();

  const body = (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
        <div className="space-y-1.5">
          <Label className="text-sm" htmlFor="wa-number">
            WhatsApp number
          </Label>
          <Input
            id="wa-number"
            placeholder="+233 24 123 4567"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            disabled={busy}
            inputMode="tel"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startVerification}
            disabled={busy || cooldownActive || number.trim().length < 6}
          >
            {wa?.verified ? "Resend code" : "Send code"}
          </Button>
          {wa?.verified || wa?.number ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={disconnect}
              disabled={busy}
            >
              Disconnect
            </Button>
          ) : null}
        </div>
      </div>

      {wa?.verified ? (
        <p className="text-xs text-emerald-700 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Verified. We&apos;ll deliver WhatsApp notifications you turn on.
        </p>
      ) : null}

      {wa?.pendingVerification || devCode ? (
        <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
          <div className="space-y-1.5">
            <Label className="text-sm" htmlFor="wa-code">
              Enter the 6-digit code we sent
            </Label>
            <Input
              id="wa-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
              inputMode="numeric"
              maxLength={6}
            />
            {devCode ? (
              <p className="text-xs text-muted-foreground">
                No WhatsApp provider configured — dev code:{" "}
                <span className="font-mono font-semibold">{devCode}</span>
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            onClick={confirmCode}
            disabled={busy || code.trim().length < 4}
          >
            Verify
          </Button>
        </div>
      ) : null}
    </div>
  );

  if (embedded) return body;

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-emerald-600" />
          WhatsApp number
        </CardTitle>
        <CardDescription>
          Add and verify your WhatsApp number to receive notifications on
          WhatsApp. You can manage which alerts go to WhatsApp from{" "}
          <span className="font-medium">Notifications</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
