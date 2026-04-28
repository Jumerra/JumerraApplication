import { useState } from "react";
import {
  useAdminListAccounts,
  useAdminSetUserStatus,
  useAdminResetUserPassword,
  getAdminListAccountsQueryKey,
  type AdminAccount,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Power, KeyRound, Copy, Check } from "lucide-react";

type EntityKind = "candidate" | "employer" | "institution";

/**
 * Per-row admin actions: activate / deactivate the linked user account
 * and reset their password (issues a fresh setup link).
 *
 * Renders nothing if no auth user is linked to this entity (e.g. legacy
 * seed rows without a user account).
 */
export function AdminAccountActions({
  entityKind,
  entityId,
  entityLabel,
}: {
  entityKind: EntityKind;
  entityId: number;
  entityLabel: string;
}) {
  const { data, isLoading } = useAdminListAccounts({
    role: entityKind,
  });
  const account = data?.accounts.find((a) => {
    if (entityKind === "candidate") return a.candidateId === entityId;
    if (entityKind === "employer") return a.employerId === entityId;
    return a.institutionId === entityId;
  });

  if (isLoading || !account) {
    return null;
  }
  return (
    <AccountActionsInner account={account} entityLabel={entityLabel} />
  );
}

function AccountActionsInner({
  account,
  entityLabel,
}: {
  account: AdminAccount;
  entityLabel: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const setStatus = useAdminSetUserStatus();
  const resetPassword = useAdminResetUserPassword();

  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [copied, setCopied] = useState(false);

  const isDisabled = account.status === "disabled";
  const canToggle =
    account.status === "active" || account.status === "disabled";

  async function handleToggleStatus() {
    const next = isDisabled ? "active" : "disabled";
    try {
      await setStatus.mutateAsync({
        id: account.userId,
        data: { status: next },
      });
      await queryClient.invalidateQueries({
        queryKey: getAdminListAccountsQueryKey(),
      });
      toast({
        title:
          next === "active"
            ? `${entityLabel} reactivated`
            : `${entityLabel} deactivated`,
        description:
          next === "active"
            ? `${account.fullName} can sign in again.`
            : `${account.fullName} can no longer sign in.`,
      });
    } catch (err) {
      toast({
        title: "Status change failed",
        description:
          err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function handleResetPassword() {
    try {
      const result = await resetPassword.mutateAsync({ id: account.userId });
      await queryClient.invalidateQueries({
        queryKey: getAdminListAccountsQueryKey(),
      });
      setResetUrl(result.setupUrl ?? null);
      setResetEmailSent(result.emailSent);
      setShowResetDialog(true);
      toast({
        title: "Password reset link issued",
        description: result.emailSent
          ? `An email was sent to ${account.email}.`
          : "Copy the setup link below and share it with the user.",
      });
    } catch (err) {
      toast({
        title: "Reset failed",
        description:
          err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function copyLink() {
    if (!resetUrl) return;
    try {
      await navigator.clipboard.writeText(resetUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the URL manually and copy it.",
        variant: "destructive",
      });
    }
  }

  return (
    <>
      <AccountStatusBadge status={account.status} />

      {canToggle ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={
                isDisabled
                  ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                  : "text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950"
              }
              title={isDisabled ? "Activate account" : "Deactivate account"}
            >
              <Power className="w-4 h-4" />
              <span className="sr-only">
                {isDisabled ? "Activate" : "Deactivate"}
              </span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {isDisabled
                  ? `Reactivate ${account.fullName}?`
                  : `Deactivate ${account.fullName}?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {isDisabled
                  ? `${account.email} will be able to sign in again immediately.`
                  : `${account.email} will be blocked from signing in. Their profile and history are preserved and you can reactivate at any time.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={
                  isDisabled
                    ? ""
                    : "bg-amber-600 text-white hover:bg-amber-700"
                }
                onClick={handleToggleStatus}
              >
                {isDisabled ? "Activate" : "Deactivate"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
            title="Reset password"
          >
            <KeyRound className="w-4 h-4" />
            <span className="sr-only">Reset password</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reset password for {account.fullName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The current password (if any) will be invalidated and a fresh
              setup link valid for a limited time will be issued. The user
              will be flagged as <em>invited</em> until they complete the
              new setup. If email is configured, the link is sent
              automatically; otherwise you'll be shown the URL to share.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetPassword}>
              Issue reset link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Setup link issued</DialogTitle>
            <DialogDescription>
              {resetEmailSent
                ? `We sent a setup link to ${account.email}.`
                : `Email is not configured on this environment, so copy the link below and share it with ${account.fullName} via your own channel.`}
            </DialogDescription>
          </DialogHeader>
          {resetUrl ? (
            <div className="flex items-center gap-2">
              <Input value={resetUrl} readOnly className="font-mono text-xs" />
              <Button
                size="sm"
                variant="secondary"
                onClick={copyLink}
                className="shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-1" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-1" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setShowResetDialog(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AccountStatusBadge({ status }: { status: AdminAccount["status"] }) {
  const map: Record<
    AdminAccount["status"],
    { label: string; className: string }
  > = {
    active: {
      label: "Active",
      className:
        "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    },
    disabled: {
      label: "Disabled",
      className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    },
    pending: {
      label: "Pending",
      className:
        "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    },
    rejected: {
      label: "Rejected",
      className:
        "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    },
    invited: {
      label: "Invited",
      className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
    },
  };
  const cfg = map[status];
  return (
    <Badge
      variant="secondary"
      className={`${cfg.className} hidden sm:inline-flex`}
    >
      {cfg.label}
    </Badge>
  );
}
