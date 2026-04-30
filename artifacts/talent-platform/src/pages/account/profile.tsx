import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useUpdateMyProfile,
  useGetCandidate,
  useUpdateCandidate,
  getGetCurrentUserQueryKey,
  getGetCandidateQueryKey,
  getGetInstitutionQueryKey,
  getInstitution,
  type CandidateInstitutionLink,
  type InstitutionDetail,
} from "@workspace/api-client-react";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import { useUpload } from "@workspace/object-storage-web";
import { useAuth } from "@/lib/auth";
import { academicUnitTerms } from "@/lib/institution-kinds";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { GraduationCap } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  UserCircle2,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  Upload,
  Loader2,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CandidateExperienceEditor } from "@/components/candidate-experience-editor";

const ROLE_LABEL: Record<string, string> = {
  candidate: "Candidate",
  employer: "Employer",
  institution: "Institution",
  admin: "Platform Admin",
};

const ORG_ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  support: "Support",
  owner: "Owner",
  recruiter: "Recruiter",
  coordinator: "Coordinator",
  viewer: "Viewer",
};

function avatarSrc(avatarUrl: string | null | undefined): string | undefined {
  if (!avatarUrl) return undefined;
  // The API returns a normalized object path like /objects/uploads/<id>.
  // The storage router serves it at /api/storage/objects/...
  if (avatarUrl.startsWith("/objects/")) {
    return `/api/storage${avatarUrl}`;
  }
  return avatarUrl;
}

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const { sessionUser, isLoading, refresh } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateMyProfile();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Candidate-only education affiliations. We fetch the candidate record
  // to read the per-institution department assignments. The session user
  // doesn't include the institution links, so this is the canonical source.
  // NOTE: backend candidate-ownership checks compare against
  // `user.candidateId` (the linked candidate row), NOT `user.id` (the
  // user account row), so we must use candidateId here.
  const isCandidate =
    sessionUser?.role === "candidate" && sessionUser.candidateId != null;
  const candidateId = isCandidate ? sessionUser!.candidateId! : 0;
  const { data: candidate } = useGetCandidate(candidateId, {
    query: {
      queryKey: getGetCandidateQueryKey(candidateId),
      enabled: isCandidate && candidateId > 0,
    },
  });
  const updateCandidate = useUpdateCandidate();

  // Per-affiliation department selection (string for Select compatibility;
  // "" = unassigned/null).
  const [deptByInst, setDeptByInst] = useState<Record<number, string>>({});
  const [savingInst, setSavingInst] = useState<number | null>(null);

  // Hydrate the form from the loaded session.
  useEffect(() => {
    if (!sessionUser) return;
    setFullName(sessionUser.fullName ?? "");
    setPhone(sessionUser.phone ?? "");
    setTitle(sessionUser.title ?? "");
    setBio(sessionUser.bio ?? "");
    setAvatarUrl(sessionUser.avatarUrl ?? null);
  }, [sessionUser]);

  // Hydrate the dept picker map whenever the candidate record changes.
  useEffect(() => {
    if (!candidate) return;
    const next: Record<number, string> = {};
    for (const link of candidate.institutions) {
      next[link.id] = link.departmentId ? String(link.departmentId) : "";
    }
    setDeptByInst(next);
  }, [candidate]);

  // Pull the department list for each institution the candidate is
  // affiliated with. We need this both to render the picker options and
  // to label things "Program" vs "Department" by institution kind.
  const institutionLinks: CandidateInstitutionLink[] = useMemo(
    () => candidate?.institutions ?? [],
    [candidate],
  );
  // GET /institutions/{id} already returns the full department list,
  // so we reuse it instead of adding a second endpoint. One query per
  // affiliated institution; React Query dedupes if the same id repeats.
  const institutionDetailQueries = useQueries({
    queries: institutionLinks.map((link) => ({
      queryKey: getGetInstitutionQueryKey(link.id),
      queryFn: () => getInstitution(link.id),
      enabled: isCandidate,
      staleTime: 60_000,
    })),
  });

  const { uploadFile, isUploading, progress } = useUpload({
    onError: (err) => {
      toast({
        title: "Upload failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Unsupported file",
        description: "Please choose an image (PNG, JPG, GIF, or WebP).",
        variant: "destructive",
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "Image too large",
        description: "Avatar must be under 5 MB.",
        variant: "destructive",
      });
      return;
    }
    const result = await uploadFile(file);
    if (result?.objectPath) {
      setAvatarUrl(result.objectPath);
      // Persist immediately so the header updates without waiting for Save.
      try {
        await update.mutateAsync({
          data: { avatarUrl: result.objectPath },
        });
        await queryClient.invalidateQueries({
          queryKey: getGetCurrentUserQueryKey(),
        });
        await refresh();
        toast({ title: "Avatar updated" });
      } catch (err: any) {
        toast({
          title: "Could not save avatar",
          description: err?.data?.error ?? "Please try saving again.",
          variant: "destructive",
        });
      }
    }
  }

  async function handleRemoveAvatar() {
    setAvatarUrl(null);
    try {
      await update.mutateAsync({ data: { avatarUrl: null } });
      await queryClient.invalidateQueries({
        queryKey: getGetCurrentUserQueryKey(),
      });
      await refresh();
      toast({ title: "Avatar removed" });
    } catch (err: any) {
      toast({
        title: "Could not remove avatar",
        description: err?.data?.error ?? "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (fullName.trim().length === 0) {
      setError("Name cannot be empty");
      return;
    }
    try {
      await update.mutateAsync({
        data: {
          fullName: fullName.trim(),
          phone: phone.trim() === "" ? null : phone.trim(),
          title: title.trim() === "" ? null : title.trim(),
          bio: bio.trim() === "" ? null : bio,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetCurrentUserQueryKey(),
      });
      await refresh();
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } catch (err: any) {
      setError(err?.data?.error ?? "Could not update your profile");
    }
  }

  if (isLoading) {
    return (
      <div className="container max-w-2xl py-16 px-4">
        <Card className="shadow-md">
          <CardContent className="p-8 text-center text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!sessionUser) {
    return (
      <div className="container max-w-md py-16 px-4">
        <Card className="shadow-md">
          <CardContent className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">You need to sign in first</p>
            <Button asChild className="mt-4" onClick={() => setLocation("/login")}>
              <Link href="/login">Sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const initial = (sessionUser.fullName ?? sessionUser.email ?? "?")
    .charAt(0)
    .toUpperCase();
  const orgRoleLabel = sessionUser.orgRole
    ? ORG_ROLE_LABEL[sessionUser.orgRole] ?? sessionUser.orgRole
    : null;

  return (
    <div className="container max-w-2xl py-12 px-4 space-y-6">
      <Card className="shadow-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <UserCircle2 className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-xl">Your profile</CardTitle>
              <CardDescription>
                {ROLE_LABEL[sessionUser.role] ?? sessionUser.role}
                {orgRoleLabel ? ` · ${orgRoleLabel}` : ""}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <Avatar className="h-20 w-20">
              {avatarSrc(avatarUrl) && (
                <AvatarImage
                  src={avatarSrc(avatarUrl)}
                  alt={sessionUser.fullName}
                />
              )}
              <AvatarFallback className="text-xl bg-primary/10 text-primary font-semibold">
                {initial}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-2 flex-1">
              <div className="flex flex-wrap gap-2">
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  disabled={isUploading || update.isPending}
                >
                  <label
                    htmlFor="avatar-input"
                    className="cursor-pointer inline-flex items-center gap-2"
                  >
                    {isUploading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {isUploading ? `Uploading ${progress}%` : "Upload new avatar"}
                  </label>
                </Button>
                <input
                  id="avatar-input"
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handleAvatarChange}
                  disabled={isUploading || update.isPending}
                />
                {avatarUrl && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleRemoveAvatar}
                    disabled={isUploading || update.isPending}
                    className="text-muted-foreground"
                  >
                    <X className="w-4 h-4 mr-1" /> Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                PNG, JPG, GIF, or WebP. Max 5 MB.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-md">
        <CardHeader>
          <CardTitle className="text-lg">Personal details</CardTitle>
          <CardDescription>
            Visible to teammates and the people you connect with on TalentLink.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                value={sessionUser.email}
                readOnly
                disabled
                className="bg-muted/40"
              />
              <p className="text-xs text-muted-foreground">
                Email is your sign-in identifier and can&apos;t be changed here.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                maxLength={200}
                autoComplete="name"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={50}
                  autoComplete="tel"
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder={
                    sessionUser.role === "candidate"
                      ? "e.g. Senior Backend Engineer"
                      : "e.g. Talent Acquisition Lead"
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={2000}
                rows={5}
                placeholder="A short summary about you, your work, or your team."
              />
              <p className="text-xs text-muted-foreground text-right">
                {bio.length}/2000
              </p>
            </div>
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {done && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-emerald-50 text-emerald-900 text-sm">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Profile saved.</span>
              </div>
            )}
            <div className="flex justify-end">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isCandidate && candidate ? (
        <CandidateExperienceEditor
          candidateId={candidateId}
          experience={candidate.experience}
        />
      ) : null}

      {isCandidate && institutionLinks.length > 0 ? (
        <Card className="shadow-md">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                <GraduationCap className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg">Education</CardTitle>
                <CardDescription>
                  Pick your department or program at each institution so your
                  school can group you with the right cohort.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {institutionLinks.map((link, idx) => {
              const detailQuery = institutionDetailQueries[idx];
              const detail = detailQuery?.data as
                | InstitutionDetail
                | undefined;
              const departments = detail?.departments ?? [];
              const terms = academicUnitTerms(detail?.type ?? link.type);
              const value = deptByInst[link.id] ?? "";
              const original = link.departmentId
                ? String(link.departmentId)
                : "";
              const dirty = value !== original;

              const onSave = async () => {
                setSavingInst(link.id);
                try {
                  await updateCandidate.mutateAsync({
                    id: candidateId,
                    data: {
                      affiliations: [
                        {
                          institutionId: link.id,
                          departmentId: value === "" ? null : Number(value),
                        },
                      ],
                    },
                  });
                  await queryClient.invalidateQueries({
                    queryKey: getGetCandidateQueryKey(candidateId),
                  });
                  toast({
                    title: `${terms.singular} saved`,
                    description: link.name,
                  });
                } catch (err: any) {
                  toast({
                    title: `Could not save ${terms.singular.toLowerCase()}`,
                    description: err?.data?.error ?? "Please try again.",
                    variant: "destructive",
                  });
                } finally {
                  setSavingInst(null);
                }
              };

              return (
                <div
                  key={link.id}
                  className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4 p-4 rounded-lg border"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <img
                      src={link.logoUrl}
                      alt=""
                      className="w-10 h-10 rounded object-cover bg-muted shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate">{link.name}</p>
                        {link.isPrimary ? (
                          <Badge variant="default" className="text-[10px]">
                            Primary
                          </Badge>
                        ) : null}
                        {link.isVerified ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Verified
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {detailQuery?.isLoading
                          ? `Loading ${terms.plural.toLowerCase()}…`
                          : departments.length === 0
                          ? `Your institution hasn't added ${terms.plural.toLowerCase()} yet.`
                          : `Pick the ${terms.singular.toLowerCase()} you're enrolled in.`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Select
                      value={value === "" ? "none" : value}
                      onValueChange={(v) =>
                        setDeptByInst((m) => ({
                          ...m,
                          [link.id]: v === "none" ? "" : v,
                        }))
                      }
                      disabled={
                        departments.length === 0 ||
                        savingInst === link.id ||
                        detailQuery?.isLoading
                      }
                    >
                      <SelectTrigger className="w-[220px]">
                        <SelectValue
                          placeholder={`Choose a ${terms.singular.toLowerCase()}`}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">
                          Not assigned
                        </SelectItem>
                        {departments.map((d) => (
                          <SelectItem key={d.id} value={String(d.id)}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      onClick={onSave}
                      disabled={
                        !dirty ||
                        savingInst === link.id ||
                        updateCandidate.isPending
                      }
                    >
                      {savingInst === link.id ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
