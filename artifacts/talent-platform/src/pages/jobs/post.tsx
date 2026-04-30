import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateJob, getListJobsQueryKey, getGetEmployerDashboardQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Briefcase } from "lucide-react";

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

export default function JobPost() {
  const { userId, role } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createJob = useCreateJob();
  
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
    return <div className="container py-20 text-center text-muted-foreground">You must be viewing as an employer to post a job.</div>;
  }

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    if (!userId) return;

    const payload = {
      ...values,
      employerId: userId,
      responsibilities: values.responsibilities.split('\n').filter(r => r.trim() !== ''),
      requirements: values.requirements.split('\n').filter(r => r.trim() !== ''),
      benefits: values.benefits.split('\n').filter(r => r.trim() !== ''),
      skills: values.skills.split(',').map(s => s.trim()).filter(s => s !== ''),
    };

    createJob.mutate({ data: payload as any }, {
      onSuccess: () => {
        toast.success("Job posted successfully!");
        queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetEmployerDashboardQueryKey(userId) });
        setLocation("/dashboard/employer");
      },
      onError: (err: any) => {
        // The API returns 402 + a structured paywall payload when the
        // employer has used their free job-post quota. Surface a clear
        // message and route them to the subscription page.
        const status = err?.response?.status ?? err?.status;
        if (status === 402) {
          toast.error("You've used your free job posts. Subscribe to keep posting.");
          setLocation("/dashboard/employer/subscription");
          return;
        }
        toast.error("Failed to post job. Please check your inputs.");
      }
    });
  };

  return (
    <div className="container px-4 py-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Briefcase className="w-8 h-8 text-primary" /> Post a New Role
        </h1>
        <p className="text-muted-foreground mt-2">Fill out the details below to attract top talent.</p>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-6 md:p-8">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              
              <div className="space-y-4">
                <h3 className="text-lg font-semibold border-b pb-2">Basic Details</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <FormField control={form.control} name="title" render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Job Title</FormLabel>
                      <FormControl><Input placeholder="e.g. Senior Frontend Engineer" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="type" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Job Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="full_time">Full Time</SelectItem>
                          <SelectItem value="part_time">Part Time</SelectItem>
                          <SelectItem value="contract">Contract</SelectItem>
                          <SelectItem value="internship">Internship</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="location" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl><Input placeholder="e.g. San Francisco, CA" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="remote" render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm md:col-span-2">
                      <div className="space-y-0.5">
                        <FormLabel>Remote Role</FormLabel>
                        <CardDescription>Is this position fully remote?</CardDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="salaryMin" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum Salary</FormLabel>
                      <FormControl><Input type="number" placeholder="e.g. 80000" {...field} value={field.value || ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="salaryMax" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Maximum Salary</FormLabel>
                      <FormControl><Input type="number" placeholder="e.g. 120000" {...field} value={field.value || ''} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="skills" render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Required Skills</FormLabel>
                      <FormControl><Input placeholder="React, TypeScript, Node.js (comma separated)" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>

              <div className="space-y-4 pt-4">
                <h3 className="text-lg font-semibold border-b pb-2">Description & Details</h3>
                <FormField control={form.control} name="summary" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Short Summary</FormLabel>
                    <FormControl><Textarea placeholder="A 1-2 sentence hook for the role..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Description</FormLabel>
                    <FormControl><Textarea className="min-h-[150px]" placeholder="Tell candidates about the role and team..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="responsibilities" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Responsibilities (One per line)</FormLabel>
                    <FormControl><Textarea className="min-h-[100px]" placeholder="Build scalable UIs...&#10;Collaborate with product..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="requirements" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Requirements (One per line)</FormLabel>
                    <FormControl><Textarea className="min-h-[100px]" placeholder="3+ years experience with React...&#10;Strong communication skills..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="benefits" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Benefits (One per line)</FormLabel>
                    <FormControl><Textarea className="min-h-[100px]" placeholder="Health insurance...&#10;Flexible PTO..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="flex justify-end pt-6 border-t">
                <Button type="submit" size="lg" className="w-full md:w-auto" disabled={createJob.isPending}>
                  {createJob.isPending ? "Posting..." : "Post Job"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
