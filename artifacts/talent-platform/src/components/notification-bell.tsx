import { useEffect, useState } from "react";
import { Bell, Check, CheckCheck } from "lucide-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/lib/auth";

type Notification = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function NotificationBell() {
  const { sessionUser } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const enabled = !!sessionUser;

  // Cheap polling for the badge count.
  const { data: countData } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => fetchJSON<{ unread: number }>("/api/notifications/unread-count"),
    enabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  // Lazy-load the list when the popover opens.
  const { data: listData, refetch } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () =>
      fetchJSON<{ notifications: Notification[] }>("/api/notifications?limit=20"),
    enabled: enabled && open,
  });

  useEffect(() => {
    if (open) refetch();
  }, [open, refetch]);

  const markRead = useMutation({
    mutationFn: (id: number) =>
      fetchJSON<{ ok: true }>(`/api/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications", "list"] });
    },
  });

  const markAll = useMutation({
    mutationFn: () =>
      fetchJSON<{ ok: true }>(`/api/notifications/mark-all-read`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications", "list"] });
    },
  });

  if (!enabled) return null;

  const unread = countData?.unread ?? 0;
  const items = listData?.notifications ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 relative text-muted-foreground hover:text-foreground"
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        >
          <Bell className="h-[1.2rem] w-[1.2rem]" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="font-semibold text-sm">Notifications</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
            >
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              You're all caught up.
            </div>
          ) : (
            items.map((n) => {
              const isUnread = !n.readAt;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    if (isUnread) markRead.mutate(n.id);
                    if (n.link) {
                      navigate(n.link);
                      setOpen(false);
                    }
                  }}
                  className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-muted/50 transition-colors ${
                    isUnread ? "bg-primary/5" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {isUnread && (
                      <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{n.title}</p>
                      {n.body && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {n.body}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {timeAgo(n.createdAt)}
                      </p>
                    </div>
                    {!isUnread && (
                      <Check className="w-3.5 h-3.5 text-muted-foreground mt-1 shrink-0" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
