import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Quote } from "lucide-react";

type Story = {
  id: number;
  quote: string;
  photoUrl: string | null;
  candidate: { id: number; fullName: string; avatarUrl: string; headline: string };
  employer: { id: number; name: string; logoUrl: string };
};

export function StudentStoriesPanel() {
  const [stories, setStories] = useState<Story[] | null>(null);
  useEffect(() => {
    customFetch<{ stories: Story[] }>("/api/placement-stories")
      .then((d) => setStories(d?.stories ?? []))
      .catch(() => setStories([]));
  }, []);

  if (!stories || stories.length === 0) return null;

  return (
    <section className="py-16 bg-muted/30">
      <div className="container px-4">
        <div className="text-center mb-10">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">
            Student stories
          </h2>
          <p className="text-muted-foreground mt-2">
            Real candidates, real placements.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {stories.slice(0, 6).map((s) => (
            <Card key={s.id} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-6 space-y-4">
                <Quote className="w-6 h-6 text-primary/40" />
                <p className="text-sm leading-relaxed line-clamp-5">"{s.quote}"</p>
                <div className="flex items-center gap-3 pt-3 border-t">
                  <img
                    src={s.photoUrl || s.candidate.avatarUrl || "/avatar-placeholder.png"}
                    alt=""
                    className="w-10 h-10 rounded-full bg-muted object-cover"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">
                      {s.candidate.fullName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      Now at {s.employer.name}
                    </p>
                  </div>
                  <img
                    src={s.employer.logoUrl}
                    alt=""
                    className="w-8 h-8 rounded bg-background object-cover border"
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
