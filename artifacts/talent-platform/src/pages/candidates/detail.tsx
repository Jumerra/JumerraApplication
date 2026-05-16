import {
  useGetCandidate,
  useGetCandidateRecommendations,
  useListTalentPools,
  useAddTalentPoolMembers,
  getListTalentPoolsQueryKey,
  getGetTalentPoolQueryKey,
} from "@workspace/api-client-react";
import { Link, useParams } from "wouter";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MapPin, Mail, Phone, ExternalLink, Video, Star, Award, Briefcase, GraduationCap, Sparkles, Link2, BadgeCheck, ShieldCheck, ShieldAlert, Quote, FolderPlus } from "lucide-react";
import { EMPLOYMENT_TYPE_LABELS, LOCATION_TYPE_LABELS } from "@/lib/experience-labels";
import { useAuth } from "@/lib/auth";

const RELATIONSHIP_LABEL: Record<string, string> = {
  lecturer: "Lecturer",
  past_employer: "Past employer",
  colleague: "Colleague",
  other: "Other",
};

const BG_BADGE: Record<
  string,
  { label: string; className: string; icon: typeof ShieldCheck }
> = {
  passed: {
    label: "Background check passed",
    className: "bg-emerald-600 text-white hover:bg-emerald-600",
    icon: ShieldCheck,
  },
  in_progress: {
    label: "Background check in progress",
    className: "bg-amber-500 text-white hover:bg-amber-500",
    icon: ShieldAlert,
  },
  failed: {
    label: "Background check failed",
    className: "bg-destructive text-destructive-foreground hover:bg-destructive",
    icon: ShieldAlert,
  },
};

export default function CandidateDetail() {
  const { id } = useParams();
  const candidateId = Number(id);
  const { data: candidate, isLoading } = useGetCandidate(candidateId);
  const { data: recommendations } = useGetCandidateRecommendations(candidateId);

  const { sessionUser, role } = useAuth();
  const isEmployer = role === "employer";
  const employerId = sessionUser?.employerId ?? 0;
  const qc = useQueryClient();
  const { data: pools } = useListTalentPools(employerId, {
    query: {
      enabled: isEmployer && employerId > 0,
      queryKey: getListTalentPoolsQueryKey(employerId),
    },
  });
  const addMembers = useAddTalentPoolMembers();
  const [poolDialogOpen, setPoolDialogOpen] = useState(false);
  const [chosenPoolId, setChosenPoolId] = useState("");
  const [tagInput, setTagInput] = useState("");
  const onAddToPool = () => {
    if (!chosenPoolId) return;
    const poolId = Number(chosenPoolId);
    const tags = tagInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    addMembers.mutate(
      {
        id: employerId,
        poolId,
        data: {
          candidateIds: [candidateId],
          ...(tags.length > 0 ? { tags } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success("Added to pool");
          qc.invalidateQueries({
            queryKey: getGetTalentPoolQueryKey(employerId, poolId),
          });
          qc.invalidateQueries({
            queryKey: getListTalentPoolsQueryKey(employerId),
          });
          setPoolDialogOpen(false);
          setChosenPoolId("");
          setTagInput("");
        },
        onError: () => toast.error("Could not add to pool"),
      },
    );
  };

  if (isLoading) {
    return <div className="container py-12"><div className="animate-pulse h-[600px] bg-muted rounded-2xl" /></div>;
  }

  if (!candidate) return null;

  return (
    <div className="container px-4 py-8 max-w-5xl mx-auto">
      <div className="bg-card rounded-3xl p-6 md:p-10 shadow-sm border border-border mb-8 relative overflow-hidden">
        {candidate.isBoosted && (
          <div className="absolute top-0 right-0 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-sm font-bold px-4 py-2 rounded-bl-2xl flex items-center gap-1 shadow-sm">
            <Sparkles className="w-4 h-4" /> Top Talent
          </div>
        )}
        <div className="flex flex-col md:flex-row gap-8 items-start relative z-10">
          <img 
            src={candidate.avatarUrl} 
            alt={candidate.fullName} 
            className="w-32 h-32 md:w-40 md:h-40 rounded-full object-cover bg-muted border-4 border-background shadow-md" 
          />
          <div className="flex-1 w-full pt-2">
            <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
              <div>
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-2">{candidate.fullName}</h1>
                <p className="text-xl text-muted-foreground">{candidate.headline}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isEmployer && employerId > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPoolDialogOpen(true)}
                    data-testid="button-add-to-pool"
                  >
                    <FolderPlus className="w-4 h-4 mr-1.5" /> Add to pool
                  </Button>
                ) : null}
                {candidate.backgroundCheck && BG_BADGE[candidate.backgroundCheck.status] ? (() => {
                  const cfg = BG_BADGE[candidate.backgroundCheck.status]!;
                  const Icon = cfg.icon;
                  return (
                    <Badge className={`gap-1 ${cfg.className}`}>
                      <Icon className="w-3 h-3" /> {cfg.label}
                    </Badge>
                  );
                })() : null}
                <div className="flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full font-bold shadow-sm">
                  <Star className="w-5 h-5 fill-primary" />
                  <span>{candidate.talentScore}</span>
                  <span className="text-xs font-medium uppercase tracking-wider ml-1">Score</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4" /> {candidate.location}
              </div>
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4" /> {candidate.yearsExperience} Years Experience
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4" /> {candidate.email}
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4" /> {candidate.phone}
              </div>
            </div>

            {candidate.institutions && candidate.institutions.length > 0 && (
              <div className="mt-6">
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  Institutions
                </p>
                <div className="flex flex-wrap gap-2">
                  {candidate.institutions.map((inst) => {
                    const academicLine = [inst.facultyName, inst.departmentName]
                      .filter((s): s is string => !!s && s.length > 0)
                      .join(" · ");
                    return (
                    <div
                      key={inst.id}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border ${
                        inst.isPrimary
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted text-foreground border-border"
                      }`}
                      title={
                        inst.isVerified
                          ? `Verified by ${inst.name}`
                          : "Awaiting verification by the institution"
                      }
                    >
                      {inst.isPrimary ? (
                        <GraduationCap className="w-3.5 h-3.5" />
                      ) : (
                        <Link2 className="w-3.5 h-3.5" />
                      )}
                      <span className="font-medium">{inst.name}</span>
                      {academicLine ? (
                        <span
                          className={`text-xs ${
                            inst.isPrimary
                              ? "opacity-90"
                              : "text-muted-foreground"
                          }`}
                        >
                          {academicLine}
                        </span>
                      ) : null}
                      {inst.isVerified ? (
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold rounded-full px-1.5 py-0.5 ${
                            inst.isPrimary
                              ? "bg-background/20 text-primary-foreground"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          }`}
                        >
                          <BadgeCheck className="w-3 h-3" /> Verified
                        </span>
                      ) : (
                        <span
                          className={`text-[10px] uppercase tracking-wider font-semibold ${
                            inst.isPrimary ? "opacity-80" : "text-muted-foreground"
                          }`}
                        >
                          {inst.isPrimary ? "Primary" : "Unverified"}
                        </span>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3 mt-6">
              {candidate.portfolioUrl && (
                <a href={candidate.portfolioUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                  <ExternalLink className="w-4 h-4" /> Portfolio
                </a>
              )}
              {candidate.videoIntroUrl && (
                <a href={candidate.videoIntroUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                  <Video className="w-4 h-4" /> Video Intro
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <Tabs defaultValue="about" className="w-full">
            <TabsList className="w-full justify-start border-b rounded-none h-auto bg-transparent p-0 gap-6">
              <TabsTrigger value="about" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3 text-base">About</TabsTrigger>
              <TabsTrigger value="experience" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3 text-base">Experience</TabsTrigger>
              <TabsTrigger value="education" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-3 text-base">Education</TabsTrigger>
            </TabsList>
            
            <TabsContent value="about" className="pt-6 outline-none">
              <div className="prose dark:prose-invert max-w-none">
                <h3 className="text-lg font-semibold mb-4">Bio</h3>
                <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">{candidate.bio}</p>
                
                <h3 className="text-lg font-semibold mt-8 mb-4">Skills</h3>
                <div className="flex flex-wrap gap-2">
                  {candidate.skills.map((skill) => {
                    const verifications = candidate.verifiedSkills?.filter(
                      (v) => v.skill.toLowerCase() === skill.toLowerCase(),
                    ) ?? [];
                    const verified = verifications.length > 0;
                    const tooltip = verified
                      ? verifications
                          .map((v) =>
                            `Verified by ${v.institutionName} · ${new Date(v.issuedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`,
                          )
                          .join("\n")
                      : undefined;
                    const earliest = verified
                      ? verifications
                          .map((v) => new Date(v.issuedAt).getTime())
                          .sort((a, b) => a - b)[0]!
                      : null;
                    return (
                      <Badge
                        key={skill}
                        variant="secondary"
                        title={tooltip}
                        className={`px-3 py-1 inline-flex items-center gap-1 ${
                          verified
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-900"
                            : "bg-muted"
                        }`}
                      >
                        {verified ? <BadgeCheck className="w-3 h-3" /> : null}
                        {skill}
                        {verified && earliest != null ? (
                          <span className="text-[10px] opacity-70 ml-1">
                            {new Date(earliest).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                          </span>
                        ) : null}
                      </Badge>
                    );
                  })}
                </div>

                {candidate.references && candidate.references.length > 0 ? (
                  <>
                    <h3 className="text-lg font-semibold mt-8 mb-4 flex items-center gap-2">
                      <Quote className="w-4 h-4 text-primary" /> Verified references
                    </h3>
                    <div className="space-y-3">
                      {candidate.references.map((r) => (
                        <Card key={r.id} className="border-emerald-200/60 bg-emerald-50/30 dark:bg-emerald-900/10 dark:border-emerald-900/40">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <div>
                                <p className="font-semibold text-sm">{r.submittedRefereeName}</p>
                                <p className="text-xs text-muted-foreground">
                                  {r.submittedRefereeRole ? `${r.submittedRefereeRole} · ` : ""}
                                  {RELATIONSHIP_LABEL[r.relationship] ?? r.relationship}
                                </p>
                              </div>
                              {r.wouldRehire === true ? (
                                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 text-[10px]">
                                  Would rehire
                                </Badge>
                              ) : null}
                            </div>
                            <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                              {r.strengths}
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </TabsContent>
            
            <TabsContent value="experience" className="pt-6 outline-none space-y-6">
              {candidate.experience.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No work experience added yet.
                </p>
              ) : (
                candidate.experience.map((exp) => {
                  const startLabel = new Date(exp.startDate).toLocaleDateString(
                    undefined,
                    { month: "short", year: "numeric" },
                  );
                  const endLabel = exp.endDate
                    ? new Date(exp.endDate).toLocaleDateString(undefined, {
                        month: "short",
                        year: "numeric",
                      })
                    : "Present";
                  const employmentLabel = exp.employmentType
                    ? EMPLOYMENT_TYPE_LABELS[exp.employmentType] ?? null
                    : null;
                  const locationTypeLabel = exp.locationType
                    ? LOCATION_TYPE_LABELS[exp.locationType] ?? null
                    : null;
                  const locationLine = [exp.location, locationTypeLabel]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <div key={exp.id} className="flex gap-4 items-start">
                      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                        {exp.employerLogoUrl ? (
                          <img
                            src={exp.employerLogoUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Briefcase className="w-6 h-6 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-lg font-bold">{exp.title}</h4>
                        <p className="text-muted-foreground font-medium">
                          {exp.company}
                          {employmentLabel ? ` · ${employmentLabel}` : ""}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {startLabel} – {endLabel}
                        </p>
                        {locationLine ? (
                          <p className="text-sm text-muted-foreground">
                            {locationLine}
                          </p>
                        ) : null}
                        {exp.description ? (
                          <p className="text-muted-foreground text-sm leading-relaxed mt-2 whitespace-pre-line">
                            {exp.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </TabsContent>

            <TabsContent value="education" className="pt-6 outline-none space-y-8">
              {candidate.education.map((edu) => (
                <div key={edu.id} className="flex gap-4 items-start">
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
                    <GraduationCap className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <div>
                    <h4 className="text-lg font-bold">{edu.institution}</h4>
                    <p className="text-muted-foreground font-medium">{edu.degree} in {edu.fieldOfStudy}</p>
                    <p className="text-sm text-muted-foreground">
                      {edu.startYear} - {edu.endYear || 'Present'}
                    </p>
                  </div>
                </div>
              ))}
              
              {candidate.certifications.length > 0 && (
                <>
                  <h3 className="text-lg font-semibold mt-8 mb-6 border-t pt-8">Certifications</h3>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {candidate.certifications.map((cert) => (
                      <Card key={cert.id} className="bg-muted/30 border-none shadow-sm">
                        <CardContent className="p-4 flex gap-3 items-center">
                          <Award className="w-8 h-8 text-primary shrink-0" />
                          <div>
                            <p className="font-semibold text-sm line-clamp-1">{cert.name}</p>
                            <p className="text-xs text-muted-foreground">{cert.issuer}</p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6">
          {candidate.badges?.length > 0 && (
            <Card className="bg-gradient-to-br from-primary/5 to-transparent border-primary/10">
              <CardContent className="p-6">
                <h3 className="font-bold mb-4 flex items-center gap-2">
                  <Award className="w-5 h-5 text-primary" /> Achievements
                </h3>
                <div className="flex flex-wrap gap-3">
                  {candidate.badges.map(badge => (
                    <div key={badge.id} title={badge.description} className="flex flex-col items-center gap-1 p-2 bg-background rounded-lg shadow-sm border w-20 text-center cursor-help">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        badge.tier === 'gold' ? 'bg-yellow-100 text-yellow-600' :
                        badge.tier === 'silver' ? 'bg-gray-100 text-gray-500' :
                        badge.tier === 'bronze' ? 'bg-orange-50 text-orange-700' :
                        'bg-purple-100 text-purple-600'
                      }`}>
                        <Award className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] font-semibold leading-tight line-clamp-2">{badge.name}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {recommendations && recommendations.length > 0 && (
            <div>
              <h3 className="font-bold mb-4 text-lg">Recommended Roles</h3>
              <div className="space-y-3">
                {recommendations.slice(0, 4).map(job => (
                  <Card key={job.jobId} className="group hover:border-primary/50 transition-colors cursor-pointer shadow-sm" onClick={() => window.location.href = `/jobs/${job.jobId}`}>
                    <CardContent className="p-4 flex gap-3">
                      <img src={job.employerLogoUrl} alt="" className="w-10 h-10 rounded-lg object-cover bg-muted shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm line-clamp-1 group-hover:text-primary transition-colors">{job.title}</p>
                        <p className="text-xs text-muted-foreground">{job.employerName}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary">
                            {job.matchScore}% Match
                          </Badge>
                          <span className="text-[10px] text-muted-foreground truncate">{job.location}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={poolDialogOpen} onOpenChange={setPoolDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {candidate.fullName} to a pool</DialogTitle>
          </DialogHeader>
          {pools && pools.length > 0 ? (
            <div className="space-y-3">
              <Select value={chosenPoolId} onValueChange={setChosenPoolId}>
                <SelectTrigger data-testid="select-pool-detail">
                  <SelectValue placeholder="Pick a pool…" />
                </SelectTrigger>
                <SelectContent>
                  {pools.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} ({p.memberCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div>
                <label className="text-sm font-medium">
                  Tags (optional, comma-separated)
                </label>
                <Input
                  placeholder="e.g. backend, ghana, top-pick"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  data-testid="input-pool-tags-detail"
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              You have no talent pools yet.{" "}
              <Link
                href="/dashboard/employer/talent-pools"
                className="text-primary underline"
              >
                Create one
              </Link>
              .
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPoolDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={onAddToPool}
              disabled={
                !chosenPoolId || addMembers.isPending || !pools?.length
              }
              data-testid="button-confirm-add-to-pool"
            >
              {addMembers.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
