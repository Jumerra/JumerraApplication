import { useListJobs } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, MapPin, Briefcase } from "lucide-react";
import { useState } from "react";

export default function JobsList() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<any>(undefined);
  
  const { data: jobs, isLoading } = useListJobs({ 
    search: search || undefined,
    type: type !== "all" ? type : undefined
  });

  return (
    <div className="container px-4 py-8 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Explore Opportunities</h1>
          <p className="text-muted-foreground">Find the next step in your career journey.</p>
        </div>
      </div>

      <Card className="mb-8 p-4 bg-muted/30 border-none shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search jobs, skills, or companies..." 
              className="pl-9 bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={type || "all"} onValueChange={(val) => setType(val)}>
            <SelectTrigger className="w-full sm:w-[180px] bg-background">
              <SelectValue placeholder="Job Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="full_time">Full Time</SelectItem>
              <SelectItem value="part_time">Part Time</SelectItem>
              <SelectItem value="internship">Internship</SelectItem>
              <SelectItem value="contract">Contract</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {isLoading ? (
        <div className="space-y-4">
          {[1,2,3,4].map(i => (
            <Card key={i} className="h-32 animate-pulse bg-muted/50" />
          ))}
        </div>
      ) : jobs?.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Briefcase className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="text-lg font-medium text-foreground">No jobs found</p>
          <p>Try adjusting your search filters.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {jobs?.map((job) => (
            <Card key={job.id} className="group hover:border-primary/50 transition-all cursor-pointer hover:shadow-md" onClick={() => window.location.href = `/jobs/${job.id}`}>
              <CardContent className="p-6 flex flex-col sm:flex-row gap-6">
                <img src={job.employerLogoUrl} alt="" className="w-16 h-16 rounded-xl object-cover bg-muted border" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:justify-between gap-2 mb-2">
                    <div>
                      <h3 className="text-xl font-semibold group-hover:text-primary transition-colors">{job.title}</h3>
                      <p className="text-muted-foreground">{job.employerName}</p>
                    </div>
                    {job.salaryMin && (
                      <div className="text-left sm:text-right font-medium text-green-600 dark:text-green-500">
                        {job.currency} {(job.salaryMin / 1000).toFixed(0)}k - {(job.salaryMax! / 1000).toFixed(0)}k
                      </div>
                    )}
                  </div>
                  
                  <div className="flex flex-wrap gap-2 mb-4">
                    <Badge variant="secondary" className="capitalize">{job.type.replace('_', ' ')}</Badge>
                    <Badge variant="outline" className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {job.remote ? 'Remote' : job.location}
                    </Badge>
                  </div>
                  
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{job.summary}</p>
                  
                  <div className="flex flex-wrap gap-2">
                    {job.skills.slice(0, 5).map(skill => (
                      <Badge key={skill} variant="secondary" className="bg-primary/5 text-primary hover:bg-primary/10 border-transparent">
                        {skill}
                      </Badge>
                    ))}
                    {job.skills.length > 5 && (
                      <Badge variant="secondary" className="bg-primary/5 text-primary hover:bg-primary/10 border-transparent">
                        +{job.skills.length - 5}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
