import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  date,
} from "drizzle-orm/pg-core";

export const candidatesTable = pgTable("candidates", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  headline: text("headline").notNull(),
  bio: text("bio").notNull(),
  location: text("location").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  avatarUrl: text("avatar_url").notNull(),
  portfolioUrl: text("portfolio_url"),
  videoIntroUrl: text("video_intro_url"),
  availability: text("availability").notNull().default("open"),
  yearsExperience: integer("years_experience").notNull().default(0),
  talentScore: integer("talent_score").notNull().default(50),
  isBoosted: boolean("is_boosted").notNull().default(false),
  institutionId: integer("institution_id"),
  skills: text("skills").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Candidate = typeof candidatesTable.$inferSelect;
export type InsertCandidate = typeof candidatesTable.$inferInsert;

export const educationTable = pgTable("education_entries", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").notNull(),
  institution: text("institution").notNull(),
  degree: text("degree").notNull(),
  fieldOfStudy: text("field_of_study").notNull(),
  startYear: integer("start_year").notNull(),
  endYear: integer("end_year"),
});

export type Education = typeof educationTable.$inferSelect;

export const experienceTable = pgTable("experience_entries", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").notNull(),
  company: text("company").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
});

export type Experience = typeof experienceTable.$inferSelect;

export const certificationsTable = pgTable("certifications", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").notNull(),
  name: text("name").notNull(),
  issuer: text("issuer").notNull(),
  issuedAt: date("issued_at").notNull(),
});

export type Certification = typeof certificationsTable.$inferSelect;

export const badgesTable = pgTable("badges", {
  id: serial("id").primaryKey(),
  candidateId: integer("candidate_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  tier: text("tier").notNull().default("bronze"),
});

export type Badge = typeof badgesTable.$inferSelect;
