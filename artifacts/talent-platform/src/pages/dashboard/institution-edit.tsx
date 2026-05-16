import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useGetInstitution,
  useUpdateMyInstitution,
  getGetInstitutionQueryKey,
  getGetInstitutionDashboardQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Save, Loader2, GraduationCap } from "lucide-react";
import { Link } from "wouter";
import {
  INSTITUTION_KIND_OPTIONS,
  type InstitutionKind,
} from "@/lib/institution-kinds";

export default function InstitutionEditPage() {
  const { sessionUser } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const institutionId = sessionUser?.institutionId ?? null;
  const isOwner =
    sessionUser?.role === "institution" && sessionUser.orgRole === "owner";

  const { data: institution, isLoading } = useGetInstitution(
    institutionId ?? 0,
    {
      query: {
        queryKey: getGetInstitutionQueryKey(institutionId ?? 0),
        enabled: institutionId != null,
      },
    },
  );

  const [name, setName] = useState("");
  const [type, setType] = useState<InstitutionKind>("university");
  const [location, setLocation] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [publicLeaderboardEnabled, setPublicLeaderboardEnabled] =
    useState(true);

  // Sync form state once when the institution loads (and again if it gets
  // refetched). Avoids stomping the user's in-flight edits on every render.
  useEffect(() => {
    if (!institution) return;
    setName(institution.name);
    // The DB allows free text; coerce unknown kinds back to "other" for the
    // <Select> rather than rendering an invalid option.
    const known = INSTITUTION_KIND_OPTIONS.some((o) => o.value === institution.type);
    setType((known ? institution.type : "other") as InstitutionKind);
    setLocation(institution.location);
    setWebsiteUrl(institution.websiteUrl);
    setLogoUrl(institution.logoUrl);
    setDescription(institution.description);
    setPublicLeaderboardEnabled(institution.publicLeaderboardEnabled);
  }, [institution]);

  const update = useUpdateMyInstitution({
    mutation: {
      onSuccess: () => {
        toast.success("Institution updated");
        if (institutionId != null) {
          queryClient.invalidateQueries({
            queryKey: getGetInstitutionQueryKey(institutionId),
          });
          queryClient.invalidateQueries({
            queryKey: getGetInstitutionDashboardQueryKey(institutionId),
          });
        }
        navigate("/dashboard/institution");
      },
      onError: (err) => {
        toast.error("Could not update institution", {
          description: err instanceof Error ? err.message : undefined,
        });
      },
    },
  });

  if (sessionUser && sessionUser.role !== "institution") {
    return (
      <div className="container py-12 px-4 text-center">
        <p className="text-muted-foreground">
          This page is for institution accounts only.
        </p>
      </div>
    );
  }

  if (!isOwner && !isLoading) {
    return (
      <div className="container py-12 px-4 text-center space-y-3">
        <p className="text-muted-foreground">
          Only institution owners can edit the institution profile.
        </p>
        <Button asChild variant="outline">
          <Link href="/dashboard/institution">Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  if (isLoading || !institution) {
    return (
      <div className="container py-12 px-4">
        <div className="animate-pulse h-[400px] bg-muted rounded-2xl" />
      </div>
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !location.trim()) {
      toast.error("Name and location are required");
      return;
    }
    update.mutate({
      data: {
        name: name.trim(),
        type,
        location: location.trim(),
        websiteUrl: websiteUrl.trim(),
        logoUrl: logoUrl.trim(),
        description: description.trim(),
        publicLeaderboardEnabled,
      },
    });
  }

  return (
    <div className="container px-4 py-8 max-w-3xl mx-auto space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="gap-2 -ml-2">
          <Link href="/dashboard/institution">
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-muted border flex items-center justify-center text-muted-foreground">
          <GraduationCap className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Institution profile</h1>
          <p className="text-muted-foreground">
            Update your institution's public details. Visible on the
            institutions directory and student dashboards.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Basic information</CardTitle>
            <CardDescription>
              The kind helps candidates and employers understand what type of
              programme you run.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-2">
              <Label htmlFor="name">Institution name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="type">Kind</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as InstitutionKind)}
              >
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INSTITUTION_KIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                required
                maxLength={200}
                placeholder="City, Country"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="websiteUrl">Website</Label>
              <Input
                id="websiteUrl"
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://"
                maxLength={1000}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="logoUrl">Logo URL</Label>
              <Input
                id="logoUrl"
                type="url"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://"
                maxLength={1000}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">About</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                maxLength={5000}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Public placement leaderboard</CardTitle>
            <CardDescription>
              When enabled, anyone can view your cohort placement
              leaderboard at /institutions/{institutionId}/leaderboard.
              Turn it off to hide the page from visitors and search
              engines.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="publicLeaderboardEnabled">
                  Show public leaderboard
                </Label>
                <p className="text-sm text-muted-foreground">
                  Placement totals, top employers, and salary bands by role
                  family. Salary bands need at least 3 hires to appear.
                </p>
              </div>
              <Switch
                id="publicLeaderboardEnabled"
                checked={publicLeaderboardEnabled}
                onCheckedChange={setPublicLeaderboardEnabled}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 mt-6">
          <Button asChild variant="outline" type="button">
            <Link href="/dashboard/institution">Cancel</Link>
          </Button>
          <Button type="submit" disabled={update.isPending} className="gap-2">
            {update.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}
