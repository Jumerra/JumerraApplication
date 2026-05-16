/**
 * Curated free learning resources for the candidate growth plan
 * (Task #75). Static config — no CMS, no DB row per resource. Every
 * lookup is keyed on the *lowercased* skill name to match how
 * `calculateMatchScore` normalises skills.
 *
 * `estMinutes` is the rough wall-clock effort to reach junior-level
 * proficiency for that skill. We divide by 60 to get hours of focused
 * study, then assume ~1h/day to derive a target date — generous on
 * purpose because most candidates are juggling job applications too.
 *
 * Each pack ships at least 2 resources so the dashboard can always
 * surface the requested "top 2 free learning resources" without falling
 * back to a generic placeholder. The default pack at the bottom is
 * used for skills the curators haven't written copy for yet.
 */

export type GrowthResource = {
  title: string;
  url: string;
  estMinutes: number;
};

export type GrowthResourcePack = {
  /** Resources sorted by recommended order (most accessible first). */
  resources: GrowthResource[];
  /** Total estimated minutes to reach junior proficiency. */
  totalEstMinutes: number;
};

const PACKS: Record<string, GrowthResourcePack> = {
  javascript: {
    resources: [
      {
        title: "MDN: A re-introduction to JavaScript",
        url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/A_re-introduction_to_JavaScript",
        estMinutes: 240,
      },
      {
        title: "freeCodeCamp: JavaScript Algorithms and Data Structures",
        url: "https://www.freecodecamp.org/learn/javascript-algorithms-and-data-structures/",
        estMinutes: 1800,
      },
    ],
    totalEstMinutes: 2400,
  },
  typescript: {
    resources: [
      {
        title: "TypeScript Handbook",
        url: "https://www.typescriptlang.org/docs/handbook/intro.html",
        estMinutes: 360,
      },
      {
        title: "Total TypeScript: Beginners' tutorial",
        url: "https://www.totaltypescript.com/tutorials/beginners-typescript",
        estMinutes: 240,
      },
    ],
    totalEstMinutes: 900,
  },
  react: {
    resources: [
      {
        title: "React Docs: Learn React",
        url: "https://react.dev/learn",
        estMinutes: 480,
      },
      {
        title: "Scrimba: Learn React for free",
        url: "https://scrimba.com/learn/learnreact",
        estMinutes: 720,
      },
    ],
    totalEstMinutes: 1500,
  },
  "node.js": {
    resources: [
      {
        title: "Node.js Official: Getting Started",
        url: "https://nodejs.org/en/learn/getting-started/introduction-to-nodejs",
        estMinutes: 180,
      },
      {
        title: "The Odin Project: NodeJS course",
        url: "https://www.theodinproject.com/paths/full-stack-javascript/courses/nodejs",
        estMinutes: 1500,
      },
    ],
    totalEstMinutes: 1800,
  },
  python: {
    resources: [
      {
        title: "Python.org: The Python Tutorial",
        url: "https://docs.python.org/3/tutorial/",
        estMinutes: 360,
      },
      {
        title: "freeCodeCamp: Scientific Computing with Python",
        url: "https://www.freecodecamp.org/learn/scientific-computing-with-python/",
        estMinutes: 1500,
      },
    ],
    totalEstMinutes: 2000,
  },
  sql: {
    resources: [
      {
        title: "SQLZoo interactive tutorial",
        url: "https://sqlzoo.net/",
        estMinutes: 240,
      },
      {
        title: "PostgreSQL Tutorial",
        url: "https://www.postgresqltutorial.com/",
        estMinutes: 360,
      },
    ],
    totalEstMinutes: 600,
  },
  git: {
    resources: [
      {
        title: "Atlassian: Learn Git",
        url: "https://www.atlassian.com/git/tutorials",
        estMinutes: 120,
      },
      {
        title: "GitHub Learning Lab: Git Handbook",
        url: "https://guides.github.com/introduction/git-handbook/",
        estMinutes: 90,
      },
    ],
    totalEstMinutes: 300,
  },
  docker: {
    resources: [
      {
        title: "Docker: Getting Started",
        url: "https://docs.docker.com/get-started/",
        estMinutes: 180,
      },
      {
        title: "Docker Curriculum",
        url: "https://docker-curriculum.com/",
        estMinutes: 300,
      },
    ],
    totalEstMinutes: 600,
  },
  aws: {
    resources: [
      {
        title: "AWS Cloud Practitioner Essentials (free)",
        url: "https://aws.amazon.com/training/awsacademy/",
        estMinutes: 600,
      },
      {
        title: "AWS Skill Builder: Free digital training",
        url: "https://skillbuilder.aws/",
        estMinutes: 900,
      },
    ],
    totalEstMinutes: 1800,
  },
  excel: {
    resources: [
      {
        title: "Microsoft: Excel video training",
        url: "https://support.microsoft.com/en-us/office/excel-video-training-9bc05390-e94c-46af-a5b3-d7c22f6990bb",
        estMinutes: 240,
      },
      {
        title: "ExcelJet: Excel Functions",
        url: "https://exceljet.net/functions",
        estMinutes: 180,
      },
    ],
    totalEstMinutes: 600,
  },
  figma: {
    resources: [
      {
        title: "Figma: Get Started",
        url: "https://help.figma.com/hc/en-us/categories/360002051613",
        estMinutes: 120,
      },
      {
        title: "Figma Academy (YouTube)",
        url: "https://www.youtube.com/c/Figmadesign",
        estMinutes: 300,
      },
    ],
    totalEstMinutes: 600,
  },
  communication: {
    resources: [
      {
        title: "Coursera: Improving Communication Skills (audit free)",
        url: "https://www.coursera.org/learn/wharton-communication-skills",
        estMinutes: 600,
      },
      {
        title: "Harvard Business Review: Communication",
        url: "https://hbr.org/topic/communication",
        estMinutes: 240,
      },
    ],
    totalEstMinutes: 900,
  },
};

const DEFAULT_PACK: GrowthResourcePack = {
  resources: [
    {
      title: "Coursera: Free courses catalog",
      url: "https://www.coursera.org/courses?query=free",
      estMinutes: 600,
    },
    {
      title: "Class Central: Free online courses",
      url: "https://www.classcentral.com/",
      estMinutes: 600,
    },
  ],
  totalEstMinutes: 1200,
};

export function getGrowthResources(skill: string): GrowthResourcePack {
  return PACKS[skill.toLowerCase()] ?? DEFAULT_PACK;
}

export function hasCuratedPack(skill: string): boolean {
  return PACKS[skill.toLowerCase()] != null;
}
