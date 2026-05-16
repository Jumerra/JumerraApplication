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
import { ArrowLeft, Save, Loader2, GraduationCap, Plus, Trash2 } from "lucide-react";
import { Link } from "wouter";
import {
  INSTITUTION_KIND_OPTIONS,
  type InstitutionKind,
} from "@/lib/institution-kinds";
import {
  PremiumGate,
  ProBadge,
  useInstitutionPremium,
} from "@/lib/institution-premium";

export default function InstitutionEditPage() {
  const { sessionUser } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const institutionId = sessionUser?.institutionId ?? null;
  const isOwner =
    sessionUser?.role === "institution" && sessionUser.orgRole === "owner";
  // Hooks must run unconditionally on every render — keep this above
  // the early-return branches below.
  const { isPremium } = useInstitutionPremium();

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
  const [bannerUrl, setBannerUrl] = useState("");
  const [featuredPrograms, setFeaturedPrograms] = useState<
    Array<{ title: string; description: string }>
  >([]);

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
    setBannerUrl(institution.bannerUrl ?? "");
    setFeaturedPrograms(institution.featuredPrograms ?? []);
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
    // Branded fields are sent only when the institution is Pro — the
    // <PremiumGate> hides the inputs for Starter, but defending in the
    // submit handler keeps stale React state from triggering an
    // unexpected 402 if the subscription lapsed mid-session.
    const branded = isPremium
      ? {
          bannerUrl: bannerUrl.trim() || null,
          featuredPrograms: featuredPrograms
            .map((p) => ({ title: p.title.trim(), description: p.description.trim() }))
            .filter((p) => p.title.length > 0),
        }
      : {};
    update.mutate({
      data: {
        name: name.trim(),
        type,
        location: location.trim(),
        websiteUrl: websiteUrl.trim(),
        logoUrl: logoUrl.trim(),
        description: description.trim(),
        publicLeaderboardEnabled,
        ...branded,
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
            <CardTitle className="flex items-center gap-2">
              Branded profile <ProBadge />
            </CardTitle>
            <CardDescription>
              Customize your public institution page with a hero banner and
              up to 12 featured programs. Available on Institution Pro.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PremiumGate feature="Branded profile">
              <div className="space-y-5">
                <div className="grid gap-2">
                  <Label htmlFor="bannerUrl">Hero banner image URL</Label>
                  <Input
                    id="bannerUrl"
                    type="url"
                    value={bannerUrl}
                    onChange={(e) => setBannerUrl(e.target.value)}
                    placeholder="https://"
                    maxLength={1000}
                  />
                  {bannerUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={bannerUrl}
                      alt=""
                      className="mt-2 w-full h-32 object-cover rounded-lg border bg-muted"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : null}
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Featured programs</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      disabled={featuredPrograms.length >= 12}
                      onClick={() =>
                        setFeaturedPrograms((prev) => [
                          ...prev,
                          { title: "", description: "" },
                        ])
                      }
                    >
                      <Plus className="w-3.5 h-3.5" /> Add program
                    </Button>
                  </div>
                  {featuredPrograms.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No featured programs yet. Add up to 12 flagship majors
                      or programs to highlight on your public profile.
                    </p>
                  ) : (
                    featuredPrograms.map((p, idx) => (
                      <div
                        key={idx}
                        className="grid gap-2 p-3 rounded-lg border bg-muted/30"
                      >
                        <div className="flex gap-2">
                          <Input
                            placeholder="Program title"
                            value={p.title}
                            maxLength={200}
                            onChange={(e) =>
                              setFeaturedPrograms((prev) =>
                                prev.map((row, i) =>
                                  i === idx ? { ...row, title: e.target.value } : row,
                                ),
                              )
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setFeaturedPrograms((prev) =>
                                prev.filter((_, i) => i !== idx),
                              )
                            }
                            aria-label="Remove program"
                          >
                            <Trash2 className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </div>
                        <Textarea
                          placeholder="Short description"
                          value={p.description}
                          rows={2}
                          maxLength={1000}
                          onChange={(e) =>
                            setFeaturedPrograms((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, description: e.target.value } : row,
                              ),
                            )
                          }
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </PremiumGate>
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
