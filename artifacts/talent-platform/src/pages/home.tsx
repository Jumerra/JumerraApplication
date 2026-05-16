import { useMemo } from "react";
import { useListJobs, useGetSalaryInsights, useGetPlatformStats, useGetSiteContent } from "@workspace/api-client-react";
import { PartnersMarquee } from "@/components/partners-marquee";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Building2, GraduationCap, MapPin, Sparkles, TrendingUp, UserCircle2, CheckCircle2, Briefcase } from "lucide-react";
import { motion, type Variants } from "framer-motion";
import { StudentStoriesPanel } from "@/components/student-stories-panel";

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

export default function Home() {
  const { data: featuredJobs, isLoading: isLoadingJobs } = useListJobs({ featured: true });
  const { data: insights, isLoading: isLoadingInsights } = useGetSalaryInsights();
  const { data: stats } = useGetPlatformStats();
  const { data: site } = useGetSiteContent();

  const content = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of site?.items ?? []) map.set(item.key, item.value);
    return (key: string, fallback: string) => map.get(key) ?? fallback;
  }, [site]);

  // Sanitize image URLs from the CMS — only allow http(s) or relative paths.
  // Blocks javascript:/vbscript:/etc and rejects data: URIs entirely
  // (data:image/svg+xml can carry inline scripts, so the whole scheme is denied).
  const safeImage = (raw: string, fallback: string): string => {
    const v = raw.trim();
    if (!v) return fallback;
    if (v.startsWith("/") || v.startsWith("./") || v.startsWith("../")) return v;
    if (/^https?:\/\//i.test(v)) return v;
    return fallback;
  };
  const heroImage = safeImage(content("home.hero.image", "/hero.png"), "/hero.png");

  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="relative py-20 lg:py-32 overflow-hidden bg-primary/5">
        <div className="absolute inset-0 z-0">
          <img src={heroImage} alt="Career Growth" className="w-full h-full object-cover opacity-20 mix-blend-overlay" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 to-background" />
        </div>
        <div className="container relative z-10 px-4 md:px-6">
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="max-w-4xl mx-auto text-center space-y-8"
          >
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-foreground leading-[1.1]">
              {content("home.hero.headline_main", "The smart talent ecosystem for the")} <span className="text-primary bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">{content("home.hero.headline_highlight", "next generation")}</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              {content(
                "home.hero.subhead",
                "Connect with internships, remote jobs, and full-time roles. Powered by AI matching to help you land where you belong faster.",
              )}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Button asChild size="lg" className="h-12 px-8 text-base shadow-lg shadow-primary/20">
                <Link href="/jobs">{content("home.hero.cta_primary", "Find work")}</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-8 text-base bg-background/50 backdrop-blur">
                <Link href="/employers">{content("home.hero.cta_secondary", "Hire talent")}</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Trust Band */}
      {stats && (
        <section className="py-8 border-y bg-muted/30">
          <div className="container px-4 md:px-6">
            <div className="flex flex-wrap justify-center gap-8 md:gap-16 text-center">
              <div>
                <p className="text-3xl font-bold text-foreground">{stats.totalCandidates.toLocaleString()}+</p>
                <p className="text-sm font-medium text-muted-foreground">Active Candidates</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-foreground">{stats.totalEmployers.toLocaleString()}+</p>
                <p className="text-sm font-medium text-muted-foreground">Top Employers</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-foreground">{stats.totalHires.toLocaleString()}+</p>
                <p className="text-sm font-medium text-muted-foreground">Successful Hires</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* How AI Matching Works */}
      <section className="py-24 bg-background">
        <div className="container px-4 md:px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold mb-4">{content("home.howit.title", "How AI matching works")}</h2>
            <p className="text-muted-foreground text-lg">{content(
              "home.howit.subtitle",
              "We analyze skills, experience, and potential to create perfect pairings between talent and opportunity.",
            )}</p>
          </div>
          
          <motion.div 
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            className="grid md:grid-cols-3 gap-8 relative"
          >
            <div className="hidden md:block absolute top-1/2 left-[15%] right-[15%] h-0.5 bg-gradient-to-r from-primary/10 via-primary/40 to-primary/10 -translate-y-1/2 z-0" />
            
            <motion.div variants={item} className="relative z-10 bg-background rounded-2xl p-6 text-center border shadow-sm">
              <div className="w-16 h-16 mx-auto bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-6 -mt-12 border-4 border-background">
                <UserCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-2">{content("home.howit.step1_title", "1. Build your profile")}</h3>
              <p className="text-muted-foreground">{content(
                "home.howit.step1_desc",
                "Showcase your skills, education, and experience to build a comprehensive talent graph.",
              )}</p>
            </motion.div>
            
            <motion.div variants={item} className="relative z-10 bg-background rounded-2xl p-6 text-center border shadow-sm">
              <div className="w-16 h-16 mx-auto bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-6 -mt-12 border-4 border-background">
                <Sparkles className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-2">{content("home.howit.step2_title", "2. Get matched")}</h3>
              <p className="text-muted-foreground">{content(
                "home.howit.step2_desc",
                "Our AI instantly pairs you with roles that fit your unique profile and career goals.",
              )}</p>
            </motion.div>
            
            <motion.div variants={item} className="relative z-10 bg-background rounded-2xl p-6 text-center border shadow-sm">
              <div className="w-16 h-16 mx-auto bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-6 -mt-12 border-4 border-background">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-2">{content("home.howit.step3_title", "3. Land the job")}</h3>
              <p className="text-muted-foreground">{content(
                "home.howit.step3_desc",
                "Apply with one click, track your pipeline, and get hired faster than ever before.",
              )}</p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Stats/Audiences Section */}
      <section className="py-24 bg-muted/20 border-y">
        <div className="container px-4 md:px-6">
          <motion.div 
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid md:grid-cols-3 gap-8"
          >
            <motion.div variants={item}>
              <Card className="h-full border-none shadow-md hover:shadow-xl transition-shadow bg-card hover:-translate-y-1 duration-300">
                <CardContent className="p-8 text-center space-y-4">
                  <div className="mx-auto w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-6">
                    <UserCircle2 className="w-8 h-8" />
                  </div>
                  <h3 className="text-2xl font-bold">{content("home.aud.candidates_title", "Candidates")}</h3>
                  <p className="text-muted-foreground">{content(
                    "home.aud.candidates_desc",
                    "Discover roles that match your skills, build your profile, and fast-track your career with AI recommendations.",
                  )}</p>
                  <Button asChild variant="link" className="mt-4">
                    <Link href="/dashboard/candidate">View Candidate Dashboard <ArrowRight className="w-4 h-4 ml-2" /></Link>
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
            
            <motion.div variants={item}>
              <Card className="h-full border-none shadow-md hover:shadow-xl transition-shadow bg-card hover:-translate-y-1 duration-300">
                <CardContent className="p-8 text-center space-y-4">
                  <div className="mx-auto w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-6">
                    <Building2 className="w-8 h-8" />
                  </div>
                  <h3 className="text-2xl font-bold">{content("home.aud.employers_title", "Employers")}</h3>
                  <p className="text-muted-foreground">{content(
                    "home.aud.employers_desc",
                    "Post opportunities, instantly see matched talent, and streamline your hiring pipeline from application to offer.",
                  )}</p>
                  <Button asChild variant="link" className="mt-4">
                    <Link href="/dashboard/employer">View Employer Dashboard <ArrowRight className="w-4 h-4 ml-2" /></Link>
                  </Button>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={item}>
              <Card className="h-full border-none shadow-md hover:shadow-xl transition-shadow bg-card hover:-translate-y-1 duration-300">
                <CardContent className="p-8 text-center space-y-4">
                  <div className="mx-auto w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-6">
                    <GraduationCap className="w-8 h-8" />
                  </div>
                  <h3 className="text-2xl font-bold">{content("home.aud.institutions_title", "Institutions")}</h3>
                  <p className="text-muted-foreground">{content(
                    "home.aud.institutions_desc",
                    "Track student placements in real-time, monitor readiness scores, and partner with top employers.",
                  )}</p>
                  <Button asChild variant="link" className="mt-4">
                    <Link href="/dashboard/institution">Track your students <ArrowRight className="w-4 h-4 ml-2" /></Link>
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Featured Jobs */}
      <section className="py-24 bg-background">
        <div className="container px-4 md:px-6">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2 className="text-3xl font-bold flex items-center gap-2">
                <Briefcase className="w-6 h-6 text-primary" />
                Featured Opportunities
              </h2>
              <p className="text-muted-foreground mt-2 text-lg">Hand-picked roles tailored for early-career professionals.</p>
            </div>
            <Button asChild variant="ghost" className="hidden sm:flex">
              <Link href="/jobs">View all jobs <ArrowRight className="w-4 h-4 ml-2" /></Link>
            </Button>
          </div>

          {isLoadingJobs ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <Card key={i} className="h-[200px] animate-pulse bg-muted" />
              ))}
            </div>
          ) : (
            <motion.div 
              variants={container}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="grid md:grid-cols-2 lg:grid-cols-3 gap-6"
            >
              {featuredJobs?.slice(0, 6).map(job => (
                <motion.div key={job.id} variants={item}>
                  <Card className="h-full group hover:border-primary/50 transition-colors cursor-pointer hover:shadow-md" onClick={() => window.location.href = `/jobs/${job.id}`}>
                    <CardContent className="p-6 flex flex-col h-full">
                      <div className="flex gap-4 items-start mb-4">
                        <img src={job.employerLogoUrl} alt={job.employerName} className="w-12 h-12 rounded-lg object-cover bg-muted border" />
                        <div>
                          <h3 className="font-semibold line-clamp-1 group-hover:text-primary transition-colors">{job.title}</h3>
                          <p className="text-sm text-muted-foreground">{job.employerName}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mb-4">
                        <Badge variant="secondary" className="capitalize">{job.type.replace('_', ' ')}</Badge>
                        <Badge variant="outline" className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {job.remote ? 'Remote' : job.location}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-auto">{job.summary}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </motion.div>
          )}
          
          <div className="mt-8 text-center sm:hidden">
            <Button asChild variant="outline" className="w-full">
              <Link href="/jobs">View all jobs <ArrowRight className="w-4 h-4 ml-2" /></Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Market Insights */}
      <section className="py-24 bg-muted/30 border-t">
        <div className="container px-4 md:px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold flex items-center gap-2 mb-8">
              <TrendingUp className="w-6 h-6 text-primary" />
              Market Insights
            </h2>
            {isLoadingInsights ? (
              <div className="grid sm:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map(i => <div key={i} className="h-20 animate-pulse bg-muted rounded-xl" />)}
              </div>
            ) : (
              <motion.div 
                variants={container}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true }}
                className="grid sm:grid-cols-2 gap-4"
              >
                {insights?.slice(0, 4).map((insight, i) => (
                  <motion.div key={i} variants={item} className="flex items-center justify-between p-5 rounded-xl border bg-card hover:shadow-md transition-shadow">
                    <div>
                      <p className="font-semibold text-lg">{insight.role}</p>
                      <p className="text-sm text-muted-foreground">Based on {insight.sampleSize.toLocaleString()} roles</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-xl text-green-600 dark:text-green-500">
                        {insight.currency} {(insight.averageSalary / 1000).toFixed(0)}k
                      </p>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Average</p>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </div>
        </div>
      </section>

      {/* Student Stories — admin-moderated spotlights of recent placements */}
      <StudentStoriesPanel />

      {/* Our Partners (admin-managed; renders only when enabled and non-empty) */}
      <PartnersMarquee />
    </div>
  );
}
