import { pgTable, serial, text } from "drizzle-orm/pg-core";

export const skillsTable = pgTable("skills", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: text("category").notNull(),
});

export type Skill = typeof skillsTable.$inferSelect;
export type InsertSkill = typeof skillsTable.$inferInsert;
