import { useParams, Link } from "wouter";
import {
  useListApplications,
  getListApplicationsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { ApplicationTimeline } from "@/components/application-timeline";
import { InterviewPrepPanel } from "@/components/InterviewPrepPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";

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
      {app && candidateId > 0 && PREP_STATUSES.has(app.status) ? (
        <InterviewPrepPanel candidateId={candidateId} jobId={app.jobId} />
      ) : null}
      {applicationId > 0 ? <ApplicationTimeline applicationId={applicationId} /> : null}
    </div>
  );
}
