import { useGetJob, useCreateApplication, getListApplicationsQueryKey, getGetCandidateDashboardQueryKey, getGetJobQueryKey } from "@workspace/api-client-react";
import { Link, useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, MapPin, Banknote } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const formSchema = z.object({
  coverNote: z.string().min(30, "Your cover note must be at least 30 characters long to make a good impression."),
});

export default function JobApply() {
  const { jobId } = useParams();
  const { userId, role } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: job, isLoading } = useGetJob(Number(jobId));
  const applyMutation = useCreateApplication();
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { coverNote: "" },
  });

  if (role !== "candidate") {
    return <div className="container py-20 text-center text-muted-foreground">You must view as a Candidate to apply for jobs.</div>;
  }

  if (isLoading) {
    return <div className="container py-12 px-4"><div className="animate-pulse h-64 bg-muted rounded-2xl" /></div>;
  }

  if (!job) return null;

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    if (!userId) return;

    applyMutation.mutate({
      data: {
        jobId: Number(jobId),
        candidateId: userId,
        coverNote: values.coverNote
      }
    }, {
      onSuccess: () => {
        toast.success("Application submitted successfully!");
        queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCandidateDashboardQueryKey(userId) });
        queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(Number(jobId)) });
        setLocation("/dashboard/candidate");
      },
      onError: () => {
        toast.error("Failed to submit application. Have you already applied?");
      }
    });
  };

  return (
    <div className="container px-4 py-8 max-w-3xl mx-auto">
      <Button variant="ghost" asChild className="mb-6 -ml-4 text-muted-foreground hover:text-foreground">
        <Link href={`/jobs/${job.id}`}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to job
        </Link>
      </Button>

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Apply for Role</h1>
        <p className="text-muted-foreground">Submit your application to {job.employerName}</p>
      </div>

      <Card className="mb-8 border-primary/20 bg-primary/5 shadow-sm">
        <CardContent className="p-6 flex flex-col md:flex-row gap-6 items-start">
          <img src={job.employerLogoUrl} alt="" className="w-16 h-16 rounded-xl object-cover border bg-background" />
          <div>
            <h2 className="text-xl font-bold mb-1">{job.title}</h2>
            <p className="text-muted-foreground mb-3">{job.employerName}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="capitalize bg-background">{job.type.replace('_', ' ')}</Badge>
              <Badge variant="outline" className="flex items-center gap-1 bg-background">
                <MapPin className="w-3 h-3" /> {job.remote ? 'Remote' : job.location}
              </Badge>
              {job.salaryMin && (
                <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 border-green-200">
                  <Banknote className="w-3 h-3 mr-1" />
                  {job.currency} {(job.salaryMin/1000).toFixed(0)}k - {(job.salaryMax!/1000).toFixed(0)}k
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-6 md:p-8">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField control={form.control} name="coverNote" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base font-semibold">Cover Note</FormLabel>
                  <p className="text-sm text-muted-foreground mb-4">
                    Why are you a great fit for this role? What makes you excited about {job.employerName}?
                  </p>
                  <FormControl>
                    <Textarea 
                      className="min-h-[250px] resize-y" 
                      placeholder="I'm excited to apply for this role because..." 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              
              <div className="pt-4 border-t flex justify-end">
                <Button type="submit" size="lg" className="w-full md:w-auto" disabled={applyMutation.isPending}>
                  {applyMutation.isPending ? "Submitting..." : "Submit Application"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
