CREATE TABLE IF NOT EXISTS "auto_apply_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"job_id" integer NOT NULL,
	"application_id" integer,
	"match_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auto_apply_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"price_cents" integer DEFAULT 150000 NOT NULL,
	"currency" text DEFAULT 'ngn' NOT NULL,
	"interval_days" integer DEFAULT 30 NOT NULL,
	"match_threshold" integer DEFAULT 75 NOT NULL,
	"daily_cap" integer DEFAULT 10 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auto_apply_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"stripe_checkout_session_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"paystack_reference" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"price_cents_snapshot" integer NOT NULL,
	"currency_snapshot" text NOT NULL,
	"interval_days_snapshot" integer DEFAULT 30 NOT NULL,
	"current_period_end" timestamp with time zone,
	"started_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_apply_subscriptions_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" integer NOT NULL,
	"source" text NOT NULL,
	"actor_user_id" integer,
	"actor_name" text,
	"token_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "auto_apply_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_roles" ADD COLUMN IF NOT EXISTS "ministry_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auto_apply_log_candidate_job_unique" ON "auto_apply_log" USING btree ("candidate_id","job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_apply_log_candidate_created_idx" ON "auto_apply_log" USING btree ("candidate_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_apply_sub_by_candidate_idx" ON "auto_apply_subscriptions" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_created_at_idx" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_entity_idx" ON "admin_audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_roles_ministry_id_ministries_id_fk') THEN
  ALTER TABLE "admin_roles" ADD CONSTRAINT "admin_roles_ministry_id_ministries_id_fk" FOREIGN KEY ("ministry_id") REFERENCES "public"."ministries"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_roles_ministry_idx" ON "admin_roles" USING btree ("ministry_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_roles_ministry_scope_name_unique" ON "admin_roles" USING btree ("ministry_id","name") WHERE "admin_roles"."scope" = 'ministry';
