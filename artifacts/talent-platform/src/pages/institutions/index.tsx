import { useListInstitutions } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, MapPin, Users } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export default function InstitutionsList() {
  const { data: institutions, isLoading } = useListInstitutions();

  return (
    <div className="container px-4 py-8 max-w-6xl mx-auto">
      <div className="mb-10 space-y-4 text-center max-w-2xl mx-auto">
        <h1 className="text-4xl font-extrabold tracking-tight">Partner Institutions</h1>
        <p className="text-xl text-muted-foreground">The universities, bootcamps, and colleges powering the next generation of talent.</p>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3,4,5,6].map(i => (
            <Card key={i} className="h-64 animate-pulse bg-muted/50 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {institutions?.map((institution) => (
            <Card key={institution.id} className="group rounded-2xl hover:shadow-lg transition-all cursor-pointer border-transparent hover:border-border bg-card" onClick={() => window.location.href = `/institutions/${institution.id}`}>
              <CardContent className="p-6">
                <div className="flex gap-4 items-start mb-6">
                  <img 
                    src={institution.logoUrl} 
                    alt={institution.name} 
                    className="w-16 h-16 rounded-xl object-cover bg-background border shadow-sm" 
                  />
                  <div className="flex-1 min-w-0 pt-1">
                    <h3 className="text-lg font-bold leading-tight group-hover:text-primary transition-colors">{institution.name}</h3>
                    <Badge variant="secondary" className="mt-2 capitalize bg-muted font-medium">
                      {institution.type.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 mb-6 text-sm text-muted-foreground">
                  <MapPin className="w-4 h-4" />
                  {institution.location}
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                  <div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                      <Users className="w-3 h-3" /> Students
                    </div>
                    <p className="font-semibold">{institution.studentCount.toLocaleString()}</p>
                  </div>
                  <div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5">
                      <GraduationCap className="w-3 h-3" /> Placement Rate
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={institution.placementRate * 100} className="h-2" />
                      <span className="text-xs font-bold w-8 text-right">{Math.round(institution.placementRate * 100)}%</span>
                    </div>
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
