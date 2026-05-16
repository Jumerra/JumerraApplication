CREATE TABLE IF NOT EXISTS "institution_departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"faculty_id" integer,
	"name" text NOT NULL,
	"code" text,
	"head_name" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "institution_facilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"location" text,
	"description" text,
	"capacity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "institution_faculties" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"dean_name" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "institutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"location" text NOT NULL,
	"logo_url" text NOT NULL,
	"website_url" text NOT NULL,
	"description" text NOT NULL,
	"slug" text,
	"account_manager_id" integer,
	"public_leaderboard_enabled" boolean DEFAULT true NOT NULL,
	"banner_url" text,
	"featured_programs" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tagline" text NOT NULL,
	"description" text NOT NULL,
	"industry" text NOT NULL,
	"location" text NOT NULL,
	"logo_url" text NOT NULL,
	"cover_url" text NOT NULL,
	"website_url" text NOT NULL,
	"size" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"account_manager_id" integer,
	"legacy_subscription_migrated_at" timestamp with time zone,
	"fast_track_enabled" boolean DEFAULT false NOT NULL,
	"fast_track_enabled_at" timestamp with time zone,
	"fast_track_revoked_until" timestamp with time zone,
	"daily_deck_timezone" text DEFAULT 'UTC' NOT NULL,
	"daily_deck_refresh_hour" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "badges" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"tier" text DEFAULT 'bronze' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_institutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"institution_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" integer,
	"department_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"headline" text NOT NULL,
	"bio" text NOT NULL,
	"location" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"avatar_url" text NOT NULL,
	"portfolio_url" text,
	"video_intro_url" text,
	"availability" text DEFAULT 'open' NOT NULL,
	"years_experience" integer DEFAULT 0 NOT NULL,
	"talent_score" integer DEFAULT 50 NOT NULL,
	"is_boosted" boolean DEFAULT false NOT NULL,
	"boost_expires_at" timestamp with time zone,
	"open_to_offers" boolean DEFAULT true NOT NULL,
	"open_to_offers_since" timestamp with time zone DEFAULT now(),
	"alumni_mentor_optin" boolean DEFAULT false NOT NULL,
	"allow_intro_requests" boolean DEFAULT true NOT NULL,
	"ai_cv_unlocked" boolean DEFAULT false NOT NULL,
	"ai_cv_unlocked_at" timestamp with time zone,
	"ai_cv_text" text,
	"ai_cv_generated_at" timestamp with time zone,
	"institution_id" integer,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"background_check_status" text DEFAULT 'not_started' NOT NULL,
	"background_check_updated_at" timestamp with time zone,
	"background_check_updated_by" integer,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"name" text NOT NULL,
	"issuer" text NOT NULL,
	"issued_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "education_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"institution" text NOT NULL,
	"degree" text NOT NULL,
	"field_of_study" text NOT NULL,
	"start_year" integer NOT NULL,
	"end_year" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "experience_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"employer_id" integer,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"employment_type" text,
	"location" text,
	"location_type" text,
	"description" text DEFAULT '' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"employer_id" integer NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"location" text NOT NULL,
	"remote" boolean DEFAULT false NOT NULL,
	"salary_min" integer,
	"salary_max" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"summary" text NOT NULL,
	"description" text NOT NULL,
	"responsibilities" text[] DEFAULT '{}' NOT NULL,
	"requirements" text[] DEFAULT '{}' NOT NULL,
	"benefits" text[] DEFAULT '{}' NOT NULL,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"tier_expires_at" timestamp with time zone,
	"target_skills" text[] DEFAULT '{}' NOT NULL,
	"target_location" text,
	"visibility" text DEFAULT 'public' NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"match_score" integer DEFAULT 0 NOT NULL,
	"cover_note" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'browse' NOT NULL,
	"board_order" integer DEFAULT 0 NOT NULL,
	"reported_salary" integer,
	"reported_currency" text,
	"salary_reported_at" timestamp with time zone,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	CONSTRAINT "skills_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_setup_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pending_registrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"submitted_data" jsonb NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" integer,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"sid" text PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"full_name" text NOT NULL,
	"candidate_id" integer,
	"employer_id" integer,
	"institution_id" integer,
	"org_role" text,
	"assigned_department_id" integer,
	"assigned_faculty_id" integer,
	"avatar_url" text,
	"phone" text,
	"title" text,
	"bio" text,
	"whatsapp_number" text,
	"whatsapp_verified_at" timestamp with time zone,
	"whatsapp_otp_hash" text,
	"whatsapp_otp_expires_at" timestamp with time zone,
	"whatsapp_otp_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_content" (
	"key" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_role_permissions" (
	"role_id" integer NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "admin_role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text DEFAULT 'admin' NOT NULL,
	"employer_id" integer,
	"institution_id" integer,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "boost_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"stripe_session_id" text NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"paystack_reference" text,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"duration_days" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"boost_expires_at" timestamp with time zone,
	CONSTRAINT "boost_payments_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "boost_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"price_cents" integer DEFAULT 2900 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"duration_days" integer DEFAULT 7 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cv_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"stripe_session_id" text NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"paystack_reference" text,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "cv_payments_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cv_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"price_cents" integer DEFAULT 1900 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "institution_subscription_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"price_cents" integer DEFAULT 9900 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"interval_days" integer DEFAULT 30 NOT NULL,
	"trial_days" integer DEFAULT 14 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "institution_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"stripe_checkout_session_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"paystack_reference" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"price_cents_snapshot" integer NOT NULL,
	"currency_snapshot" text NOT NULL,
	"interval_days_snapshot" integer DEFAULT 30 NOT NULL,
	"trial_days_snapshot" integer NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"started_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_subscriptions_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employer_subscription_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"free_job_post_limit" integer DEFAULT 3 NOT NULL,
	"price_cents" integer DEFAULT 4900 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"interval_days" integer DEFAULT 30 NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employer_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"employer_id" integer NOT NULL,
	"stripe_checkout_session_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"paystack_reference" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"price_cents_snapshot" integer NOT NULL,
	"currency_snapshot" text NOT NULL,
	"interval_days_snapshot" integer NOT NULL,
	"trial_days_snapshot" integer NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"started_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employer_subscriptions_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_tier_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"employer_id" integer NOT NULL,
	"tier" text NOT NULL,
	"stripe_session_id" text NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"paystack_reference" text,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"duration_days" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"tier_expires_at" timestamp with time zone,
	CONSTRAINT "job_tier_payments_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_tier_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"promoted_active" boolean DEFAULT true NOT NULL,
	"promoted_price_cents" integer DEFAULT 2900 NOT NULL,
	"promoted_currency" text DEFAULT 'usd' NOT NULL,
	"promoted_duration_days" integer DEFAULT 30 NOT NULL,
	"sponsored_active" boolean DEFAULT true NOT NULL,
	"sponsored_price_cents" integer DEFAULT 9900 NOT NULL,
	"sponsored_currency" text DEFAULT 'usd' NOT NULL,
	"sponsored_duration_days" integer DEFAULT 30 NOT NULL,
	"sponsored_push_cap" integer DEFAULT 200 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sponsored_job_pushes" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"pushed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"logo_url" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interview_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"employer_id" integer NOT NULL,
	"created_by_user_id" integer,
	"status" text DEFAULT 'proposed' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"meeting_link" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"selected_slot_id" integer,
	"decline_reason" text DEFAULT '' NOT NULL,
	"responded_at" timestamp with time zone,
	"reminded_24_at" timestamp with time zone,
	"reminded_1_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interview_time_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"invite_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profile_view_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"employer_id" integer NOT NULL,
	"notified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profile_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"viewer_user_id" integer NOT NULL,
	"employer_id" integer NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_references" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"referee_email" text NOT NULL,
	"relationship" text NOT NULL,
	"token" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_referee_name" text,
	"submitted_referee_role" text,
	"would_rehire" boolean,
	"strengths" text,
	"hidden_at" timestamp with time zone,
	"hidden_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_skill_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"institution_id" integer NOT NULL,
	"skill" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" integer,
	"revoked_at" timestamp with time zone,
	"revoked_by" integer,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "application_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"status" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_saved_searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"name" text NOT NULL,
	"search_text" text,
	"job_type" text,
	"filters_json" text DEFAULT '{}' NOT NULL,
	"sort_by" text,
	"email_alerts" boolean DEFAULT true NOT NULL,
	"in_app_alerts" boolean DEFAULT true NOT NULL,
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"last_seen_job_id" integer DEFAULT 0 NOT NULL,
	"last_alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_weekly_digests" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"week_start" date NOT NULL,
	"profile_views" integer DEFAULT 0 NOT NULL,
	"applications_sent" integer DEFAULT 0 NOT NULL,
	"interviews_scheduled" integer DEFAULT 0 NOT NULL,
	"new_matches_json" text DEFAULT '[]' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_sent_at" timestamp with time zone,
	"email_send_result" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_request_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"kind" text NOT NULL,
	"key_hash" text NOT NULL,
	"output" jsonb NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employer_message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"employer_id" integer NOT NULL,
	"name" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employer_outreach_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"employer_id" integer NOT NULL,
	"sender_user_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"pool_id" integer,
	"template_id" integer,
	"subject" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"delivery_status" text DEFAULT 'in_app' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employer_talent_pool_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"pool_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"added_by" integer,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employer_talent_pools" (
	"id" serial PRIMARY KEY NOT NULL,
	"employer_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_cohort_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"cohort_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_cohorts" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"year" integer NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employer_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"employer_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"institution_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"moderated_at" timestamp with time zone,
	"moderated_by" integer,
	"moderation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mentorship_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"requester_candidate_id" integer NOT NULL,
	"mentor_candidate_id" integer NOT NULL,
	"institution_id" integer NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "placement_stories" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"employer_id" integer NOT NULL,
	"institution_id" integer,
	"quote" text NOT NULL,
	"photo_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"moderated_at" timestamp with time zone,
	"moderated_by" integer,
	"moderation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_dismissed_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"job_id" integer NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expo_push_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" text NOT NULL,
	"platform" text DEFAULT 'unknown' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_prefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"strong_match" boolean DEFAULT true NOT NULL,
	"application_status" boolean DEFAULT true NOT NULL,
	"interview_reminder" boolean DEFAULT true NOT NULL,
	"profile_viewed" boolean DEFAULT true NOT NULL,
	"weekly_digest" boolean DEFAULT true NOT NULL,
	"whatsapp_strong_match" boolean DEFAULT false NOT NULL,
	"whatsapp_application_status" boolean DEFAULT false NOT NULL,
	"whatsapp_interview_reminder" boolean DEFAULT false NOT NULL,
	"whatsapp_weekly_digest" boolean DEFAULT false NOT NULL,
	"digest_dow" integer DEFAULT 1 NOT NULL,
	"digest_hour" integer DEFAULT 9 NOT NULL,
	"digest_tz" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mock_interviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"job_id" integer NOT NULL,
	"application_id" integer,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"rubric_version" text DEFAULT 'v1' NOT NULL,
	"rubric" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score_overall" integer,
	"score_technical" integer,
	"score_communication" integer,
	"score_culture" integer,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "application_endorsements" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"institution_id" integer NOT NULL,
	"endorsed_by_user_id" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "application_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer,
	"candidate_id" integer NOT NULL,
	"job_id" integer NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "challenge_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"skill" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"difficulty" text DEFAULT 'medium' NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"title" text DEFAULT 'Skill challenge' NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"passing_score" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer DEFAULT 300 NOT NULL,
	"template_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overrides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_open_windows" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"opens_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reverse_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"employer_id" integer NOT NULL,
	"job_title" text NOT NULL,
	"salary_min" integer NOT NULL,
	"salary_max" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"start_date" date,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"parent_offer_id" integer,
	"application_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alumni_intro_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"job_id" integer NOT NULL,
	"alumni_user_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_message_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"to_number" text NOT NULL,
	"category" text NOT NULL,
	"template_key" text NOT NULL,
	"status" text NOT NULL,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_growth_repings" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"employer_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"skill" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"quarter_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_growth_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"skill" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"target_date" timestamp with time zone,
	"rejection_count" integer DEFAULT 0 NOT NULL,
	"verification_url" text,
	CONSTRAINT "candidate_growth_skills_status_check" CHECK (status in ('active','completed','dismissed','superseded'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employer_sla_breaches" (
	"id" serial PRIMARY KEY NOT NULL,
	"employer_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"breached_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employer_daily_decks" (
	"id" serial PRIMARY KEY NOT NULL,
	"employer_id" integer NOT NULL,
	"deck_date" text NOT NULL,
	"candidate_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employer_dismissed_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"employer_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"job_id" integer,
	"reason" text,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "institution_api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"label" text NOT NULL,
	"prefix" text NOT NULL,
	"hashed_key" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "institution_api_keys_hashed_key_unique" UNIQUE("hashed_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_ref" text NOT NULL,
	"purpose_type" text NOT NULL,
	"purpose_id" integer NOT NULL,
	"amount_subunits" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"buyer_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "institution_departments" ADD CONSTRAINT "institution_departments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "institution_departments" ADD CONSTRAINT "institution_departments_faculty_id_institution_faculties_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."institution_faculties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "institution_facilities" ADD CONSTRAINT "institution_facilities_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "institution_faculties" ADD CONSTRAINT "institution_faculties_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "institutions" ADD CONSTRAINT "institutions_account_manager_id_users_id_fk" FOREIGN KEY ("account_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employers" ADD CONSTRAINT "employers_account_manager_id_users_id_fk" FOREIGN KEY ("account_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_institutions" ADD CONSTRAINT "candidate_institutions_department_id_institution_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."institution_departments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_assigned_department_id_institution_departments_id_fk" FOREIGN KEY ("assigned_department_id") REFERENCES "public"."institution_departments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_assigned_faculty_id_institution_faculties_id_fk" FOREIGN KEY ("assigned_faculty_id") REFERENCES "public"."institution_faculties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "admin_role_permissions" ADD CONSTRAINT "admin_role_permissions_role_id_admin_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."admin_roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "admin_roles" ADD CONSTRAINT "admin_roles_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "admin_roles" ADD CONSTRAINT "admin_roles_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "interview_invites" ADD CONSTRAINT "interview_invites_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "interview_invites" ADD CONSTRAINT "interview_invites_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "interview_invites" ADD CONSTRAINT "interview_invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "interview_time_slots" ADD CONSTRAINT "interview_time_slots_invite_id_interview_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."interview_invites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "profile_view_notifications" ADD CONSTRAINT "profile_view_notifications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "profile_view_notifications" ADD CONSTRAINT "profile_view_notifications_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_viewer_user_id_users_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_references" ADD CONSTRAINT "candidate_references_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_references" ADD CONSTRAINT "candidate_references_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_skill_verifications" ADD CONSTRAINT "candidate_skill_verifications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_skill_verifications" ADD CONSTRAINT "candidate_skill_verifications_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_skill_verifications" ADD CONSTRAINT "candidate_skill_verifications_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_skill_verifications" ADD CONSTRAINT "candidate_skill_verifications_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_saved_searches" ADD CONSTRAINT "candidate_saved_searches_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_weekly_digests" ADD CONSTRAINT "candidate_weekly_digests_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_message_templates" ADD CONSTRAINT "employer_message_templates_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_message_templates" ADD CONSTRAINT "employer_message_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_outreach_messages" ADD CONSTRAINT "employer_outreach_messages_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_outreach_messages" ADD CONSTRAINT "employer_outreach_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_outreach_messages" ADD CONSTRAINT "employer_outreach_messages_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_outreach_messages" ADD CONSTRAINT "employer_outreach_messages_pool_id_employer_talent_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."employer_talent_pools"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_outreach_messages" ADD CONSTRAINT "employer_outreach_messages_template_id_employer_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."employer_message_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_talent_pool_members" ADD CONSTRAINT "employer_talent_pool_members_pool_id_employer_talent_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."employer_talent_pools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_talent_pool_members" ADD CONSTRAINT "employer_talent_pool_members_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_talent_pool_members" ADD CONSTRAINT "employer_talent_pool_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_talent_pools" ADD CONSTRAINT "employer_talent_pools_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_talent_pools" ADD CONSTRAINT "employer_talent_pools_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_cohort_members" ADD CONSTRAINT "candidate_cohort_members_cohort_id_candidate_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."candidate_cohorts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_cohort_members" ADD CONSTRAINT "candidate_cohort_members_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_cohorts" ADD CONSTRAINT "candidate_cohorts_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_reviews" ADD CONSTRAINT "employer_reviews_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_reviews" ADD CONSTRAINT "employer_reviews_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_reviews" ADD CONSTRAINT "employer_reviews_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_reviews" ADD CONSTRAINT "employer_reviews_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mentorship_requests" ADD CONSTRAINT "mentorship_requests_requester_candidate_id_candidates_id_fk" FOREIGN KEY ("requester_candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mentorship_requests" ADD CONSTRAINT "mentorship_requests_mentor_candidate_id_candidates_id_fk" FOREIGN KEY ("mentor_candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mentorship_requests" ADD CONSTRAINT "mentorship_requests_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "placement_stories" ADD CONSTRAINT "placement_stories_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "placement_stories" ADD CONSTRAINT "placement_stories_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "placement_stories" ADD CONSTRAINT "placement_stories_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "placement_stories" ADD CONSTRAINT "placement_stories_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_dismissed_jobs" ADD CONSTRAINT "candidate_dismissed_jobs_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_dismissed_jobs" ADD CONSTRAINT "candidate_dismissed_jobs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "expo_push_tokens" ADD CONSTRAINT "expo_push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mock_interviews" ADD CONSTRAINT "mock_interviews_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mock_interviews" ADD CONSTRAINT "mock_interviews_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mock_interviews" ADD CONSTRAINT "mock_interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "application_endorsements" ADD CONSTRAINT "application_endorsements_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "application_endorsements" ADD CONSTRAINT "application_endorsements_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "application_endorsements" ADD CONSTRAINT "application_endorsements_endorsed_by_user_id_users_id_fk" FOREIGN KEY ("endorsed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "application_challenges" ADD CONSTRAINT "application_challenges_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "application_challenges" ADD CONSTRAINT "application_challenges_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "application_challenges" ADD CONSTRAINT "application_challenges_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "job_challenges" ADD CONSTRAINT "job_challenges_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "alumni_intro_requests" ADD CONSTRAINT "alumni_intro_requests_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "alumni_intro_requests" ADD CONSTRAINT "alumni_intro_requests_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "alumni_intro_requests" ADD CONSTRAINT "alumni_intro_requests_alumni_user_id_users_id_fk" FOREIGN KEY ("alumni_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "whatsapp_message_log" ADD CONSTRAINT "whatsapp_message_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_growth_repings" ADD CONSTRAINT "candidate_growth_repings_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_growth_repings" ADD CONSTRAINT "candidate_growth_repings_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_growth_repings" ADD CONSTRAINT "candidate_growth_repings_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_growth_skills" ADD CONSTRAINT "candidate_growth_skills_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_sla_breaches" ADD CONSTRAINT "employer_sla_breaches_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_sla_breaches" ADD CONSTRAINT "employer_sla_breaches_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_daily_decks" ADD CONSTRAINT "employer_daily_decks_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_dismissed_candidates" ADD CONSTRAINT "employer_dismissed_candidates_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_dismissed_candidates" ADD CONSTRAINT "employer_dismissed_candidates_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "employer_dismissed_candidates" ADD CONSTRAINT "employer_dismissed_candidates_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "institution_dept_inst_idx" ON "institution_departments" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "institution_dept_faculty_idx" ON "institution_departments" USING btree ("faculty_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "institution_dept_inst_name_idx" ON "institution_departments" USING btree ("institution_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "institution_facility_inst_idx" ON "institution_facilities" USING btree ("institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "institution_facility_inst_name_idx" ON "institution_facilities" USING btree ("institution_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "institution_faculty_inst_idx" ON "institution_faculties" USING btree ("institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "institution_faculty_inst_name_idx" ON "institution_faculties" USING btree ("institution_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "institution_account_manager_idx" ON "institutions" USING btree ("account_manager_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "institution_slug_idx" ON "institutions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employer_account_manager_idx" ON "employers" USING btree ("account_manager_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_institution_unique" ON "candidate_institutions" USING btree ("candidate_id","institution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_institutions_candidate_idx" ON "candidate_institutions" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_institutions_institution_idx" ON "candidate_institutions" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_institutions_inst_dept_idx" ON "candidate_institutions" USING btree ("institution_id","department_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_tier_idx" ON "jobs" USING btree ("tier","tier_expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_applied_at_idx" ON "applications" USING btree ("applied_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_status_updated_at_idx" ON "applications" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_candidate_id_idx" ON "applications" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_job_id_idx" ON "applications" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_candidate_status_idx" ON "applications" USING btree ("candidate_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_job_status_idx" ON "applications" USING btree ("job_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "applications_job_candidate_uniq" ON "applications" USING btree ("job_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pw_token_unique" ON "password_setup_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_reg_user_idx" ON "pending_registrations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" USING btree ("expire");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_role_perm_role_idx" ON "admin_role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_roles_scope_idx" ON "admin_roles" USING btree ("scope");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_roles_employer_idx" ON "admin_roles" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_roles_institution_idx" ON "admin_roles" USING btree ("institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_roles_admin_scope_name_unique" ON "admin_roles" USING btree ("name") WHERE "admin_roles"."scope" = 'admin';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_roles_employer_scope_name_unique" ON "admin_roles" USING btree ("employer_id","name") WHERE "admin_roles"."scope" = 'employer';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_roles_institution_scope_name_unique" ON "admin_roles" USING btree ("institution_id","name") WHERE "admin_roles"."scope" = 'institution';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notif_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notif_user_unread_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inst_sub_by_institution_idx" ON "institution_subscriptions" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "emp_sub_by_employer_idx" ON "employer_subscriptions" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_tier_payments_job_idx" ON "job_tier_payments" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_tier_payments_employer_idx" ON "job_tier_payments" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sponsored_pushes_job_idx" ON "sponsored_job_pushes" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sponsored_pushes_cand_at_idx" ON "sponsored_job_pushes" USING btree ("candidate_id","pushed_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sponsored_pushes_job_cand_uniq" ON "sponsored_job_pushes" USING btree ("job_id","candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interview_invites_application_idx" ON "interview_invites" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interview_invites_employer_idx" ON "interview_invites" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interview_invites_status_idx" ON "interview_invites" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interview_time_slots_invite_idx" ON "interview_time_slots" USING btree ("invite_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "profile_view_notif_uniq" ON "profile_view_notifications" USING btree ("candidate_id","employer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_views_candidate_idx" ON "profile_views" USING btree ("candidate_id","viewed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_views_viewer_idx" ON "profile_views" USING btree ("viewer_user_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cand_ref_token_unique" ON "candidate_references" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cand_ref_cand_idx" ON "candidate_references" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cand_skill_cand_idx" ON "candidate_skill_verifications" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cand_skill_inst_idx" ON "candidate_skill_verifications" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_history_app_idx" ON "application_status_history" USING btree ("application_id","changed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_search_cand_idx" ON "candidate_saved_searches" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_digest_unique" ON "candidate_weekly_digests" USING btree ("candidate_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_request_cache_candidate_kind_key_uniq" ON "ai_request_cache" USING btree ("candidate_id","kind","key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_request_cache_candidate_created_idx" ON "ai_request_cache" USING btree ("candidate_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employer_message_template_name_idx" ON "employer_message_templates" USING btree ("employer_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employer_outreach_sent_idx" ON "employer_outreach_messages" USING btree ("employer_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employer_talent_pool_member_unique" ON "employer_talent_pool_members" USING btree ("pool_id","candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employer_talent_pool_member_pool_idx" ON "employer_talent_pool_members" USING btree ("pool_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employer_talent_pool_name_idx" ON "employer_talent_pools" USING btree ("employer_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_cohort_member_unique" ON "candidate_cohort_members" USING btree ("cohort_id","candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_cohort_member_cohort_idx" ON "candidate_cohort_members" USING btree ("cohort_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_cohort_member_candidate_idx" ON "candidate_cohort_members" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_cohort_inst_idx" ON "candidate_cohorts" USING btree ("institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_cohort_inst_year_idx" ON "candidate_cohorts" USING btree ("institution_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employer_review_unique" ON "employer_reviews" USING btree ("employer_id","candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employer_review_employer_status_idx" ON "employer_reviews" USING btree ("employer_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employer_review_status_idx" ON "employer_reviews" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mentorship_pair_unique" ON "mentorship_requests" USING btree ("requester_candidate_id","mentor_candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentorship_mentor_idx" ON "mentorship_requests" USING btree ("mentor_candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentorship_requester_idx" ON "mentorship_requests" USING btree ("requester_candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "placement_story_status_idx" ON "placement_stories" USING btree ("status","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_dismissed_job_unique" ON "candidate_dismissed_jobs" USING btree ("candidate_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expo_push_token_unique" ON "expo_push_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expo_push_user_idx" ON "expo_push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_prefs_user_unique" ON "notification_prefs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_interviews_candidate_job_idx" ON "mock_interviews" USING btree ("candidate_id","job_id","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mock_interviews_one_in_progress_per_job" ON "mock_interviews" USING btree ("candidate_id","job_id") WHERE status = 'in_progress';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_endorsement_unique" ON "application_endorsements" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_endorsement_inst_idx" ON "application_endorsements" USING btree ("institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "application_challenges_candidate_job_uniq" ON "application_challenges" USING btree ("candidate_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "application_challenges_application_uniq" ON "application_challenges" USING btree ("application_id") WHERE "application_challenges"."application_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "challenge_templates_skill_idx" ON "challenge_templates" USING btree ("skill");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_challenges_job_id_uniq" ON "job_challenges" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_open_windows_candidate_closes_idx" ON "candidate_open_windows" USING btree ("candidate_id","closes_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reverse_offers_candidate_status_idx" ON "reverse_offers" USING btree ("candidate_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reverse_offers_employer_created_idx" ON "reverse_offers" USING btree ("employer_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alumni_intro_alumni_idx" ON "alumni_intro_requests" USING btree ("alumni_user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alumni_intro_candidate_job_idx" ON "alumni_intro_requests" USING btree ("candidate_id","job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alumni_intro_candidate_alumni_idx" ON "alumni_intro_requests" USING btree ("candidate_id","alumni_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_log_user_idx" ON "whatsapp_message_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_log_created_idx" ON "whatsapp_message_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "growth_reping_pair_idx" ON "candidate_growth_repings" USING btree ("candidate_id","employer_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "growth_reping_quarter_unique_idx" ON "candidate_growth_repings" USING btree ("candidate_id","employer_id","quarter_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_growth_skills_unique_idx" ON "candidate_growth_skills" USING btree ("candidate_id","skill");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_growth_skills_status_idx" ON "candidate_growth_skills" USING btree ("candidate_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sla_breaches_employer_idx" ON "employer_sla_breaches" USING btree ("employer_id","breached_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sla_breaches_application_uq" ON "employer_sla_breaches" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employer_daily_deck_unique" ON "employer_daily_decks" USING btree ("employer_id","deck_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employer_dismissed_per_job_unique" ON "employer_dismissed_candidates" USING btree ("employer_id","candidate_id","job_id") WHERE "employer_dismissed_candidates"."job_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employer_dismissed_per_employer_unique" ON "employer_dismissed_candidates" USING btree ("employer_id","candidate_id") WHERE "employer_dismissed_candidates"."job_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employer_dismissed_employer_idx" ON "employer_dismissed_candidates" USING btree ("employer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "institution_api_keys_institution_idx" ON "institution_api_keys" USING btree ("institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_provider_event_id_idx" ON "webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_ref_unique" ON "payments" USING btree ("provider","external_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_purpose_idx" ON "payments" USING btree ("purpose_type","purpose_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments" USING btree ("status");