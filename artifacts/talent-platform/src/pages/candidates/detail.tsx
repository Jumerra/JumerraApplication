import { useGetCandidate, useGetCandidateRecommendations } from "@workspace/api-client-react";
import { Link, useParams } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MapPin, Mail, Phone, ExternalLink, Video, Star, Award, Briefcase, GraduationCap, Sparkles, Link2, BadgeCheck } from "lucide-react";
import { EMPLOYMENT_TYPE_LABELS, LOCATION_TYPE_LABELS } from "@/lib/experience-labels";

export default function CandidateDetail() {
  const { id } = useParams();
  const candidateId = Number(id);
  const { data: candidate, isLoading } = useGetCandidate(candidateId);
  const { data: recommendations } = useGetCandidateRecommendations(candidateId);

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
              <div className="flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full font-bold shadow-sm shrink-0">
                <Star className="w-5 h-5 fill-primary" />
                <span>{candidate.talentScore}</span>
                <span className="text-xs font-medium uppercase tracking-wider ml-1">Score</span>
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
                  {candidate.institutions.map((inst) => (
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
                  ))}
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
                  {candidate.skills.map((skill) => (
                    <Badge key={skill} variant="secondary" className="px-3 py-1 bg-muted">{skill}</Badge>
                  ))}
                </div>
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
    </div>
  );
}
