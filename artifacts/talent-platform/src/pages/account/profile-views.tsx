import { Link } from "wouter";
import {
  useListCandidateProfileViews,
  useGetCandidate,
  getGetCandidateQueryKey,
  getListCandidateProfileViewsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Eye,
  Building2,
  ExternalLink,
  CheckCircle2,
  Star,
  Lock,
} from "lucide-react";

function formatRelative(iso: string) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function ProfileViewsPage() {
  const { sessionUser } = useAuth();
  const candidateId = sessionUser?.candidateId ?? 0;

  const { data: candidate } = useGetCandidate(candidateId, {
    query: {
      enabled: candidateId > 0,
      queryKey: getGetCandidateQueryKey(candidateId),
    },
  });

  const { data, isLoading, error } = useListCandidateProfileViews(
    candidateId,
    {
      query: {
        enabled: candidateId > 0,
        queryKey: getListCandidateProfileViewsQueryKey(candidateId),
      },
    },
  );

  if (!sessionUser || sessionUser.role !== "candidate" || !candidateId) {
    return (
      <div className="container px-4 py-12 max-w-3xl mx-auto">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Sign in as a candidate to see who's been viewing your profile.
          </CardContent>
        </Card>
      </div>
    );
  }

  const httpError = error as { status?: number } | null;
  const boostRequired = httpError?.status === 403;

  // Boost-locked state — gate the entire feature behind an upgrade CTA.
  if (boostRequired || (candidate && !candidate.isBoosted)) {
    return (
      <div className="container px-4 py-12 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Who Viewed Your Profile
          </h1>
          <p className="text-muted-foreground mt-1">
            See which companies are checking out your profile in real time.
          </p>
        </div>

        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="py-12 flex flex-col items-center text-center gap-4">
            <div className="p-4 rounded-full bg-primary/10">
              <Lock className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">
                Boost your profile to unlock
              </h2>
              <p className="text-muted-foreground mt-2 max-w-md">
                Boosted candidates can see every company that has viewed their
                profile, with full company details, and get a real-time
                notification each time a new recruiter opens their profile.
              </p>
            </div>
            <Button asChild size="lg" className="mt-2">
              <Link to="/dashboard/candidate">
                <Star className="w-4 h-4 mr-2" /> Boost my profile
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container px-4 py-8 max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Who Viewed Your Profile
          </h1>
          <p className="text-muted-foreground mt-1">
            Recent recruiter activity from companies on Jumerra.
          </p>
        </div>
        {data && (
          <div className="flex gap-3">
            <Badge variant="secondary" className="text-sm py-1.5 px-3">
              <Eye className="w-3.5 h-3.5 mr-1.5" />
              {data.totalViews} total view{data.totalViews === 1 ? "" : "s"}
            </Badge>
            <Badge variant="secondary" className="text-sm py-1.5 px-3">
              <Building2 className="w-3.5 h-3.5 mr-1.5" />
              {data.uniqueEmployers} compan
              {data.uniqueEmployers === 1 ? "y" : "ies"}
            </Badge>
          </div>
        )}
      </div>

      {isLoading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      )}

      {data && data.items.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-2">
            <Eye className="w-10 h-10 mx-auto opacity-30" />
            <p className="font-medium">No profile views yet.</p>
            <p className="text-sm">
              When recruiters open your profile, they'll appear here.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {data?.items.map((item, idx) => (
          <Card
            key={`${item.employer.id}-${idx}`}
            className="hover:shadow-md transition-shadow"
          >
            <CardHeader className="pb-3">
              <div className="flex items-start gap-4">
                <Avatar className="w-14 h-14 border">
                  <AvatarImage src={item.employer.logoUrl} alt="" />
                  <AvatarFallback>
                    <Building2 className="w-6 h-6" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      to={`/employers/${item.employer.id}`}
                      className="font-semibold text-lg hover:underline truncate"
                    >
                      {item.employer.name}
                    </Link>
                    {item.employer.verified && (
                      <CheckCircle2
                        className="w-4 h-4 text-primary"
                        aria-label="Verified"
                      />
                    )}
                    <Badge variant="outline" className="text-xs">
                      {item.viewCount} view
                      {item.viewCount === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  {item.employer.tagline && (
                    <CardDescription className="mt-0.5 line-clamp-1">
                      {item.employer.tagline}
                    </CardDescription>
                  )}
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatRelative(item.lastViewedAt)}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
                {item.employer.industry && (
                  <span>{item.employer.industry}</span>
                )}
                {item.employer.location && (
                  <span>{item.employer.location}</span>
                )}
                {item.viewerName && (
                  <span className="text-foreground">
                    Viewed by {item.viewerName}
                    {item.viewerTitle ? ` · ${item.viewerTitle}` : ""}
                  </span>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to={`/employers/${item.employer.id}`}>
                    View company
                  </Link>
                </Button>
                {item.employer.websiteUrl && (
                  <Button asChild variant="ghost" size="sm">
                    <a
                      href={item.employer.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Website <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
