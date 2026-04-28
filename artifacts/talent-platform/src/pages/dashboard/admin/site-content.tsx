import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSiteContent,
  useUpdateSiteContent,
  getGetSiteContentQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  ShieldAlert,
  Save,
  Sparkles,
  ImageIcon,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";

type FieldDef = {
  key: string;
  label: string;
  fallback: string;
  type: "text" | "image" | "longtext";
  hint?: string;
};

type Section = {
  id: string;
  title: string;
  description: string;
  fields: FieldDef[];
};

const SECTIONS: Section[] = [
  {
    id: "hero",
    title: "Hero",
    description: "Top-of-page headline, supporting copy and call-to-action buttons.",
    fields: [
      {
        key: "home.hero.headline_main",
        label: "Headline (main)",
        fallback: "The smart talent ecosystem for the",
        type: "text",
      },
      {
        key: "home.hero.headline_highlight",
        label: "Headline (highlighted word)",
        fallback: "next generation",
        type: "text",
        hint: "Rendered with the gradient accent.",
      },
      {
        key: "home.hero.subhead",
        label: "Subheading",
        fallback:
          "Connect with internships, remote jobs, and full-time roles. Powered by AI matching to help you land where you belong faster.",
        type: "longtext",
      },
      {
        key: "home.hero.cta_primary",
        label: "Primary button label",
        fallback: "Find work",
        type: "text",
      },
      {
        key: "home.hero.cta_secondary",
        label: "Secondary button label",
        fallback: "Hire talent",
        type: "text",
      },
      {
        key: "home.hero.image",
        label: "Hero background image URL",
        fallback: "/hero.png",
        type: "image",
        hint: "Must be a publicly reachable URL or a path served from the app.",
      },
    ],
  },
  {
    id: "howit",
    title: "How it works",
    description: "Three-step explainer for first-time visitors.",
    fields: [
      {
        key: "home.howit.title",
        label: "Section title",
        fallback: "How AI matching works",
        type: "text",
      },
      {
        key: "home.howit.subtitle",
        label: "Section subtitle",
        fallback:
          "We analyze skills, experience, and potential to create perfect pairings between talent and opportunity.",
        type: "longtext",
      },
      { key: "home.howit.step1_title", label: "Step 1 title", fallback: "1. Build your profile", type: "text" },
      {
        key: "home.howit.step1_desc",
        label: "Step 1 description",
        fallback:
          "Showcase your skills, education, and experience to build a comprehensive talent graph.",
        type: "longtext",
      },
      { key: "home.howit.step2_title", label: "Step 2 title", fallback: "2. Get matched", type: "text" },
      {
        key: "home.howit.step2_desc",
        label: "Step 2 description",
        fallback:
          "Our AI instantly pairs you with roles that fit your unique profile and career goals.",
        type: "longtext",
      },
      { key: "home.howit.step3_title", label: "Step 3 title", fallback: "3. Land the job", type: "text" },
      {
        key: "home.howit.step3_desc",
        label: "Step 3 description",
        fallback:
          "Apply with one click, track your pipeline, and get hired faster than ever before.",
        type: "longtext",
      },
    ],
  },
  {
    id: "audience",
    title: "Audience cards",
    description: "Three cards highlighting candidates, employers and institutions.",
    fields: [
      { key: "home.aud.candidates_title", label: "Candidates title", fallback: "Candidates", type: "text" },
      {
        key: "home.aud.candidates_desc",
        label: "Candidates description",
        fallback:
          "Discover roles that match your skills, build your profile, and fast-track your career with AI recommendations.",
        type: "longtext",
      },
      { key: "home.aud.employers_title", label: "Employers title", fallback: "Employers", type: "text" },
      {
        key: "home.aud.employers_desc",
        label: "Employers description",
        fallback:
          "Post opportunities, instantly see matched talent, and streamline your hiring pipeline from application to offer.",
        type: "longtext",
      },
      {
        key: "home.aud.institutions_title",
        label: "Institutions title",
        fallback: "Institutions",
        type: "text",
      },
      {
        key: "home.aud.institutions_desc",
        label: "Institutions description",
        fallback:
          "Track student placements in real-time, monitor readiness scores, and partner with top employers.",
        type: "longtext",
      },
    ],
  },
];

export default function AdminSiteContentPage() {
  const { sessionUser } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetSiteContent();
  const update = useUpdateSiteContent();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const hydratedRef = useRef(false);

  const currentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of data?.items ?? []) map.set(item.key, item.value);
    return map;
  }, [data]);

  useEffect(() => {
    // Initialize form state from server data exactly once. Subsequent
    // refetches (e.g. window-focus invalidations) must not clobber the
    // user's in-progress edits.
    if (!data || hydratedRef.current) return;
    const next: Record<string, string> = {};
    for (const section of SECTIONS) {
      for (const f of section.fields) {
        next[f.key] = currentMap.get(f.key) ?? f.fallback;
      }
    }
    setValues(next);
    hydratedRef.current = true;
  }, [data, currentMap]);

  if (!sessionUser || sessionUser.role !== "admin") {
    return (
      <div className="container max-w-md py-16">
        <Card>
          <CardContent className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">Admin access required</p>
            <Button asChild className="mt-4">
              <Link href="/login">Sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function onSave() {
    setError(null);
    try {
      const items: Array<{ key: string; type: "text" | "image"; value: string }> = [];
      for (const section of SECTIONS) {
        for (const f of section.fields) {
          const v = values[f.key] ?? "";
          items.push({
            key: f.key,
            type: f.type === "image" ? "image" : "text",
            value: v,
          });
        }
      }
      await update.mutateAsync({ data: { items } });
      await queryClient.invalidateQueries({ queryKey: getGetSiteContentQueryKey() });
      setSavedAt(new Date());
    } catch (err: any) {
      setError(err?.data?.error ?? "Save failed");
    }
  }

  return (
    <div className="container px-4 py-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center text-primary">
          <Sparkles className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Edit homepage content</h1>
          <p className="text-muted-foreground text-sm">
            Update the public marketing pages. Changes go live immediately.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/">
            <ExternalLink className="w-4 h-4 mr-1" /> View site
          </Link>
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {savedAt && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-emerald-100 text-emerald-900 text-sm border border-emerald-200">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Saved at {savedAt.toLocaleTimeString()}. Refresh the homepage to see your changes.</span>
        </div>
      )}

      {SECTIONS.map((section) => (
        <Card key={section.id} className="shadow-sm">
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            <CardDescription>{section.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {section.fields.map((f) => {
              const value = values[f.key] ?? "";
              const id = `field-${f.key}`;
              return (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={id} className="flex items-center gap-2">
                    {f.type === "image" && (
                      <ImageIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                    {f.label}
                  </Label>
                  {f.type === "longtext" ? (
                    <Textarea
                      id={id}
                      value={value}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [f.key]: e.target.value }))
                      }
                      rows={3}
                    />
                  ) : (
                    <Input
                      id={id}
                      value={value}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [f.key]: e.target.value }))
                      }
                      placeholder={f.fallback}
                    />
                  )}
                  {f.hint && (
                    <p className="text-xs text-muted-foreground">{f.hint}</p>
                  )}
                  {f.type === "image" && value && (
                    <div className="mt-2 rounded-md border bg-muted/30 p-2 inline-block">
                      <img
                        src={value}
                        alt="preview"
                        className="h-24 max-w-[300px] object-contain"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <div className="sticky bottom-4 flex justify-end">
        <Button
          onClick={onSave}
          disabled={update.isPending || isLoading}
          size="lg"
          className="shadow-lg"
        >
          <Save className="w-4 h-4 mr-2" />
          {update.isPending ? "Saving…" : "Save all changes"}
        </Button>
      </div>
    </div>
  );
}
