import { useState } from "react";
import {
  useGetMyOpenWindow,
  useOpenMyWindow,
  useCloseMyWindow,
  getGetMyOpenWindowQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "wouter";
import { Inbox, Sparkles, Clock } from "lucide-react";
import { toast } from "sonner";

function formatRemaining(closesAt: string): string {
  const diff = new Date(closesAt).getTime() - Date.now();
  if (diff <= 0) return "expiring";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h left`;
  return `${hours}h left`;
}

export function OpenWindowToggle() {
  const { data: window, isLoading } = useGetMyOpenWindow();
  const open = useOpenMyWindow();
  const close = useCloseMyWindow();
  const qc = useQueryClient();
  const [days, setDays] = useState("7");

  if (isLoading) return null;

  const active = !!window && window.isActive;

  return (
    <Card className="shadow-md border-primary/20">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg">Open to offers</CardTitle>
            <CardDescription>
              Open a short auction window so employers can bid for your time. Your identity stays anonymous until you accept.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {active ? (
          <>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <Clock className="w-4 h-4 text-primary" />
              <p className="text-sm">
                Window is open · <span className="font-semibold">{formatRemaining(window!.closesAt)}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/account/offers"><Inbox className="w-4 h-4 mr-1.5" /> View offers</Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={close.isPending}
                onClick={async () => {
                  try {
                    await close.mutateAsync();
                    await qc.invalidateQueries({ queryKey: getGetMyOpenWindowQueryKey() });
                    toast.success("Window closed");
                  } catch (err: any) {
                    toast.error(err?.data?.error ?? "Could not close");
                  }
                }}
              >
                Close window now
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5 w-40">
                <Label htmlFor="days">Window length</Label>
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger id="days"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3 days</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days (max)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={open.isPending}
                onClick={async () => {
                  try {
                    await open.mutateAsync({ data: { days: Number(days) } });
                    await qc.invalidateQueries({ queryKey: getGetMyOpenWindowQueryKey() });
                    toast.success(`Window open for ${days} days`);
                  } catch (err: any) {
                    toast.error(err?.data?.error ?? "Could not open window");
                  }
                }}
              >
                Open window
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Only an anonymised card (skills, talent score, headline, institution) is shown to employers. Your name, contact, and avatar stay private.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
