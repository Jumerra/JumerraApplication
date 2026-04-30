import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminListAccountManagers,
  useAdminAssignEmployerManager,
  useAdminAssignInstitutionManager,
  getListEmployersQueryKey,
  getListInstitutionsQueryKey,
  getAdminListAccountManagersQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { UserCog } from "lucide-react";

const UNASSIGNED = "__unassigned__";

/**
 * Inline reassign control for an employer/institution row in the admin
 * lists. Read-only badge for non-super-admins; a Select for super-admins.
 *
 * Uses the same definition of "super_admin" as the server: explicit
 * orgRole === "super_admin" OR a legacy admin row with orgRole === null.
 */
export function AccountManagerSelect({
  entityKind,
  entityId,
  currentManagerId,
  currentManagerName,
}: {
  entityKind: "employer" | "institution";
  entityId: number;
  currentManagerId: number | null;
  currentManagerName: string | null;
}) {
  const { sessionUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isSuperAdmin =
    sessionUser?.role === "admin" &&
    (sessionUser.orgRole === "super_admin" || sessionUser.orgRole === null);

  // Only fetch the list when the user can actually pick a value, otherwise
  // skip the request entirely.
  const { data } = useAdminListAccountManagers({
    query: {
      queryKey: getAdminListAccountManagersQueryKey(),
      enabled: isSuperAdmin,
    },
  });

  const assignEmployer = useAdminAssignEmployerManager();
  const assignInstitution = useAdminAssignInstitutionManager();
  const [pendingValue, setPendingValue] = useState<string | null>(null);

  if (!isSuperAdmin) {
    return (
      <Badge
        variant={currentManagerName ? "secondary" : "outline"}
        className="gap-1 font-normal"
        title="Account manager"
      >
        <UserCog className="w-3 h-3" />
        {currentManagerName ?? "Unassigned"}
      </Badge>
    );
  }

  const managers = data?.accountManagers ?? [];
  const value =
    currentManagerId === null ? UNASSIGNED : String(currentManagerId);

  async function onChange(next: string) {
    const nextId = next === UNASSIGNED ? null : Number(next);
    setPendingValue(next);
    try {
      const body = { data: { accountManagerId: nextId } };
      if (entityKind === "employer") {
        await assignEmployer.mutateAsync({ id: entityId, ...body });
        await queryClient.invalidateQueries({
          queryKey: getListEmployersQueryKey(),
        });
      } else {
        await assignInstitution.mutateAsync({ id: entityId, ...body });
        await queryClient.invalidateQueries({
          queryKey: getListInstitutionsQueryKey(),
        });
      }
      // Counts on the account-managers page change too.
      await queryClient.invalidateQueries({
        queryKey: getAdminListAccountManagersQueryKey(),
      });
      toast({
        title: nextId === null ? "Account manager removed" : "Account manager assigned",
      });
    } catch (err) {
      toast({
        title: "Reassign failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPendingValue(null);
    }
  }

  const isPending =
    pendingValue !== null &&
    (assignEmployer.isPending || assignInstitution.isPending);

  return (
    <Select value={value} onValueChange={onChange} disabled={isPending}>
      <SelectTrigger
        className="h-8 w-[180px] text-xs"
        title="Reassign account manager"
      >
        <UserCog className="w-3 h-3 mr-1 shrink-0" />
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED}>
          <span className="text-muted-foreground">Unassigned</span>
        </SelectItem>
        {managers.map((m) => (
          <SelectItem key={m.id} value={String(m.id)}>
            {m.fullName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
