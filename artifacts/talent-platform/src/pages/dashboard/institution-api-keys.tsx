import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Copy, Trash2, KeyRound } from "lucide-react";
import { PremiumGate, ProBadge } from "@/lib/institution-premium";

type ApiKeyRow = {
  id: number;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type CreateResponse = ApiKeyRow & { key: string };

/**
 * T7: Owner-only Pro feature for managing SIS API keys. The plaintext
 * key is shown exactly once after creation; thereafter only the
 * 12-char prefix is rendered for identification.
 */
export default function InstitutionApiKeysPage() {
  const { sessionUser } = useAuth();
  const institutionId =
    sessionUser?.role === "institution" ? sessionUser.institutionId : null;
  const isOwner = sessionUser?.orgRole === "owner";

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreateResponse | null>(null);

  const baseUrl = institutionId
    ? `/api/institutions/${institutionId}/api-keys`
    : null;

  async function refresh() {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const res = await fetch(baseUrl, { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as ApiKeyRow[];
        setKeys(data);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (institutionId && isOwner) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId, isOwner]);

  async function createKey() {
    if (!baseUrl) return;
    setCreating(true);
    try {
      const res = await fetch(baseUrl, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim() || "Untitled key" }),
      });
      if (res.status === 402) {
        toast.error("Institution Pro is required to mint API keys.");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(body.error ?? "Failed to create key");
        return;
      }
      const data = (await res.json()) as CreateResponse;
      setJustCreated(data);
      setLabel("");
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: number) {
    if (!baseUrl) return;
    if (!confirm("Revoke this API key? Existing integrations will stop working.")) return;
    const res = await fetch(`${baseUrl}/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      toast.success("Key revoked");
      await refresh();
    } else {
      toast.error("Failed to revoke");
    }
  }

  if (!institutionId) {
    return (
      <div className="container max-w-md py-16">
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Sign in with an institution account to manage API keys.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="container max-w-2xl py-12">
        <Card>
          <CardContent className="p-8 text-sm text-muted-foreground">
            API keys can only be managed by the institution owner.
          </CardContent>
        </Card>
      </div>
    );
  }

  const active = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);

  return (
    <div className="container max-w-4xl space-y-6 py-8">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">API keys</h1>
          <ProBadge />
        </div>
        <p className="text-sm text-muted-foreground">
          Mint keys for your SIS to pull the verified-student roster from{" "}
          <code className="font-mono">GET /api/v1/institutions/students</code>{" "}
          with{" "}
          <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>.
        </p>
      </div>

      <PremiumGate feature="SIS API access">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Create a new key
            </CardTitle>
            <CardDescription>
              Give the key a memorable label (e.g. "Banner SIS"). The full
              key is shown exactly once — store it somewhere safe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Banner SIS"
                  data-testid="input-api-key-label"
                />
              </div>
              <Button
                onClick={createKey}
                disabled={creating}
                data-testid="button-create-api-key"
              >
                {creating ? "Generating..." : "Create key"}
              </Button>
            </div>

            {justCreated && (
              <div className="rounded-md border border-amber-300 bg-amber-50/60 p-4 text-sm dark:bg-amber-500/10">
                <p className="mb-2 font-medium text-amber-900 dark:text-amber-200">
                  Your new key — copy it now. You won&apos;t see it again.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-background px-3 py-2 font-mono text-xs">
                    {justCreated.key}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(justCreated.key);
                      toast.success("Copied");
                    }}
                  >
                    <Copy className="mr-1 h-3 w-3" />
                    Copy
                  </Button>
                </div>
                <button
                  className="mt-2 text-xs text-muted-foreground underline"
                  onClick={() => setJustCreated(null)}
                >
                  Dismiss
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active keys ({active.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : active.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active keys yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {active.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">{k.label}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {k.prefix}…
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(k.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {k.lastUsedAt
                          ? new Date(k.lastUsedAt).toLocaleString()
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => revoke(k.id)}
                          data-testid={`button-revoke-${k.id}`}
                        >
                          <Trash2 className="mr-1 h-3 w-3" />
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {revoked.length > 0 && (
          <Card className="opacity-70">
            <CardHeader>
              <CardTitle className="text-sm">
                Revoked ({revoked.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {revoked.map((k) => (
                  <li key={k.id}>
                    {k.label} ({k.prefix}…) — revoked{" "}
                    {new Date(k.revokedAt!).toLocaleDateString()}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </PremiumGate>
    </div>
  );
}
