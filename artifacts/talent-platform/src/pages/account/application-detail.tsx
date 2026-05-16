import { useParams, Link } from "wouter";
import {
  useListApplications,
  getListApplicationsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { ApplicationTimeline } from "@/components/application-timeline";
import { InterviewPrepPanel } from "@/components/InterviewPrepPanel";
import { ReportSalaryCard } from "@/components/ReportSalaryCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Sparkles, Stamp } from "lucide-react";

const PREP_STATUSES = new Set(["screening", "interview", "offer", "hired"]);

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const applicationId = Number(params.id);
  const { userId } = useAuth();
  const candidateId = userId ?? 0;

  const listParams = { candidateId };
  const { data: apps } = useListApplications(listParams, {
    query: {
      queryKey: getListApplicationsQueryKey(listParams),
      enabled: candidateId > 0,
    },
  });
  const app = apps?.find((a) => a.id === applicationId);

  return (
    <div className="container px-4 py-8 max-w-3xl mx-auto space-y-6">
      <Link
        to="/dashboard/candidate"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="w-4 h-4" /> Back to dashboard
      </Link>
      {app ? (
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="text-xl">{app.jobTitle}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{app.employerName}</p>
            </div>
            <Badge variant="secondary" className="capitalize">{app.status}</Badge>
          </CardHeader>
          <CardContent>
            <Link to={`/jobs/${app.jobId}`} className="text-sm text-primary hover:underline">
              View job posting
            </Link>
          </CardContent>
        </Card>
      ) : null}
      {app?.endorsement ? (
        <Card
          className="border-emerald-500/30 bg-emerald-500/5"
          data-testid={`endorsement-card-${app.id}`}
        >
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Stamp className="w-4 h-4 text-emerald-600" /> Verified by{" "}
              {app.endorsement.institutionName}
            </CardTitle>
            <Badge className="bg-emerald-600 text-white">Endorsed</Badge>
          </CardHeader>
          {app.endorsement.note ? (
            <CardContent className="text-sm text-muted-foreground">
              "{app.endorsement.note}"
            </CardContent>
          ) : null}
        </Card>
      ) : null}
      {app && typeof app.mockInterviewScore === "number" ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> AI mock interview
            </CardTitle>
            <Badge className="bg-primary text-primary-foreground">
              {app.mockInterviewScore}/100
            </Badge>
          </CardHeader>
          {app.mockInterviewBreakdown ? (
            <CardContent className="grid grid-cols-3 gap-3">
              <Tile label="Technical" value={app.mockInterviewBreakdown.technical} />
              <Tile
                label="Communication"
                value={app.mockInterviewBreakdown.communication}
              />
              <Tile label="Culture" value={app.mockInterviewBreakdown.culture} />
            </CardContent>
          ) : null}
        </Card>
      ) : null}
      {app && candidateId > 0 && PREP_STATUSES.has(app.status) ? (
        <InterviewPrepPanel candidateId={candidateId} jobId={app.jobId} />
      ) : null}
      {app && app.status === "hired" && candidateId > 0 ? (
        <ReportSalaryCard
          applicationId={app.id}
          candidateId={candidateId}
          alreadyReported={Boolean(app.reportedSalary)}
        />
      ) : null}
      {applicationId > 0 ? <ApplicationTimeline applicationId={applicationId} /> : null}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-background p-3 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}
