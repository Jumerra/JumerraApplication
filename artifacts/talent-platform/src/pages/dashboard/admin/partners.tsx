import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPartnerSettings,
  useUpdatePartnerSettings,
  useListPartners,
  useCreatePartner,
  useUpdatePartner,
  useDeletePartner,
  getGetPartnerSettingsQueryKey,
  getListPartnersQueryKey,
  type Partner,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Handshake,
  Plus,
  Pencil,
  Trash2,
  Save,
  ImageOff,
  AlertCircle,
} from "lucide-react";

type DraftState = {
  name: string;
  logoUrl: string;
  displayOrder: string;
};

const EMPTY_DRAFT: DraftState = { name: "", logoUrl: "", displayOrder: "" };

function partnerToDraft(p: Partner): DraftState {
  return {
    name: p.name,
    logoUrl: p.logoUrl,
    displayOrder: String(p.displayOrder),
  };
}

function validateDraft(d: DraftState): string | null {
  if (!d.name.trim()) return "Name is required.";
  if (d.name.trim().length > 200) return "Name must be 200 characters or fewer.";
  if (!d.logoUrl.trim()) return "Logo URL is required.";
  if (d.logoUrl.trim().length > 2048) return "Logo URL is too long.";
  if (d.displayOrder !== "") {
    const n = Number(d.displayOrder);
    if (!Number.isInteger(n)) return "Display order must be a whole number.";
  }
  return null;
}

export default function AdminPartnersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: settings, isLoading: settingsLoading } = useGetPartnerSettings();
  const { data: partners, isLoading: partnersLoading } = useListPartners();
  const updateSettings = useUpdatePartnerSettings();
  const createPartner = useCreatePartner();
  const updatePartner = useUpdatePartner();
  const deletePartner = useDeletePartner();

  const [isActive, setIsActive] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!settings || hydrated) return;
    setIsActive(settings.isActive);
    setHydrated(true);
  }, [settings, hydrated]);

  const handleToggle = async (next: boolean) => {
    setIsActive(next);
    try {
      await updateSettings.mutateAsync({ data: { isActive: next } });
      await queryClient.invalidateQueries({
        queryKey: getGetPartnerSettingsQueryKey(),
      });
      toast({
        title: next ? "Partners section enabled" : "Partners section disabled",
        description: next
          ? "The marquee will appear on the public landing page."
          : "The section is now hidden from the public landing page.",
      });
    } catch (err) {
      // Roll back optimistic UI on failure.
      setIsActive(!next);
      toast({
        title: "Could not update setting",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  // Editor dialog state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const draftValidation = useMemo(() => validateDraft(draft), [draft]);

  const openCreate = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setDraftError(null);
    setEditorOpen(true);
  };

  const openEdit = (p: Partner) => {
    setEditingId(p.id);
    setDraft(partnerToDraft(p));
    setDraftError(null);
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const err = validateDraft(draft);
    if (err) {
      setDraftError(err);
      return;
    }
    setSaving(true);
    setDraftError(null);
    const payload = {
      name: draft.name.trim(),
      logoUrl: draft.logoUrl.trim(),
      ...(draft.displayOrder !== ""
        ? { displayOrder: Number(draft.displayOrder) }
        : {}),
    };
    try {
      if (editingId === null) {
        await createPartner.mutateAsync({ data: payload });
        toast({ title: "Partner added" });
      } else {
        await updatePartner.mutateAsync({
          id: editingId,
          data: payload,
        });
        toast({ title: "Partner updated" });
      }
      await queryClient.invalidateQueries({
        queryKey: getListPartnersQueryKey(),
      });
      setEditorOpen(false);
    } catch (e) {
      setDraftError(
        e instanceof Error ? e.message : "Could not save the partner.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: Partner) => {
    if (!window.confirm(`Remove "${p.name}" from the partners section?`)) {
      return;
    }
    try {
      await deletePartner.mutateAsync({ id: p.id });
      await queryClient.invalidateQueries({
        queryKey: getListPartnersQueryKey(),
      });
      toast({ title: "Partner removed" });
    } catch (e) {
      toast({
        title: "Could not remove partner",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Handshake className="w-6 h-6 text-primary" />
          Our Partners
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Curate the partner logos that appear in the sliding marquee on
          the public landing page.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Section visibility</CardTitle>
          <CardDescription>
            When this is off, the section is removed from the landing page
            entirely — visitors don&apos;t see a heading or any logos.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="partners-active" className="text-base">
              Show &quot;Our Partners&quot; on the landing page
            </Label>
            <p className="text-sm text-muted-foreground mt-1">
              {settingsLoading
                ? "Loading…"
                : isActive
                ? "Visible to all visitors."
                : "Hidden from the public landing page."}
            </p>
          </div>
          <Switch
            id="partners-active"
            checked={isActive}
            onCheckedChange={handleToggle}
            disabled={settingsLoading || updateSettings.isPending}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Partners</CardTitle>
            <CardDescription>
              Logos slide horizontally in the order shown below. Lower
              display-order numbers appear first.
            </CardDescription>
          </div>
          <Button onClick={openCreate} size="sm">
            <Plus className="w-4 h-4 mr-1" />
            Add partner
          </Button>
        </CardHeader>
        <CardContent>
          {partnersLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse bg-muted rounded-lg"
                />
              ))}
            </div>
          ) : !partners || partners.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Handshake className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium text-foreground">No partners yet</p>
              <p className="text-sm mt-1">
                Add your first partner to get the marquee rolling.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {partners.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-4 py-3"
                  data-testid={`partner-row-${p.id}`}
                >
                  <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden border shrink-0">
                    <PartnerLogo url={p.logoUrl} name={p.name} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      Order #{p.displayOrder} · {p.logoUrl}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(p)}
                      aria-label={`Edit ${p.name}`}
                      data-testid={`edit-partner-${p.id}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(p)}
                      aria-label={`Delete ${p.name}`}
                      data-testid={`delete-partner-${p.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId === null ? "Add partner" : "Edit partner"}
            </DialogTitle>
            <DialogDescription>
              The name appears as a tooltip under the logo. Use a square
              or wide horizontal logo for best results.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="partner-name">Name</Label>
              <Input
                id="partner-name"
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                placeholder="Northstar University"
                data-testid="partner-name-input"
              />
            </div>
            <div>
              <Label htmlFor="partner-logo">Logo URL</Label>
              <Input
                id="partner-logo"
                value={draft.logoUrl}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, logoUrl: e.target.value }))
                }
                placeholder="https://example.com/logo.png"
                data-testid="partner-logo-input"
              />
              {draft.logoUrl ? (
                <div className="mt-2 flex items-center gap-3">
                  <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center overflow-hidden border">
                    <PartnerLogo url={draft.logoUrl} name={draft.name} />
                  </div>
                  <p className="text-xs text-muted-foreground">Preview</p>
                </div>
              ) : null}
            </div>
            <div>
              <Label htmlFor="partner-order">Display order (optional)</Label>
              <Input
                id="partner-order"
                type="number"
                value={draft.displayOrder}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, displayOrder: e.target.value }))
                }
                placeholder="Leave blank to add at the end"
                data-testid="partner-order-input"
              />
            </div>

            {draftError ? (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{draftError}</span>
              </div>
            ) : draftValidation ? (
              <p className="text-xs text-muted-foreground">{draftValidation}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditorOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || draftValidation !== null}
              data-testid="partner-save-button"
            >
              <Save className="w-4 h-4 mr-1" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PartnerLogo({ url, name }: { url: string; name: string }) {
  const [errored, setErrored] = useState(false);
  useEffect(() => {
    setErrored(false);
  }, [url]);
  if (!url || errored) {
    return <ImageOff className="w-5 h-5 text-muted-foreground" />;
  }
  return (
    <img
      src={url}
      alt={name}
      className="w-full h-full object-contain"
      onError={() => setErrored(true)}
    />
  );
}
