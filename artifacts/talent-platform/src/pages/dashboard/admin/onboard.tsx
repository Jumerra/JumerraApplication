import { useState } from "react";
import { Link } from "wouter";
import {
  useOnboardEntity,
  useListOnboardedUsers,
  getListOnboardedUsersQueryKey,
  type OnboardResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ShieldAlert,
  Briefcase,
  GraduationCap,
  Mail,
  Copy,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

type OnboardRole = "institution" | "employer";

export default function AdminOnboardPage() {
  const { sessionUser } = useAuth();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<OnboardRole>("institution");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("university");
  const [industry, setIndustry] = useState("Technology");
  const [location, setLocation] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const onboard = useOnboardEntity();
  const { data: invitedData } = useListOnboardedUsers({
    query: { enabled: sessionUser?.role === "admin" },
  });

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const entity =
        role === "institution"
          ? { name, type, location, websiteUrl }
          : { name, industry, location, websiteUrl };
      const res = await onboard.mutateAsync({
        data: { role, email, fullName, entity },
      });
      setResult(res);
      await queryClient.invalidateQueries({ queryKey: getListOnboardedUsersQueryKey() });
      setEmail("");
      setFullName("");
      setName("");
      setLocation("");
      setWebsiteUrl("");
    } catch (err: any) {
      setError(err?.data?.error ?? "Onboarding failed");
    }
  }

  function copyLink(url: string) {
    const absolute = `${window.location.origin}${url}`;
    navigator.clipboard.writeText(absolute);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const invited = invitedData?.users ?? [];

  return (
    <div className="container px-4 py-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-destructive/10 border-2 border-destructive/20 flex items-center justify-center text-destructive">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Onboard a partner</h1>
          <p className="text-muted-foreground text-sm">
            Create an institution or employer account directly. They will receive a one-time link to set their password.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/admin/registrations">Back to applications</Link>
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>New partner</CardTitle>
          <CardDescription>Choose a role and fill in their details.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={role} onValueChange={(v) => setRole(v as OnboardRole)} className="mb-6">
            <TabsList className="grid grid-cols-2 w-full max-w-sm">
              <TabsTrigger value="institution" className="gap-2">
                <GraduationCap className="w-4 h-4" /> Institution
              </TabsTrigger>
              <TabsTrigger value="employer" className="gap-2">
                <Briefcase className="w-4 h-4" /> Employer
              </TabsTrigger>
            </TabsList>
            <form onSubmit={onSubmit} className="space-y-4 mt-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ob-fullName">Primary contact name</Label>
                  <Input id="ob-fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-email">Contact email</Label>
                  <Input id="ob-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>
              <TabsContent value="institution" className="space-y-4 m-0">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ob-instName">Institution name</Label>
                    <Input id="ob-instName" required value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ob-instType">Type</Label>
                    <Select value={type} onValueChange={setType}>
                      <SelectTrigger id="ob-instType"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="university">University</SelectItem>
                        <SelectItem value="college">College</SelectItem>
                        <SelectItem value="bootcamp">Bootcamp</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="employer" className="space-y-4 m-0">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ob-empName">Company name</Label>
                    <Input id="ob-empName" required value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ob-industry">Industry</Label>
                    <Input id="ob-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} />
                  </div>
                </div>
              </TabsContent>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ob-location">Location</Label>
                  <Input id="ob-location" value={location} onChange={(e) => setLocation(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-website">Website</Label>
                  <Input id="ob-website" type="url" placeholder="https://…" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
                </div>
              </div>
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Button type="submit" disabled={onboard.isPending}>
                <Mail className="w-4 h-4 mr-2" />
                {onboard.isPending ? "Creating…" : "Create account & generate setup link"}
              </Button>
            </form>
          </Tabs>
        </CardContent>
      </Card>

      {result && (
        <Card className="shadow-sm border-emerald-200 bg-emerald-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-emerald-900">
              <CheckCircle2 className="w-5 h-5" /> Account created
            </CardTitle>
            <CardDescription className="text-emerald-900/80">
              Share this one-time setup link with{" "}
              <span className="font-semibold">{result.user.fullName}</span> ({result.user.email}).
              Link expires {new Date(result.expiresAt).toLocaleString()}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                readOnly
                value={`${window.location.origin}${result.setupUrl}`}
                className="font-mono text-xs bg-white"
              />
              <Button
                variant="outline"
                onClick={() => copyLink(result.setupUrl)}
                className="shrink-0"
              >
                <Copy className="w-4 h-4 mr-1" />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-emerald-900/70 mt-2">
              Tip: send this link via your normal email tool. Once an email integration is connected, the platform will email it automatically.
            </p>
          </CardContent>
        </Card>
      )}

      {invited.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Awaiting password setup</CardTitle>
            <CardDescription>
              Onboarded users who have not yet set a password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {invited.map((u) => (
                <li key={u.id} className="py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    {u.role === "institution" ? (
                      <GraduationCap className="w-4 h-4" />
                    ) : (
                      <Briefcase className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Invited {new Date(u.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
