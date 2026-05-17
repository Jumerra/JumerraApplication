ALTER TABLE "institutions" ADD COLUMN "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "employers" ADD COLUMN "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "deleted_by" integer;