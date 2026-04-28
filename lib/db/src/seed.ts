import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  db,
  pool,
  institutionsTable,
  employersTable,
  candidatesTable,
  candidateInstitutionsTable,
  educationTable,
  experienceTable,
  certificationsTable,
  badgesTable,
  jobsTable,
  applicationsTable,
  skillsTable,
  usersTable,
  pendingRegistrationsTable,
  passwordSetupTokensTable,
} from "./index";

async function clear() {
  await db.execute(sql`TRUNCATE TABLE
    applications,
    badges,
    certifications,
    experience_entries,
    education_entries,
    candidate_institutions,
    jobs,
    candidates,
    employers,
    institutions,
    skills,
    password_setup_tokens,
    pending_registrations,
    users
    RESTART IDENTITY CASCADE`);
}

async function main() {
  console.log("Clearing tables…");
  await clear();

  console.log("Seeding skills…");
  await db.insert(skillsTable).values([
    { name: "TypeScript", category: "Programming" },
    { name: "JavaScript", category: "Programming" },
    { name: "Python", category: "Programming" },
    { name: "Go", category: "Programming" },
    { name: "Rust", category: "Programming" },
    { name: "SQL", category: "Programming" },
    { name: "React", category: "Frontend" },
    { name: "Next.js", category: "Frontend" },
    { name: "Vue", category: "Frontend" },
    { name: "Tailwind CSS", category: "Frontend" },
    { name: "Node.js", category: "Backend" },
    { name: "Express", category: "Backend" },
    { name: "PostgreSQL", category: "Backend" },
    { name: "MongoDB", category: "Backend" },
    { name: "GraphQL", category: "Backend" },
    { name: "AWS", category: "Cloud" },
    { name: "GCP", category: "Cloud" },
    { name: "Docker", category: "Cloud" },
    { name: "Kubernetes", category: "Cloud" },
    { name: "Terraform", category: "Cloud" },
    { name: "Figma", category: "Design" },
    { name: "UI Design", category: "Design" },
    { name: "UX Research", category: "Design" },
    { name: "Product Strategy", category: "Product" },
    { name: "Agile", category: "Product" },
    { name: "Data Analysis", category: "Data" },
    { name: "Machine Learning", category: "Data" },
    { name: "TensorFlow", category: "Data" },
    { name: "PyTorch", category: "Data" },
    { name: "Pandas", category: "Data" },
    { name: "Communication", category: "Soft Skills" },
    { name: "Leadership", category: "Soft Skills" },
  ]);

  console.log("Seeding institutions…");
  const institutions = await db.insert(institutionsTable).values([
    {
      name: "Northstar University",
      type: "university",
      location: "Boston, MA",
      logoUrl: "https://api.dicebear.com/7.x/initials/svg?seed=Northstar&backgroundColor=0f766e&fontFamily=serif",
      websiteUrl: "https://northstar.edu",
      description: "A leading research university known for engineering, business, and design programs that shape the next generation of builders.",
    },
    {
      name: "Pacific Coast College",
      type: "college",
      location: "San Francisco, CA",
      logoUrl: "https://api.dicebear.com/7.x/initials/svg?seed=Pacific&backgroundColor=4338ca",
      websiteUrl: "https://pacificcoast.edu",
      description: "A liberal arts college with a strong CS and product design focus, located in the heart of the Bay Area.",
    },
    {
      name: "Apex Bootcamp",
      type: "bootcamp",
      location: "Remote",
      logoUrl: "https://api.dicebear.com/7.x/initials/svg?seed=Apex&backgroundColor=ea580c",
      websiteUrl: "https://apexbootcamp.io",
      description: "An intensive 16-week immersive that turns career changers into shipping engineers and designers.",
    },
  ]).returning();

  console.log("Seeding employers…");
  const employers = await db.insert(employersTable).values([
    {
      name: "Lumen Labs",
      tagline: "Building the operating system for ambitious teams.",
      description: "Lumen Labs is a venture-backed productivity startup reimagining how distributed teams collaborate. We're a tight-knit team shipping AI-native tools used by 30,000+ teams worldwide.",
      industry: "Software",
      location: "San Francisco, CA",
      logoUrl: "https://api.dicebear.com/7.x/shapes/svg?seed=Lumen&backgroundColor=0f766e",
      coverUrl: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&h=600&fit=crop",
      websiteUrl: "https://lumenlabs.com",
      size: "startup",
      verified: true,
    },
    {
      name: "Northwind Aerospace",
      tagline: "Engineering the next era of flight.",
      description: "Northwind Aerospace designs and manufactures small-satellite propulsion systems. Our work has launched on more than 40 missions to low-earth orbit.",
      industry: "Aerospace",
      location: "Seattle, WA",
      logoUrl: "https://api.dicebear.com/7.x/shapes/svg?seed=Northwind&backgroundColor=1e40af",
      coverUrl: "https://images.unsplash.com/photo-1516849841032-87cbac4d88f7?w=1600&h=600&fit=crop",
      websiteUrl: "https://northwind-aero.com",
      size: "midsize",
      verified: true,
    },
    {
      name: "Verdant Health",
      tagline: "Personalized care, powered by data.",
      description: "Verdant Health partners with primary care clinics to bring AI-assisted diagnostics into everyday practice. We're building the platform that 50M patients deserve.",
      industry: "Healthcare",
      location: "New York, NY",
      logoUrl: "https://api.dicebear.com/7.x/shapes/svg?seed=Verdant&backgroundColor=15803d",
      coverUrl: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=1600&h=600&fit=crop",
      websiteUrl: "https://verdanthealth.io",
      size: "midsize",
      verified: true,
    },
    {
      name: "Atlas Studios",
      tagline: "Crafting digital products people love.",
      description: "Atlas is an independent design and engineering studio working with founders and brands to launch standout products.",
      industry: "Design Studio",
      location: "Brooklyn, NY",
      logoUrl: "https://api.dicebear.com/7.x/shapes/svg?seed=Atlas&backgroundColor=7c3aed",
      coverUrl: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=1600&h=600&fit=crop",
      websiteUrl: "https://atlasstudios.co",
      size: "small",
      verified: false,
    },
    {
      name: "Beacon Capital",
      tagline: "Capital and conviction for early-stage founders.",
      description: "Beacon Capital is a $200M seed-stage fund investing in technical founders building the picks and shovels of the AI era.",
      industry: "Venture Capital",
      location: "San Francisco, CA",
      logoUrl: "https://api.dicebear.com/7.x/shapes/svg?seed=Beacon&backgroundColor=b45309",
      coverUrl: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1600&h=600&fit=crop",
      websiteUrl: "https://beaconcapital.vc",
      size: "small",
      verified: true,
    },
  ]).returning();

  const inst = institutions;
  const emp = employers;

  console.log("Seeding candidates…");
  const candidates = await db.insert(candidatesTable).values([
    {
      fullName: "Maya Patel",
      headline: "Full-stack engineer · Northstar '25 · Building useful AI tools",
      bio: "Final-year CS student at Northstar University. I love shipping side projects, contributing to open source, and turning prototypes into products people actually use. Last summer I built an AI study planner that grew to 12k weekly users.",
      location: "Boston, MA",
      email: "maya.patel@example.com",
      phone: "+1 617 555 0142",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Maya",
      portfolioUrl: "https://maya.dev",
      availability: "open",
      yearsExperience: 2,
      talentScore: 92,
      isBoosted: true,
      institutionId: inst[0].id,
      skills: ["TypeScript", "React", "Next.js", "Node.js", "PostgreSQL", "Tailwind CSS", "Python", "Machine Learning"],
    },
    {
      fullName: "Jordan Reyes",
      headline: "Product designer with engineering chops",
      bio: "Designer-developer hybrid. I prototype in Figma, ship in React, and care deeply about accessibility. Looking for a senior IC role on a small product team.",
      location: "San Francisco, CA",
      email: "jordan.reyes@example.com",
      phone: "+1 415 555 0188",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Jordan",
      availability: "open",
      yearsExperience: 5,
      talentScore: 88,
      isBoosted: false,
      institutionId: inst[1].id,
      skills: ["Figma", "UI Design", "UX Research", "React", "TypeScript", "Tailwind CSS"],
    },
    {
      fullName: "Aiko Tanaka",
      headline: "ML engineer · Computer vision researcher",
      bio: "I build production ML systems. Previously at a robotics startup where I shipped a real-time defect detection pipeline. PyTorch is my love language.",
      location: "Seattle, WA",
      email: "aiko.tanaka@example.com",
      phone: "+1 206 555 0173",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Aiko",
      availability: "open",
      yearsExperience: 4,
      talentScore: 90,
      isBoosted: true,
      institutionId: inst[0].id,
      skills: ["Python", "PyTorch", "TensorFlow", "Machine Learning", "Pandas", "Docker", "AWS"],
    },
    {
      fullName: "Daniel Okafor",
      headline: "Backend engineer · Distributed systems · Apex grad",
      bio: "Career changer from finance to software. Apex bootcamp grad. I love taking on the unglamorous infra work nobody else wants and making it boring.",
      location: "Remote",
      email: "daniel.okafor@example.com",
      phone: "+1 312 555 0119",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Daniel",
      availability: "open",
      yearsExperience: 1,
      talentScore: 76,
      isBoosted: false,
      institutionId: inst[2].id,
      skills: ["Go", "PostgreSQL", "Docker", "Kubernetes", "AWS", "Terraform"],
    },
    {
      fullName: "Sara Chen",
      headline: "Data scientist · Healthcare focus",
      bio: "Pacific Coast '24. I want to use data to make healthcare more equitable. Comfortable across the stack from SQL to model deployment.",
      location: "San Francisco, CA",
      email: "sara.chen@example.com",
      phone: "+1 415 555 0166",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sara",
      availability: "open",
      yearsExperience: 1,
      talentScore: 78,
      isBoosted: false,
      institutionId: inst[1].id,
      skills: ["Python", "SQL", "Pandas", "Machine Learning", "Data Analysis"],
    },
    {
      fullName: "Liam O'Brien",
      headline: "Frontend engineer · Performance nerd",
      bio: "I love making fast, accessible web experiences. React, Vue, plain HTML — I'm tool-agnostic. Currently exploring senior frontend or staff frontend roles.",
      location: "New York, NY",
      email: "liam.obrien@example.com",
      phone: "+1 212 555 0101",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Liam",
      availability: "open",
      yearsExperience: 6,
      talentScore: 86,
      isBoosted: false,
      institutionId: inst[1].id,
      skills: ["TypeScript", "React", "Vue", "Next.js", "Tailwind CSS", "GraphQL"],
    },
    {
      fullName: "Priya Singh",
      headline: "Aerospace software engineer · Embedded systems",
      bio: "Working at the intersection of aerospace and software. C, Rust, and Python on tiny machines. Open to mission-driven hardware companies.",
      location: "Seattle, WA",
      email: "priya.singh@example.com",
      phone: "+1 206 555 0149",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Priya",
      availability: "open",
      yearsExperience: 3,
      talentScore: 84,
      isBoosted: false,
      institutionId: inst[0].id,
      skills: ["Rust", "Python", "Linux", "Embedded Systems"],
    },
    {
      fullName: "Marcus Thompson",
      headline: "Product manager · 0→1 builder",
      bio: "I've taken three products from idea to first customers. Comfortable in a spreadsheet, on a Figma file, and in a code review.",
      location: "Brooklyn, NY",
      email: "marcus.thompson@example.com",
      phone: "+1 718 555 0122",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Marcus",
      availability: "open",
      yearsExperience: 7,
      talentScore: 89,
      isBoosted: true,
      institutionId: inst[1].id,
      skills: ["Product Strategy", "Agile", "Data Analysis", "Communication", "Leadership"],
    },
    {
      fullName: "Ela Hartman",
      headline: "DevOps engineer · Cloud infrastructure",
      bio: "I build platforms that other engineers love using. Kubernetes, Terraform, CI/CD. The fewer pages, the better.",
      location: "Remote",
      email: "ela.hartman@example.com",
      phone: "+1 503 555 0177",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Ela",
      availability: "open",
      yearsExperience: 4,
      talentScore: 82,
      isBoosted: false,
      institutionId: inst[2].id,
      skills: ["Kubernetes", "Terraform", "AWS", "GCP", "Docker", "Go"],
    },
    {
      fullName: "Noah Kim",
      headline: "Designer · Brand and product systems",
      bio: "I help startups punch above their weight with confident brand systems and product UI. Recently led the rebrand of a Series A health startup.",
      location: "Los Angeles, CA",
      email: "noah.kim@example.com",
      phone: "+1 323 555 0156",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Noah",
      availability: "open",
      yearsExperience: 5,
      talentScore: 81,
      isBoosted: false,
      institutionId: inst[2].id,
      skills: ["Figma", "UI Design", "UX Research"],
    },
  ]).returning();

  // Many-to-many candidate ↔ institutions. Each candidate is linked
  // to their primary institution PLUS one or more additional ones for
  // candidates with mixed academic paths (transfer, bootcamp, etc.).
  // Institutions can see ALL their linked candidates on their dashboard,
  // not just the ones whose primary affiliation is them.
  console.log("Seeding candidate ↔ institution links…");
  const additionalLinks: Array<{ candidateIdx: number; institutionIdx: number }> = [
    // Maya Patel (Northstar grad) also took the Apex Engineering Bootcamp
    { candidateIdx: 0, institutionIdx: 2 },
    // Aiko Tanaka (Northstar M.S.) also a Pacific Coast undergrad transfer
    { candidateIdx: 2, institutionIdx: 1 },
    // Daniel Okafor (Apex bootcamp) also did Pacific Coast continuing ed
    { candidateIdx: 3, institutionIdx: 1 },
    // Marcus Thompson (Pacific Coast) also did Northstar executive program
    { candidateIdx: 7, institutionIdx: 0 },
    // Ela Hartman (Apex) also Northstar online certs
    { candidateIdx: 8, institutionIdx: 0 },
  ];
  const linkRows = [
    // primary affiliations (mirror candidates.institutionId)
    ...candidates
      .filter((c) => c.institutionId != null)
      .map((c) => ({
        candidateId: c.id,
        institutionId: c.institutionId as number,
        isPrimary: true,
      })),
    // additional affiliations (skip if already linked as primary)
    ...additionalLinks
      .filter(
        ({ candidateIdx, institutionIdx }) =>
          candidates[candidateIdx].institutionId !== inst[institutionIdx].id,
      )
      .map(({ candidateIdx, institutionIdx }) => ({
        candidateId: candidates[candidateIdx].id,
        institutionId: inst[institutionIdx].id,
        isPrimary: false,
      })),
  ];
  await db.insert(candidateInstitutionsTable).values(linkRows);

  // Detail data for first candidate (Maya, id=1)
  console.log("Seeding candidate detail (education / experience / certs / badges)…");
  await db.insert(educationTable).values([
    { candidateId: candidates[0].id, institution: "Northstar University", degree: "B.S.", fieldOfStudy: "Computer Science", startYear: 2021, endYear: 2025 },
    { candidateId: candidates[0].id, institution: "Northstar Online High", degree: "Diploma", fieldOfStudy: "STEM track", startYear: 2017, endYear: 2021 },
    { candidateId: candidates[1].id, institution: "Pacific Coast College", degree: "B.A.", fieldOfStudy: "Design + CS", startYear: 2017, endYear: 2021 },
    { candidateId: candidates[2].id, institution: "Northstar University", degree: "M.S.", fieldOfStudy: "Computer Science", startYear: 2020, endYear: 2022 },
  ]);

  await db.insert(experienceTable).values([
    {
      candidateId: candidates[0].id,
      company: "Lumen Labs",
      title: "SWE Intern",
      description: "Built and shipped a notification preferences UI used by 30k+ teams. Reduced bundle size 18% with a code-split refactor.",
      startDate: "2024-06-01",
      endDate: "2024-08-31",
    },
    {
      candidateId: candidates[0].id,
      company: "StudyPlan AI (side project)",
      title: "Founder & engineer",
      description: "Built an LLM-powered study planner. 12k weekly active students. Featured in the Northstar student newsletter.",
      startDate: "2023-09-01",
      endDate: null,
    },
    {
      candidateId: candidates[1].id,
      company: "Atlas Studios",
      title: "Product Designer",
      description: "Designed and helped engineer five client products from blank-page to launch.",
      startDate: "2021-09-01",
      endDate: null,
    },
  ]);

  await db.insert(certificationsTable).values([
    { candidateId: candidates[0].id, name: "AWS Cloud Practitioner", issuer: "Amazon", issuedAt: "2024-03-12" },
    { candidateId: candidates[0].id, name: "Meta Front-End Developer", issuer: "Meta", issuedAt: "2023-11-04" },
    { candidateId: candidates[2].id, name: "Deep Learning Specialization", issuer: "Coursera", issuedAt: "2022-05-20" },
  ]);

  await db.insert(badgesTable).values([
    { candidateId: candidates[0].id, name: "Top 1% Talent Score", description: "Among the top 1% of candidates by talent score on TalentLink.", tier: "platinum" },
    { candidateId: candidates[0].id, name: "Verified Project Builder", description: "Has shipped at least 3 production-quality projects.", tier: "gold" },
    { candidateId: candidates[0].id, name: "Open Source Contributor", description: "Active contributor to public repositories.", tier: "silver" },
    { candidateId: candidates[2].id, name: "ML Specialist", description: "Demonstrated expertise in production ML systems.", tier: "gold" },
    { candidateId: candidates[1].id, name: "Design Mentor", description: "Mentors aspiring designers in the community.", tier: "silver" },
  ]);

  console.log("Seeding jobs…");
  const jobs = await db.insert(jobsTable).values([
    {
      employerId: emp[0].id,
      title: "Frontend Engineer (Internship, Summer 2026)",
      type: "internship",
      location: "San Francisco, CA",
      remote: false,
      salaryMin: 8500,
      salaryMax: 11000,
      currency: "USD",
      summary: "Build delightful UIs for the next generation of collaboration tools. Mentored by senior engineers shipping every week.",
      description: "We're hiring summer interns onto our product engineering team. You'll own real features end-to-end — from sketch to ship — and your code will go to 30k+ teams worldwide. We pair every intern with a senior engineer and a product designer for the entire summer.",
      responsibilities: [
        "Own a customer-facing feature from spec to release",
        "Pair with senior engineers in code review and design sessions",
        "Contribute to our internal design system and component library",
        "Present your project at our end-of-summer demo day",
      ],
      requirements: [
        "Currently pursuing a CS, design, or related degree",
        "Comfortable with TypeScript and React",
        "Has shipped at least one substantial side project",
        "Strong communicator who loves writing things down",
      ],
      benefits: [
        "Monthly stipend (8.5k–11k USD)",
        "Catered lunch and unlimited coffee",
        "Full-time return offer for top performers",
        "Sponsored conference trip",
      ],
      skills: ["TypeScript", "React", "Tailwind CSS", "Next.js"],
      featured: true,
    },
    {
      employerId: emp[0].id,
      title: "Senior Product Designer",
      type: "full_time",
      location: "San Francisco, CA",
      remote: true,
      salaryMin: 165000,
      salaryMax: 210000,
      currency: "USD",
      summary: "Shape the next chapter of our product alongside a small, senior team that ships every week.",
      description: "We're looking for a senior product designer who can own end-to-end design — from research to interaction to ship-ready specs. You'll be the third designer at Lumen and have an outsized impact on what we build next.",
      responsibilities: [
        "Lead design on a key product surface used daily by thousands of teams",
        "Run discovery research with customers and synthesize into shipping decisions",
        "Partner closely with engineering to ship pixel-perfect experiences",
      ],
      requirements: [
        "5+ years of product design experience, ideally at SaaS companies",
        "Strong systems thinking and craft",
        "Portfolio of shipped, polished work",
      ],
      benefits: [
        "Competitive salary + equity",
        "Remote-friendly, with quarterly team offsites",
        "Top-tier health, dental, vision",
      ],
      skills: ["Figma", "UI Design", "UX Research", "Product Strategy"],
      featured: true,
    },
    {
      employerId: emp[1].id,
      title: "Embedded Software Engineer",
      type: "full_time",
      location: "Seattle, WA",
      remote: false,
      salaryMin: 145000,
      salaryMax: 185000,
      currency: "USD",
      summary: "Write the firmware that runs on satellites in low-earth orbit. Few rolls, no excuses.",
      description: "You'll be developing the embedded software that controls our small-sat propulsion systems. Your code will literally fly. This is a mission-critical role with deeply technical work.",
      responsibilities: [
        "Develop and maintain firmware for our propulsion control systems",
        "Run hardware-in-the-loop test campaigns",
        "Participate in launch readiness reviews",
      ],
      requirements: [
        "Experience with Rust or C in resource-constrained environments",
        "Comfortable with Linux and embedded toolchains",
        "Strong software engineering fundamentals",
      ],
      benefits: [
        "Equity in a company that's launched 40+ missions",
        "Health, dental, vision, 401k",
        "Front-row seat to launches",
      ],
      skills: ["Rust", "Python", "Linux", "Embedded Systems"],
      featured: true,
    },
    {
      employerId: emp[1].id,
      title: "Mission Operations Intern",
      type: "internship",
      location: "Seattle, WA",
      remote: false,
      salaryMin: 7500,
      salaryMax: 9000,
      currency: "USD",
      summary: "Support real launch campaigns from our mission control room.",
      description: "Spend your summer supporting active satellite missions. You'll run pre-launch checklists, monitor telemetry, and help our mission ops team during real launches.",
      responsibilities: [
        "Assist mission ops engineers during pre-launch and launch",
        "Monitor live telemetry from on-orbit assets",
        "Document operating procedures and post-mission reports",
      ],
      requirements: [
        "Aerospace, EE, or CS coursework",
        "Detail-oriented under pressure",
        "Comfortable working some nights/weekends around launches",
      ],
      benefits: [
        "Competitive monthly stipend",
        "Witness real rocket launches",
        "Return offer for top performers",
      ],
      skills: ["Python", "Linux", "Communication"],
      featured: false,
    },
    {
      employerId: emp[2].id,
      title: "Senior ML Engineer · Diagnostics",
      type: "full_time",
      location: "New York, NY",
      remote: true,
      salaryMin: 180000,
      salaryMax: 240000,
      currency: "USD",
      summary: "Build and ship the ML systems that help doctors catch disease earlier.",
      description: "You'll lead the design of a clinical-grade computer vision pipeline used in primary care clinics. Your work will directly affect millions of patients.",
      responsibilities: [
        "Own the end-to-end ML lifecycle for a clinical model",
        "Partner with clinicians to design rigorous evaluation protocols",
        "Ship to production and monitor in the wild",
      ],
      requirements: [
        "4+ years building production ML systems",
        "Deep PyTorch experience",
        "Comfortable with the realities of healthcare data",
      ],
      benefits: [
        "Mission-driven team, well-funded Series B",
        "Top-tier health benefits (we eat our own dog food)",
        "Annual learning stipend",
      ],
      skills: ["Python", "PyTorch", "Machine Learning", "AWS", "Docker"],
      featured: true,
    },
    {
      employerId: emp[2].id,
      title: "Data Analyst · Clinical Insights",
      type: "full_time",
      location: "Remote",
      remote: true,
      salaryMin: 95000,
      salaryMax: 130000,
      currency: "USD",
      summary: "Turn clinical data into product decisions clinicians and engineers can act on.",
      description: "Sit between our clinical operations team and our product engineering team. Your analyses will shape both the patient experience and our clinical model performance.",
      responsibilities: [
        "Build dashboards and run ad-hoc analyses for clinical operations",
        "Partner with ML engineers to surface model performance trends",
        "Communicate findings to non-technical stakeholders",
      ],
      requirements: [
        "Strong SQL and Python (Pandas)",
        "Clear communicator",
        "Healthcare experience a plus",
      ],
      benefits: ["Fully remote", "Health insurance", "Generous PTO"],
      skills: ["SQL", "Python", "Pandas", "Data Analysis", "Communication"],
      featured: false,
    },
    {
      employerId: emp[3].id,
      title: "Brand Designer (Contract)",
      type: "contract",
      location: "Brooklyn, NY",
      remote: true,
      salaryMin: 6000,
      salaryMax: 9000,
      currency: "USD",
      summary: "3-month contract to lead a brand refresh for a Series A AI startup client.",
      description: "We're staffing a senior brand designer onto a high-profile client engagement. You'll own the visual identity, marketing site, and pitch materials.",
      responsibilities: [
        "Lead client workshops to define brand attributes",
        "Design logo, type system, color, and brand guidelines",
        "Hand off to engineering for marketing site build",
      ],
      requirements: [
        "Senior-level brand portfolio",
        "Comfortable in client-facing settings",
        "Figma fluency",
      ],
      benefits: ["Competitive monthly retainer", "Path to FTE if a fit"],
      skills: ["Figma", "UI Design"],
      featured: false,
    },
    {
      employerId: emp[3].id,
      title: "Studio Engineer (Full-stack)",
      type: "full_time",
      location: "Brooklyn, NY",
      remote: true,
      salaryMin: 140000,
      salaryMax: 175000,
      currency: "USD",
      summary: "Ship product MVPs alongside designers and founders.",
      description: "Atlas engineers work across many client projects. You'll move fast, write quality code, and get an inside view of how the best founders operate.",
      responsibilities: [
        "Ship full-stack web apps with our designer-engineer pairs",
        "Work directly with founder clients in weekly reviews",
        "Set up and maintain client product infrastructure",
      ],
      requirements: [
        "3+ years of full-stack web experience",
        "Comfort with React, Node, Postgres",
        "Polished communication, since you'll talk directly to founders",
      ],
      benefits: ["Equity in studio profit pool", "Health, dental, vision"],
      skills: ["TypeScript", "React", "Node.js", "PostgreSQL", "Tailwind CSS"],
      featured: false,
    },
    {
      employerId: emp[4].id,
      title: "Investment Analyst (Part-time, MBA students)",
      type: "part_time",
      location: "San Francisco, CA",
      remote: true,
      salaryMin: 5000,
      salaryMax: 7000,
      currency: "USD",
      summary: "Support diligence on early-stage AI investments. 20 hrs/week.",
      description: "Beacon is hiring 1-2 part-time analysts (MBA students preferred) to support our AI thesis work and diligence pipeline.",
      responsibilities: [
        "Run market research on emerging AI categories",
        "Synthesize founder calls into investment memos",
        "Support partner-led diligence",
      ],
      requirements: [
        "Currently in or recently completed an MBA",
        "Strong written communication",
        "Comfortable in spreadsheets and slides",
      ],
      benefits: ["Direct partner mentorship", "Path to associate role"],
      skills: ["Communication", "Data Analysis", "Product Strategy"],
      featured: false,
    },
    {
      employerId: emp[0].id,
      title: "Backend Engineer · Platform",
      type: "full_time",
      location: "Remote",
      remote: true,
      salaryMin: 155000,
      salaryMax: 195000,
      currency: "USD",
      summary: "Own the systems that make Lumen reliable for thousands of teams.",
      description: "Join our platform team. You'll work on the systems that everything else at Lumen depends on — from auth to data sync to background jobs.",
      responsibilities: [
        "Design and ship reliable services in Go and TypeScript",
        "Own infrastructure projects end-to-end",
        "Mentor more junior engineers",
      ],
      requirements: [
        "4+ years of backend / platform experience",
        "Comfort with PostgreSQL, Docker, AWS or GCP",
      ],
      benefits: ["Remote-first", "Equity + competitive cash", "Strong health benefits"],
      skills: ["Go", "TypeScript", "PostgreSQL", "Docker", "Kubernetes", "AWS"],
      featured: false,
    },
    {
      employerId: emp[2].id,
      title: "Frontend Engineer · Patient Experience",
      type: "full_time",
      location: "New York, NY",
      remote: true,
      salaryMin: 145000,
      salaryMax: 180000,
      currency: "USD",
      summary: "Build the patient-facing experience for our diagnostics platform.",
      description: "Our patient experience team is hiring a senior frontend engineer to lead the next iteration of the patient app — beautiful, accessible, and deeply trustworthy.",
      responsibilities: [
        "Lead the redesign of the patient app",
        "Partner with design and clinical content teams",
        "Care obsessively about accessibility and performance",
      ],
      requirements: [
        "4+ years of TypeScript / React experience",
        "Strong taste and attention to detail",
        "Healthcare experience a plus",
      ],
      benefits: ["Mission-driven", "Health benefits", "Remote-first"],
      skills: ["TypeScript", "React", "Next.js", "Tailwind CSS", "GraphQL"],
      featured: false,
    },
    {
      employerId: emp[1].id,
      title: "Junior DevOps Engineer (Remote)",
      type: "remote",
      location: "Remote",
      remote: true,
      salaryMin: 110000,
      salaryMax: 140000,
      currency: "USD",
      summary: "Help us automate and scale our flight software CI/CD pipelines.",
      description: "Our flight software org is growing. We need a junior DevOps engineer to help modernize our build, test, and deployment pipelines.",
      responsibilities: [
        "Maintain and extend our CI/CD pipelines",
        "Manage infrastructure-as-code with Terraform",
        "Support engineers across the org with tooling",
      ],
      requirements: [
        "1+ years of DevOps or platform experience",
        "Comfort with Kubernetes and Terraform",
      ],
      benefits: ["Fully remote", "Equity", "Strong health benefits"],
      skills: ["Kubernetes", "Terraform", "AWS", "Docker", "Go"],
      featured: false,
    },
  ]).returning();

  console.log("Seeding applications…");
  // Helper: compute a fake match score from skills overlap
  function score(jobSkills: string[], candidateSkills: string[], yearsExp: number, talent: number) {
    const set = new Set(jobSkills.map((s) => s.toLowerCase()));
    const matched = candidateSkills.filter((s) => set.has(s.toLowerCase())).length;
    const cov = jobSkills.length === 0 ? 0.5 : matched / jobSkills.length;
    const raw = (cov * 0.65 + Math.min(yearsExp / 10, 1) * 0.15 + (talent / 100) * 0.2) * 100;
    return Math.min(99, Math.max(15, Math.round(raw)));
  }

  // Manually compose application rows so we can guarantee statuses for the demo
  const appsSpec: Array<{ jobIdx: number; candidateIdx: number; status: string; daysAgo: number; coverNote: string }> = [
    // Maya (id 1) — applies to several
    { jobIdx: 0, candidateIdx: 0, status: "interview", daysAgo: 4, coverNote: "I shipped a 12k WAU AI study planner this year and would love to do that kind of focused product work alongside your team this summer." },
    { jobIdx: 1, candidateIdx: 0, status: "applied", daysAgo: 1, coverNote: "I know I'm earlier in my career than the JD asks for, but I'd love to be considered." },
    { jobIdx: 7, candidateIdx: 0, status: "screening", daysAgo: 6, coverNote: "Atlas's studio model sounds like the kind of generalist environment I'd thrive in." },
    { jobIdx: 9, candidateIdx: 0, status: "applied", daysAgo: 2, coverNote: "I've spent the last year going deeper on backend infra. Would love to learn from your platform team." },

    // Jordan (id 2) — designer
    { jobIdx: 1, candidateIdx: 1, status: "offer", daysAgo: 7, coverNote: "I'd love to be the third designer at Lumen. My portfolio is at jordan.design." },
    { jobIdx: 6, candidateIdx: 1, status: "hired", daysAgo: 18, coverNote: "Excited to bring my design + light engineering background to your client work." },

    // Aiko (id 3) — ML
    { jobIdx: 4, candidateIdx: 2, status: "interview", daysAgo: 5, coverNote: "Production CV is what I do. Happy to walk through a recent shipped project on a call." },
    { jobIdx: 2, candidateIdx: 2, status: "rejected", daysAgo: 12, coverNote: "Curious about embedded — would love to learn more even if it's not a fit." },

    // Daniel (id 4) — backend
    { jobIdx: 9, candidateIdx: 3, status: "interview", daysAgo: 3, coverNote: "I've been deepening my Go skills since bootcamp and would love a platform role." },
    { jobIdx: 11, candidateIdx: 3, status: "applied", daysAgo: 1, coverNote: "Aerospace + DevOps would be a dream combination." },

    // Sara (id 5) — data
    { jobIdx: 5, candidateIdx: 4, status: "hired", daysAgo: 24, coverNote: "Healthcare equity is what motivates me most. I'd love to join Verdant." },

    // Liam (id 6) — frontend
    { jobIdx: 10, candidateIdx: 5, status: "interview", daysAgo: 4, coverNote: "I care a lot about a11y and performance — both seem core to your patient app." },
    { jobIdx: 1, candidateIdx: 5, status: "screening", daysAgo: 9, coverNote: "Senior IC role on a small product team is exactly what I'm looking for." },

    // Priya (id 7) — embedded
    { jobIdx: 2, candidateIdx: 6, status: "offer", daysAgo: 6, coverNote: "Rust on satellites is the work I want to be doing this decade." },
    { jobIdx: 3, candidateIdx: 6, status: "applied", daysAgo: 2, coverNote: "I'm interested in mission ops side of things too." },

    // Marcus (id 8) — PM
    { jobIdx: 8, candidateIdx: 7, status: "screening", daysAgo: 5, coverNote: "I'm pivoting from PM to early-stage VC and would value the analyst role to test my fit." },

    // Ela (id 9) — devops
    { jobIdx: 11, candidateIdx: 8, status: "hired", daysAgo: 30, coverNote: "Kubernetes + aerospace? Sign me up." },
    { jobIdx: 9, candidateIdx: 8, status: "rejected", daysAgo: 20, coverNote: "Open to platform engineering roles too." },

    // Noah (id 10) — designer
    { jobIdx: 6, candidateIdx: 9, status: "applied", daysAgo: 1, coverNote: "Brand work for a Series A AI client is my exact wheelhouse." },
    { jobIdx: 1, candidateIdx: 9, status: "withdrawn", daysAgo: 8, coverNote: "Withdrawing — accepted another role." },
  ];

  const now = Date.now();
  for (const a of appsSpec) {
    const job = jobs[a.jobIdx];
    const cand = candidates[a.candidateIdx];
    const matchScore = score(job.skills, cand.skills, cand.yearsExperience, cand.talentScore);
    const ts = new Date(now - a.daysAgo * 24 * 60 * 60 * 1000);
    await db.insert(applicationsTable).values({
      jobId: job.id,
      candidateId: cand.id,
      status: a.status,
      matchScore,
      coverNote: a.coverNote,
      appliedAt: ts,
      updatedAt: ts,
    });
  }

  console.log("Seeding default admin user…");
  const adminPasswordHash = await bcrypt.hash("admin123", 10);
  await db.insert(usersTable).values({
    email: "admin@talentlink.com",
    passwordHash: adminPasswordHash,
    role: "admin",
    status: "active",
    fullName: "Platform Admin",
    approvedAt: new Date(),
  });
  console.log(
    "  → admin@talentlink.com / admin123 (CHANGE THIS IN PRODUCTION)",
  );

  console.log("Done seeding.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
