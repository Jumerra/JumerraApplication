import { useGetEmployer } from "@workspace/api-client-react";
import { Link, useParams } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MapPin, Globe, Users, Briefcase, ExternalLink, CheckCircle2 } from "lucide-react";

export default function EmployerDetail() {
  const { id } = useParams();
  const { data: employer, isLoading } = useGetEmployer(Number(id));

  if (isLoading) {
    return <div className="container py-12"><div className="animate-pulse h-96 bg-muted rounded-2xl" /></div>;
  }

  if (!employer) return null;

  return (
    <div className="pb-20">
      {/* Header/Cover */}
      <div className="h-64 md:h-80 w-full relative bg-muted">
        <img src={employer.coverUrl} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
      </div>

      <div className="container px-4 max-w-5xl mx-auto -mt-20 relative z-10">
        <div className="bg-card rounded-3xl p-6 md:p-10 shadow-xl border border-border/50 mb-12">
          <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-start">
            <img 
              src={employer.logoUrl} 
              alt={employer.name} 
              className="w-24 h-24 md:w-32 md:h-32 rounded-2xl object-cover bg-background border-4 border-background shadow-md" 
            />
            <div className="flex-1 w-full">
              <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">{employer.name}</h1>
                    {employer.verified && <CheckCircle2 className="w-6 h-6 text-primary" />}
                  </div>
                  <p className="text-xl text-muted-foreground max-w-2xl">{employer.tagline}</p>
                </div>
                <Button asChild variant="outline" className="shrink-0 gap-2 rounded-full">
                  <a href={employer.websiteUrl} target="_blank" rel="noreferrer">
                    Visit Website <ExternalLink className="w-4 h-4" />
                  </a>
                </Button>
              </div>

              <div className="flex flex-wrap gap-4 mt-6">
                <Badge variant="secondary" className="px-3 py-1.5 text-sm bg-primary/5 text-primary hover:bg-primary/10 border-transparent">
                  {employer.industry}
                </Badge>
                <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                  <MapPin className="w-4 h-4" />
                  {employer.location}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                  <Users className="w-4 h-4" />
                  {employer.size} company
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 pt-10 border-t prose dark:prose-invert max-w-none">
            <h2 className="text-2xl font-bold mb-4">About {employer.name}</h2>
            <p className="text-lg text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {employer.description}
            </p>
          </div>
        </div>

        {/* Jobs List */}
        <div>
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Briefcase className="w-6 h-6 text-primary" />
              Open Positions ({employer.jobs?.length || 0})
            </h2>
          </div>

          {employer.jobs?.length === 0 ? (
            <div className="text-center py-16 bg-muted/30 rounded-2xl border border-dashed">
              <p className="text-lg font-medium text-muted-foreground">No open positions right now.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {employer.jobs?.map((job) => (
                <Card key={job.id} className="group hover:border-primary/50 transition-all cursor-pointer hover:shadow-md" onClick={() => window.location.href = `/jobs/${job.id}`}>
                  <CardContent className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex-1">
                      <h3 className="text-xl font-bold mb-3 group-hover:text-primary transition-colors">{job.title}</h3>
                      <div className="flex flex-wrap gap-2 mb-3">
                        <Badge variant="secondary">{job.type.replace('_', ' ')}</Badge>
                        <Badge variant="outline" className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {job.remote ? 'Remote' : job.location}
                        </Badge>
                        {job.salaryMin && (
                          <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 border-green-200">
                            {job.currency} {(job.salaryMin / 1000).toFixed(0)}k - {(job.salaryMax! / 1000).toFixed(0)}k
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1">{job.summary}</p>
                    </div>
                    <Button variant="ghost" className="group-hover:bg-primary group-hover:text-primary-foreground md:shrink-0 transition-colors">
                      View Role
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
