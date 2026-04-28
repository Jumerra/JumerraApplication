import { useListEmployers } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, MapPin, CheckCircle2, Building2 } from "lucide-react";
import { useState } from "react";

export default function EmployersList() {
  const [search, setSearch] = useState("");
  const { data: employers, isLoading } = useListEmployers({ search: search || undefined });

  return (
    <div className="container px-4 py-8 max-w-6xl mx-auto">
      <div className="mb-10 text-center max-w-2xl mx-auto space-y-4">
        <h1 className="text-4xl font-extrabold tracking-tight">Discover Top Employers</h1>
        <p className="text-xl text-muted-foreground">Find companies that align with your values and career goals.</p>
      </div>

      <div className="max-w-xl mx-auto mb-12">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input 
            placeholder="Search by company name or industry..." 
            className="pl-12 h-14 text-lg bg-background shadow-sm rounded-full border-muted-foreground/20"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3,4,5,6].map(i => (
            <Card key={i} className="h-64 animate-pulse bg-muted/50 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {employers?.map((employer) => (
            <Card key={employer.id} className="group overflow-hidden rounded-2xl hover:shadow-lg transition-all cursor-pointer border-transparent hover:border-border bg-card" onClick={() => window.location.href = `/employers/${employer.id}`}>
              <div className="h-24 w-full bg-muted overflow-hidden relative">
                <img src={employer.coverUrl} alt="" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
              </div>
              <CardContent className="p-6 relative pt-0">
                <img 
                  src={employer.logoUrl} 
                  alt={employer.name} 
                  className="w-16 h-16 rounded-xl object-cover bg-background border-4 border-background absolute -top-8 left-6 shadow-sm" 
                />
                <div className="mt-10 mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold">{employer.name}</h3>
                    {employer.verified && <CheckCircle2 className="w-5 h-5 text-primary" />}
                  </div>
                  <p className="text-sm text-muted-foreground">{employer.tagline}</p>
                </div>
                
                <div className="flex flex-wrap gap-2 mb-6">
                  <Badge variant="secondary" className="bg-muted">{employer.industry}</Badge>
                  <Badge variant="outline" className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {employer.location}
                  </Badge>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-border/50 text-sm">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    {employer.size}
                  </span>
                  <span className="font-semibold text-primary">
                    {employer.openJobs} open jobs
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
