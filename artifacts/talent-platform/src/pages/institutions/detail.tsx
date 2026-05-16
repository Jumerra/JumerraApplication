import {
  useGetInstitution,
  useListInstitutionStudents,
  useGetInstitutionEmployersLeaderboard,
} from "@workspace/api-client-react";
import { Link, useParams } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { MapPin, Globe, Building2, Trophy } from "lucide-react";

export default function InstitutionDetail() {
  const { id } = useParams();
  const instId = Number(id);
  const { data: inst, isLoading: isLoadingInst } = useGetInstitution(instId);
  const { data: students, isLoading: isLoadingStudents } = useListInstitutionStudents(instId);
  const { data: leaderboard } = useGetInstitutionEmployersLeaderboard(instId);

  if (isLoadingInst) {
    return <div className="container py-12"><div className="animate-pulse h-64 bg-muted rounded-2xl" /></div>;
  }

  if (!inst) return null;

  return (
    <div className="container px-4 py-8 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="bg-card rounded-3xl p-6 md:p-10 shadow-sm border relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
        
        <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-start relative z-10">
          <img 
            src={inst.logoUrl} 
            alt={inst.name} 
            className="w-24 h-24 md:w-32 md:h-32 rounded-2xl object-cover bg-background border-4 border-background shadow-md shrink-0" 
          />
          <div className="flex-1 w-full">
            <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
              <div>
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-2">{inst.name}</h1>
                <div className="flex flex-wrap gap-3">
                  <Badge variant="secondary" className="capitalize bg-muted">{inst.type.replace('_', ' ')}</Badge>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground font-medium">
                    <MapPin className="w-4 h-4" /> {inst.location}
                  </div>
                  <a href={inst.websiteUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
                    <Globe className="w-4 h-4" /> Website
                  </a>
                </div>
              </div>
              <div className="flex gap-4 md:text-right">
                <div className="bg-background border rounded-xl p-3 shadow-sm min-w-24 text-center">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Students</p>
                  <p className="text-xl font-bold">{inst.studentCount.toLocaleString()}</p>
                </div>
                <div className="bg-primary border-primary rounded-xl p-3 shadow-sm min-w-24 text-center text-primary-foreground">
                  <p className="text-xs text-primary-foreground/80 font-medium uppercase tracking-wider mb-1">Placement</p>
                  <p className="text-xl font-bold">{Math.round(inst.placementRate * 100)}%</p>
                </div>
              </div>
            </div>
            
            <p className="text-muted-foreground mt-6 leading-relaxed max-w-3xl">
              {inst.description}
            </p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Student Roster</h2>
            <Badge variant="outline">{students?.length || 0} students shown</Badge>
          </div>

          <Card className="border-none shadow-sm bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-32">Readiness</TableHead>
                    <TableHead className="w-32">Talent Score</TableHead>
                    <TableHead>Placement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingStudents ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading students...</TableCell></TableRow>
                  ) : students?.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No students found.</TableCell></TableRow>
                  ) : (
                    students?.map((student) => (
                      <TableRow key={student.candidateId} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => window.location.href = `/candidates/${student.candidateId}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <img src={student.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover bg-muted" />
                            <div>
                              <p className="font-medium">{student.fullName}</p>
                              <p className="text-xs text-muted-foreground truncate max-w-[150px]">{student.headline}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={`capitalize ${
                            student.status === 'hired' ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400' :
                            student.status === 'interviewing' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400' :
                            student.status === 'applying' ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400' :
                            'bg-muted'
                          }`}>
                            {student.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={student.readinessScore} className="h-2" />
                            <span className="text-xs font-medium">{student.readinessScore}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={student.talentScore} className="h-2 [&>div]:bg-primary" />
                            <span className="text-xs font-medium">{student.talentScore}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {student.currentEmployerName ? (
                            <span className="flex items-center gap-1.5 text-sm font-medium">
                              <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                              {student.currentEmployerName}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground italic">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          {leaderboard && leaderboard.employers.length > 0 && (
            <Card className="shadow-sm border-primary/20" data-testid="card-employers-leaderboard">
              <CardContent className="p-6">
                <h3 className="font-bold mb-1 flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-primary" /> Top employers of our students
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Most hires from {leaderboard.year} (verified students only).
                </p>
                <ol className="space-y-3">
                  {leaderboard.employers.map((e, idx) => (
                    <li key={e.employerId}>
                      <Link href={`/employers/${e.employerId}`}>
                        <div className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-muted transition-colors cursor-pointer">
                          <span className="text-xs font-bold text-muted-foreground w-4 tabular-nums">
                            {idx + 1}
                          </span>
                          <img
                            src={e.employerLogoUrl}
                            alt=""
                            className="w-9 h-9 rounded-lg object-cover border"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{e.employerName}</p>
                          </div>
                          <Badge variant="secondary">
                            {e.hires} hire{e.hires === 1 ? "" : "s"}
                          </Badge>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          <Card className="shadow-sm">
            <CardContent className="p-6">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary" /> Partner Employers
              </h3>
              <div className="space-y-4">
                {inst.partnerEmployers?.map(emp => (
                  <Link key={emp.id} href={`/employers/${emp.id}`}>
                    <div className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-muted transition-colors cursor-pointer">
                      <img src={emp.logoUrl} alt="" className="w-10 h-10 rounded-lg object-cover border" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{emp.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{emp.industry}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
