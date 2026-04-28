import { useListCandidates } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, MapPin, Star, Sparkles } from "lucide-react";
import { useState } from "react";

export default function CandidatesList() {
  const [search, setSearch] = useState("");
  const { data: candidates, isLoading } = useListCandidates({ search: search || undefined });

  return (
    <div className="container px-4 py-8 max-w-6xl mx-auto">
      <div className="mb-10 space-y-4">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Talent Directory</h1>
        <p className="text-xl text-muted-foreground">Discover verified professionals and rising stars.</p>
      </div>

      <div className="max-w-xl mb-12">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input 
            placeholder="Search by role, skills, or institution..." 
            className="pl-12 h-14 text-lg bg-background shadow-sm rounded-xl border-muted-foreground/20"
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
          {candidates?.map((candidate) => (
            <Card key={candidate.id} className="group overflow-hidden rounded-2xl hover:shadow-lg transition-all cursor-pointer border-transparent hover:border-border bg-card relative" onClick={() => window.location.href = `/candidates/${candidate.id}`}>
              {candidate.isBoosted && (
                <div className="absolute top-4 right-4 z-10 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-xs font-bold px-2 py-1 rounded-md flex items-center gap-1 shadow-sm">
                  <Sparkles className="w-3 h-3" /> Promoted
                </div>
              )}
              <CardContent className="p-6">
                <div className="flex gap-4 items-start mb-4">
                  <img 
                    src={candidate.avatarUrl} 
                    alt={candidate.fullName} 
                    className="w-16 h-16 rounded-full object-cover bg-muted border-2 border-background shadow-sm" 
                  />
                  <div className="flex-1 min-w-0 pt-1">
                    <h3 className="text-lg font-bold truncate group-hover:text-primary transition-colors">{candidate.fullName}</h3>
                    <p className="text-sm font-medium text-muted-foreground truncate">{candidate.headline}</p>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-2 mb-4">
                  <Badge variant="outline" className="flex items-center gap-1 font-normal bg-background">
                    <MapPin className="w-3 h-3" />
                    {candidate.location}
                  </Badge>
                  <Badge variant="secondary" className="flex items-center gap-1 font-semibold text-primary bg-primary/10 border-transparent">
                    <Star className="w-3 h-3 fill-primary text-primary" />
                    {candidate.talentScore} Score
                  </Badge>
                </div>

                <div className="space-y-3">
                  <div className="text-sm">
                    <span className="text-muted-foreground font-medium">Availability:</span>{" "}
                    <span className="capitalize text-foreground font-medium">{candidate.availability.replace('_', ' ')}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {candidate.skills.slice(0, 4).map(skill => (
                      <span key={skill} className="px-2 py-1 bg-muted/50 rounded-md text-xs font-medium text-muted-foreground">
                        {skill}
                      </span>
                    ))}
                    {candidate.skills.length > 4 && (
                      <span className="px-2 py-1 bg-muted/50 rounded-md text-xs font-medium text-muted-foreground">
                        +{candidate.skills.length - 4}
                      </span>
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
