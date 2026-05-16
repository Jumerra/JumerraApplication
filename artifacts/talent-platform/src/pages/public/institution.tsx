import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, ExternalLink, GraduationCap, BookOpen } from "lucide-react";

type PublicInstitution = {
  id: number;
  name: string;
  type: string;
  location: string;
  logoUrl: string;
  websiteUrl: string;
  studentCount: number;
  placementRate: number;
  createdAt: string;
  slug: string | null;
  publicLeaderboardEnabled: boolean;
  bannerUrl: string | null;
  featuredPrograms:
    | Array<{ title: string; description: string }>
    | null;
  description: string;
};

export default function PublicInstitutionPage() {
  const [, params] = useRoute<{ slugOrId: string }>(
    "/public/institutions/:slugOrId",
  );
  const slugOrId = params?.slugOrId ?? "";
  const [data, setData] = useState<PublicInstitution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slugOrId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/public/institutions/${encodeURIComponent(slugOrId)}`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(r.status === 404 ? "Not found" : "Load failed");
        }
        return (await r.json()) as PublicInstitution;
      })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slugOrId]);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <Skeleton className="h-48 w-full rounded-2xl mb-6" />
        <Skeleton className="h-10 w-1/2 mb-2" />
        <Skeleton className="h-5 w-1/3" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto px-4 py-24 max-w-2xl text-center">
        <h1 className="text-2xl font-bold mb-2">Institution not found</h1>
        <p className="text-muted-foreground">
          We couldn't find a public profile for "{slugOrId}".
        </p>
      </div>
    );
  }

  const placementPct = Math.round((data.placementRate ?? 0) * 100);

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      {data.bannerUrl ? (
        <div
          className="h-48 md:h-64 rounded-2xl bg-cover bg-center mb-6 border"
          style={{ backgroundImage: `url(${data.bannerUrl})` }}
          data-testid="institution-banner"
        />
      ) : (
        <div className="h-32 rounded-2xl bg-gradient-to-r from-emerald-500/20 to-teal-500/20 mb-6 border" />
      )}

      <div className="flex items-start gap-6 mb-8">
        <img
          src={data.logoUrl}
          alt={data.name}
          className="w-24 h-24 rounded-2xl object-cover bg-muted border shadow-sm shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h1
            className="text-3xl md:text-4xl font-extrabold tracking-tight"
            data-testid="institution-name"
          >
            {data.name}
          </h1>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
            {data.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-4 h-4" /> {data.location}
              </span>
            ) : null}
            <Badge variant="outline" className="capitalize">
              {data.type}
            </Badge>
            {data.websiteUrl ? (
              <a
                href={data.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="w-4 h-4" /> Website
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-10">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <GraduationCap className="w-4 h-4" /> Verified students
            </div>
            <div className="text-3xl font-bold">{data.studentCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-muted-foreground text-sm mb-1">
              Placement rate
            </div>
            <div className="text-3xl font-bold">{placementPct}%</div>
          </CardContent>
        </Card>
      </div>

      {data.description ? (
        <section className="mb-10">
          <h2 className="text-xl font-bold mb-3">About</h2>
          <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {data.description}
          </p>
        </section>
      ) : null}

      {data.featuredPrograms && data.featuredPrograms.length > 0 ? (
        <section className="mb-10">
          <h2 className="text-xl font-bold mb-4">Featured programs</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {data.featuredPrograms.map((p, i) => (
              <Card key={i} data-testid={`featured-program-${i}`}>
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <BookOpen className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <div>
                      <h3 className="font-semibold mb-1">{p.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {p.description}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {data.publicLeaderboardEnabled ? (
        <a
          href={`/institutions/${data.id}/leaderboard`}
          className="inline-flex items-center gap-2 text-primary hover:underline"
        >
          View placement leaderboard →
        </a>
      ) : null}
    </div>
  );
}
