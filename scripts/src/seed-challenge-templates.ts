import { db, challengeTemplatesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

type Q = { prompt: string; options: string[]; correctIndex: number };

type Template = {
  skill: string;
  title: string;
  description: string;
  questions: Q[];
};

const TEMPLATES: Template[] = [
  {
    skill: "javascript",
    title: "JavaScript fundamentals",
    description: "Core JS knowledge: types, async, scope.",
    questions: [
      {
        prompt: "What is the result of typeof null in JavaScript?",
        options: ["'null'", "'object'", "'undefined'", "'number'"],
        correctIndex: 1,
      },
      {
        prompt: "Which method returns a promise that resolves when all input promises resolve?",
        options: ["Promise.race", "Promise.any", "Promise.all", "Promise.resolve"],
        correctIndex: 2,
      },
      {
        prompt: "What does the let keyword introduce that var does not?",
        options: ["Hoisting", "Block scope", "Global scope", "Strict mode"],
        correctIndex: 1,
      },
    ],
  },
  {
    skill: "typescript",
    title: "TypeScript essentials",
    description: "Types, generics, and structural typing.",
    questions: [
      {
        prompt: "Which utility type makes all properties optional?",
        options: ["Required<T>", "Partial<T>", "Readonly<T>", "Pick<T, K>"],
        correctIndex: 1,
      },
      {
        prompt: "What is the type of an array of strings?",
        options: ["string[]", "Array(string)", "string{}", "[string]"],
        correctIndex: 0,
      },
      {
        prompt: "Which keyword declares a value that cannot be reassigned?",
        options: ["let", "var", "const", "readonly"],
        correctIndex: 2,
      },
    ],
  },
  {
    skill: "react",
    title: "React core concepts",
    description: "Components, hooks, and re-renders.",
    questions: [
      {
        prompt: "Which hook lets you persist a mutable value across renders without causing re-renders?",
        options: ["useState", "useMemo", "useRef", "useEffect"],
        correctIndex: 2,
      },
      {
        prompt: "When does useEffect run by default?",
        options: ["Before render", "After every render", "Only on mount", "Only on unmount"],
        correctIndex: 1,
      },
      {
        prompt: "What is the correct way to lift state up?",
        options: [
          "Use Context for all state",
          "Move state to the closest common ancestor",
          "Store state in localStorage",
          "Use refs to share state",
        ],
        correctIndex: 1,
      },
    ],
  },
  {
    skill: "sql",
    title: "SQL fundamentals",
    description: "Joins, aggregates, and basic query shape.",
    questions: [
      {
        prompt: "Which JOIN returns all rows from the left table even if no match exists on the right?",
        options: ["INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "CROSS JOIN"],
        correctIndex: 1,
      },
      {
        prompt: "Which clause filters rows AFTER aggregation?",
        options: ["WHERE", "GROUP BY", "HAVING", "ORDER BY"],
        correctIndex: 2,
      },
      {
        prompt: "Which keyword removes duplicate rows from a result set?",
        options: ["UNIQUE", "DISTINCT", "DEDUPE", "ONLY"],
        correctIndex: 1,
      },
    ],
  },
  {
    skill: "python",
    title: "Python fundamentals",
    description: "Data types, comprehensions, and idioms.",
    questions: [
      {
        prompt: "Which data structure is ordered and mutable?",
        options: ["tuple", "frozenset", "list", "str"],
        correctIndex: 2,
      },
      {
        prompt: "What does [x*2 for x in range(3)] produce?",
        options: ["[0, 2, 4]", "[2, 4, 6]", "[1, 2, 3]", "(0, 2, 4)"],
        correctIndex: 0,
      },
      {
        prompt: "Which keyword defines a generator function?",
        options: ["return", "yield", "async", "defer"],
        correctIndex: 1,
      },
    ],
  },
  {
    skill: "node.js",
    title: "Node.js basics",
    description: "Event loop, modules, and async patterns.",
    questions: [
      {
        prompt: "Which API schedules a callback after the current operation?",
        options: ["setTimeout(fn, 0)", "process.nextTick(fn)", "setInterval(fn, 0)", "queueMicrotask(fn)"],
        correctIndex: 1,
      },
      {
        prompt: "Which module is used for file-system operations?",
        options: ["fs", "path", "os", "stream"],
        correctIndex: 0,
      },
    ],
  },
  {
    skill: "communication",
    title: "Workplace communication",
    description: "Practical communication judgement.",
    questions: [
      {
        prompt: "You can't hit a Friday deadline. What's the best first move?",
        options: [
          "Stay quiet and try to catch up",
          "Tell your manager early with a revised ETA and what help you need",
          "Wait until Monday to explain why",
          "Email the whole team a long apology",
        ],
        correctIndex: 1,
      },
      {
        prompt: "A teammate gives unclear feedback. What's the most effective response?",
        options: [
          "Ignore it and move on",
          "Ask a specific clarifying question with an example",
          "Push back and defend your work",
          "Escalate to their manager",
        ],
        correctIndex: 1,
      },
    ],
  },
  {
    skill: "problem solving",
    title: "Problem-solving aptitude",
    description: "General reasoning and prioritisation.",
    questions: [
      {
        prompt: "Your app slows down only for some users. The best first step is to:",
        options: [
          "Rewrite the slow page",
          "Add more servers",
          "Look at metrics/logs to identify which users and what they do differently",
          "Ask everyone to clear their cache",
        ],
        correctIndex: 2,
      },
      {
        prompt: "You're given three tasks: urgent + small, important + large, low priority. Best order?",
        options: [
          "Important + large first",
          "Urgent + small first, then important + large",
          "Low priority first to clear the list",
          "Whichever you feel like",
        ],
        correctIndex: 1,
      },
    ],
  },
];

async function main() {
  for (const t of TEMPLATES) {
    // Idempotent: upsert by (skill, title).
    const existing = await db.execute(sql`
      SELECT id FROM challenge_templates
      WHERE skill = ${t.skill} AND title = ${t.title}
      LIMIT 1
    `);
    if ((existing.rows as { id: number }[]).length > 0) continue;
    await db.insert(challengeTemplatesTable).values({
      skill: t.skill,
      title: t.title,
      description: t.description,
      questions: t.questions,
    });
  }
  console.log(`Seeded ${TEMPLATES.length} challenge templates`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
