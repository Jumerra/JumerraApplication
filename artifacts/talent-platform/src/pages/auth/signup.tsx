import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useRegisterUser } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PasswordInput } from "@/components/ui/password-input";
import { UserPlus, AlertCircle, CheckCircle2, GraduationCap, Briefcase, UserCircle2 } from "lucide-react";

type RoleTab = "candidate" | "employer" | "institution";

export default function SignupPage() {
  const [, setLocation] = useLocation();
  const register = useRegisterUser();
  const [role, setRole] = useState<RoleTab>("candidate");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Shared
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  // Candidate
  const [headline, setHeadline] = useState("");
  const [location, setLocationField] = useState("");
  const [bio, setBio] = useState("");

  // Employer
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("Technology");
  const [tagline, setTagline] = useState("");

  // Institution
  const [institutionName, setInstitutionName] = useState("");
  const [institutionType, setInstitutionType] = useState("university");
  const [websiteUrl, setWebsiteUrl] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    let submittedData: Record<string, unknown> = {};
    let displayName = fullName;
    if (role === "candidate") {
      submittedData = { headline, location, bio };
    } else if (role === "employer") {
      submittedData = { companyName, industry, tagline, location };
      if (!companyName) {
        setError("Company name is required");
        return;
      }
      displayName = fullName || companyName;
    } else {
      submittedData = {
        institutionName,
        type: institutionType,
        websiteUrl,
        location,
      };
      if (!institutionName) {
        setError("Institution name is required");
        return;
      }
      displayName = fullName || institutionName;
    }

    try {
      const result = await register.mutateAsync({
        data: {
          email,
          password,
          fullName: displayName,
          role,
          submittedData,
        },
      });
      setSuccessMessage(result.message);
    } catch (err: any) {
      setError(err?.data?.error ?? "Registration failed");
    }
  }

  if (successMessage) {
    return (
      <div className="container max-w-md py-16 px-4">
        <Card className="shadow-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-3">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <CardTitle className="text-2xl">Application received</CardTitle>
            <CardDescription>{successMessage}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground text-center mb-6">
              You will be able to log in once an administrator approves your account.
            </p>
            <Button className="w-full" onClick={() => setLocation("/login")}>
              Go to login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-12 px-4">
      <Card className="shadow-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-3">
            <UserPlus className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl">Join TalentLink</CardTitle>
          <CardDescription>
            Create an account. An administrator will review your application
            before activating it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={role} onValueChange={(v) => setRole(v as RoleTab)} className="mb-6">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="candidate" className="gap-2">
                <UserCircle2 className="w-4 h-4" /> Candidate
              </TabsTrigger>
              <TabsTrigger value="employer" className="gap-2">
                <Briefcase className="w-4 h-4" /> Employer
              </TabsTrigger>
              <TabsTrigger value="institution" className="gap-2">
                <GraduationCap className="w-4 h-4" /> Institution
              </TabsTrigger>
            </TabsList>
            <form onSubmit={onSubmit} className="space-y-4 mt-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <PasswordInput
                    id="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <TabsContent value="candidate" className="space-y-4 m-0">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full name</Label>
                  <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="headline">Headline</Label>
                  <Input id="headline" placeholder="Full-stack engineer · graduating 2026" value={headline} onChange={(e) => setHeadline(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input id="location" placeholder="Boston, MA" value={location} onChange={(e) => setLocationField(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bio">Bio</Label>
                  <Textarea id="bio" rows={3} placeholder="Tell us a bit about yourself…" value={bio} onChange={(e) => setBio(e.target.value)} />
                </div>
              </TabsContent>
              <TabsContent value="employer" className="space-y-4 m-0">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="contactName">Your name</Label>
                    <Input id="contactName" placeholder="Hiring manager full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="companyName">Company name</Label>
                    <Input id="companyName" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="industry">Industry</Label>
                    <Input id="industry" value={industry} onChange={(e) => setIndustry(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="empLocation">HQ location</Label>
                    <Input id="empLocation" value={location} onChange={(e) => setLocationField(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tagline">Tagline</Label>
                  <Input id="tagline" placeholder="What does your company do?" value={tagline} onChange={(e) => setTagline(e.target.value)} />
                </div>
              </TabsContent>
              <TabsContent value="institution" className="space-y-4 m-0">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="repName">Your name</Label>
                    <Input id="repName" placeholder="Career services contact" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="institutionName">Institution name</Label>
                    <Input id="institutionName" required value={institutionName} onChange={(e) => setInstitutionName(e.target.value)} />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="institutionType">Type</Label>
                    <Select value={institutionType} onValueChange={setInstitutionType}>
                      <SelectTrigger id="institutionType">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="university">University</SelectItem>
                        <SelectItem value="college">College</SelectItem>
                        <SelectItem value="bootcamp">Bootcamp</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="instLocation">Location</Label>
                    <Input id="instLocation" value={location} onChange={(e) => setLocationField(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="websiteUrl">Website</Label>
                  <Input id="websiteUrl" type="url" placeholder="https://…" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
                </div>
              </TabsContent>
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={register.isPending}>
                {register.isPending ? "Submitting…" : "Submit application"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="text-primary font-medium hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
