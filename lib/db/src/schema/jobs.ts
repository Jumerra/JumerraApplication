import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  employerId: integer("employer_id").notNull(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  location: text("location").notNull(),
  remote: boolean("remote").notNull().default(false),
  salaryMin: integer("salary_min"),
  salaryMax: integer("salary_max"),
  currency: text("currency").notNull().default("USD"),
  summary: text("summary").notNull(),
  description: text("description").notNull(),
  responsibilities: text("responsibilities").array().notNull().default([]),
  requirements: text("requirements").array().notNull().default([]),
  benefits: text("benefits").array().notNull().default([]),
  skills: text("skills").array().notNull().default([]),
  featured: boolean("featured").notNull().default(false),
  postedAt: timestamp("posted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Job = typeof jobsTable.$inferSelect;
export type InsertJob = typeof jobsTable.$inferInsert;
