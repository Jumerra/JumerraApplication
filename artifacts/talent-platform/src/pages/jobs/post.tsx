import { useState } from "react";
import { useLocation } from "wouter";
import {
  useCreateJob,
  useGetJobTierSettings,
  useCreateJobTierCheckout,
  getListJobsQueryKey,
  getGetEmployerDashboardQueryKey,
  type CreateJob,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Briefcase,
  GraduationCap,
  Sparkles,
  Megaphone,
  Star,
  Loader2,
} from "lucide-react";

const formSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters"),
  type: z.enum(["internship", "part_time", "full_time", "contract", "remote"]),
  location: z.string().min(2, "Location is required"),
  remote: z.boolean(),
  salaryMin: z.coerce.number().optional().nullable(),
  salaryMax: z.coerce.number().optional().nullable(),
  currency: z.string().default("USD"),
  summary: z.string().min(10, "Summary must be at least 10 characters"),
  description: z.string().min(30, "Description must be at least 30 characters"),
  responsibilities: z.string().min(10, "Please provide responsibilities"),
  requirements: z.string().min(10, "Please provide requirements"),
  benefits: z.string(),
  skills: z.string().min(2, "Please provide some skills"),
});

type Tier = "free" | "promoted" | "sponsored";

function formatPrice(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export default function JobPost() {
  const { userId, role } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createJob = useCreateJob();
  const checkout = useCreateJobTierCheckout();
  const { data: tierSettings } = useGetJobTierSettings();
  const [tier, setTier] = useState<Tier>("free");
  const [submitting, setSubmitting] = useState(false);
  // Auto-attach a default skill challenge built from the job's
  // skills. Default ON — the candidate apply flow gates on the
  // challenge instead of cover notes when one is present.
  const [includeChallenge, setIncludeChallenge] = useState(true);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      type: "full_time",
      location: "",
      remote: false,
      salaryMin: null,
      salaryMax: null,
      currency: "USD",
      summary: "",
      description: "",
      responsibilities: "",
      requirements: "",
      benefits: "",
      skills: "",
    },
  });

  if (role !== "employer") {
    return (
      <div className="container py-20 text-center text-muted-foreground">
        You must be viewing as an employer to post a job.
      </div>
    );
  }

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!userId) return;
    setSubmitting(true);

    const payload: CreateJob = {
      title: values.title,
      type: values.type,
      location: values.location,
      remote: values.remote,
      salaryMin: values.salaryMin ?? undefined,
      salaryMax: values.salaryMax ?? undefined,
      currency: values.currency,
      summary: values.summary,
      description: values.description,
      employerId: userId,
      responsibilities: values.responsibilities
        .split("\n")
        .filter((r) => r.trim() !== ""),
      requirements: values.requirements
        .split("\n")
        .filter((r) => r.trim() !== ""),
      benefits: values.benefits.split("\n").filter((r) => r.trim() !== ""),
      skills: values.skills
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
      includeChallenge,
    };

    try {
      const created = await createJob.mutateAsync({ data: payload });
      queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
      queryClient.invalidateQueries({
        queryKey: getGetEmployerDashboardQueryKey(userId),
      });

      if (tier === "free") {
        toast.success("Job posted successfully!");
        setLocation("/dashboard/employer");
        return;
      }

      // Paid tier — kick off Stripe checkout for the freshly created job.
      const successUrl = `${window.location.origin}/jobs/promote/return?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${window.location.origin}/dashboard/employer?cancelled=1`;
      const session = await checkout.mutateAsync({
        id: created.id,
        data: { tier, successUrl, cancelUrl },
      });
      window.location.href = session.checkoutUrl;
    } catch (err: any) {
      toast.error("Failed to post job. Please check your inputs.");
      setSubmitting(false);
    }
  };

  const promotedAvailable = tierSettings?.promotedActive ?? false;
  const sponsoredAvailable = tierSettings?.sponsoredActive ?? false;

  const tierCards: Array<{
    id: Tier;
    title: string;
    description: string;
    priceLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    available: boolean;
  }> = [
    {
      id: "free",
      title: "Free",
      description: "Posted immediately. Standard placement in search results.",
      priceLabel: "Free",
      icon: Briefcase,
      available: true,
    },
    {
      id: "promoted",
      title: "Promoted",
      description:
        "Ranks above free jobs in the candidate feed for the boost period.",
      priceLabel: tierSettings
        ? `${formatPrice(tierSettings.promotedPriceCents, tierSettings.promotedCurrency)} for ${tierSettings.promotedDurationDays} days`
        : "—",
      icon: Megaphone,
      available: promotedAvailable,
    },
    {
      id: "sponsored",
      title: "Sponsored",
      description:
        "Top placement plus active push to matching candidates' inboxes.",
      priceLabel: tierSettings
        ? `${formatPrice(tierSettings.sponsoredPriceCents, tierSettings.sponsoredCurrency)} for ${tierSettings.sponsoredDurationDays} days`
        : "—",
      icon: Star,
      available: sponsoredAvailable,
    },
  ];

  return (
    <div className="container px-4 py-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Briefcase className="w-8 h-8 text-primary" /> Post a New Role
        </h1>
        <p className="text-muted-foreground mt-2">
          Posting is always free. Upgrade to Promoted or Sponsored to reach
          more candidates faster.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-6 md:p-8">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-8"
            >
              {/* Skill-challenge step: candidates take a server-graded
                  multiple-choice quiz built from the job's skills
                  instead of writing a cover note. We surface this as
                  a single high-signal toggle so the post-job flow
                  stays one page. The actual question set is
                  customisable later from the job-management screen
                  via PUT /jobs/:id/challenge. */}
              <div className="rounded-xl border bg-muted/30 p-4 flex items-start gap-4" data-testid="section-include-challenge">
                <Switch
                  checked={includeChallenge}
                  onCheckedChange={setIncludeChallenge}
                  data-testid="switch-include-challenge"
                />
                <div className="flex-1">
                  <div className="font-semibold flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" /> Add a skill challenge
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Replaces the cover note with a short quiz built from
                    your job's skills. Each candidate gets a 0–100 score
                    you can sort the pipeline by.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold border-b pb-2">
                  Basic Details
                </h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Job Title</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. Senior Frontend Engineer"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Job Type</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="full_time">Full Time</SelectItem>
                            <SelectItem value="part_time">Part Time</SelectItem>
                            <SelectItem value="contract">Contract</SelectItem>
                            <SelectItem value="internship">
                              Internship
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {field.value === "internship" ? (
                          <div
                            className="mt-2 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
                            data-testid="text-internship-free-notice"
                          >
                            <GraduationCap className="h-3.5 w-3.5 shrink-0" />
                            <span>
                              Internships are always free to post.
                            </span>
                          </div>
                        ) : null}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. San Francisco, CA"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="remote"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm md:col-span-2">
                        <div className="space-y-0.5">
                          <FormLabel>Remote Role</FormLabel>
                          <CardDescription>
                            Is this position fully remote?
                          </CardDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="salaryMin"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Minimum Salary</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="e.g. 80000"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="salaryMax"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Maximum Salary</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="e.g. 120000"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="skills"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Required Skills</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="React, TypeScript, Node.js (comma separated)"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="space-y-4 pt-4">
                <h3 className="text-lg font-semibold border-b pb-2">
                  Description & Details
                </h3>
                <FormField
                  control={form.control}
                  name="summary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Short Summary</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="A 1-2 sentence hook for the role..."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full Description</FormLabel>
                      <FormControl>
                        <Textarea
                          className="min-h-[150px]"
                          placeholder="Tell candidates about the role and team..."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="responsibilities"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Responsibilities (One per line)</FormLabel>
                      <FormControl>
                        <Textarea
                          className="min-h-[100px]"
                          placeholder="Build scalable UIs..."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="requirements"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Requirements (One per line)</FormLabel>
                      <FormControl>
                        <Textarea
                          className="min-h-[100px]"
                          placeholder="3+ years experience with React..."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="benefits"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Benefits (One per line)</FormLabel>
                      <FormControl>
                        <Textarea
                          className="min-h-[100px]"
                          placeholder="Health insurance..."
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-4 pt-4">
                <h3 className="text-lg font-semibold border-b pb-2 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Visibility
                </h3>
                <p className="text-sm text-muted-foreground">
                  Choose how prominently this role should appear. You can also
                  upgrade later from your dashboard.
                </p>
                <div className="grid md:grid-cols-3 gap-3">
                  {tierCards.map((t) => {
                    const Icon = t.icon;
                    const isSelected = tier === t.id;
                    const disabled = !t.available;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => !disabled && setTier(t.id)}
                        data-testid={`tier-card-${t.id}`}
                        className={`text-left rounded-lg border p-4 transition-all ${
                          isSelected
                            ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                            : "hover:border-primary/40"
                        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className="w-4 h-4 text-primary" />
                          <span className="font-semibold">{t.title}</span>
                        </div>
                        <div className="text-sm font-medium mb-1">
                          {t.priceLabel}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t.description}
                        </p>
                        {disabled ? (
                          <p className="text-[11px] mt-2 text-muted-foreground">
                            Currently unavailable.
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end pt-6 border-t">
                <Button
                  type="submit"
                  size="lg"
                  className="w-full md:w-auto"
                  disabled={
                    submitting || createJob.isPending || checkout.isPending
                  }
                  data-testid="button-submit-job"
                >
                  {submitting || createJob.isPending || checkout.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {tier === "free" ? "Posting..." : "Redirecting to checkout..."}
                    </>
                  ) : tier === "free" ? (
                    "Post Job"
                  ) : (
                    `Post & Pay (${tier === "promoted" ? "Promoted" : "Sponsored"})`
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
