CREATE SCHEMA IF NOT EXISTS "enterprise_auth";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "enterprise";
--> statement-breakpoint
CREATE TABLE "enterprise_auth"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprise"."unit_assignment" (
	"organization_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"unit_id" text NOT NULL,
	CONSTRAINT "unit_assignment_membership_id_unit_id_pk" PRIMARY KEY("membership_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "enterprise"."audit" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprise"."conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"header" jsonb NOT NULL,
	"next_seq" integer DEFAULT 0 NOT NULL,
	"writer" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_organization_id_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth"."deployment" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"registration" text NOT NULL,
	"domains" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprise"."session_event" (
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"seq" integer NOT NULL,
	"event" jsonb NOT NULL,
	CONSTRAINT "session_event_session_id_seq_pk" PRIMARY KEY("session_id","seq")
);
--> statement-breakpoint
CREATE TABLE "enterprise"."invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"unit_id" text,
	"token_hash" text NOT NULL,
	"inviter_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "enterprise"."membership" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_organization_id_account_id_unique" UNIQUE("organization_id","account_id"),
	CONSTRAINT "membership_organization_id_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "enterprise"."model_grant" (
	"organization_id" text NOT NULL,
	"model_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "model_grant_organization_id_model_id_pk" PRIMARY KEY("organization_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth"."model" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"upstream_model" text NOT NULL,
	"secret" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"images" boolean DEFAULT false NOT NULL,
	"context_tokens" integer NOT NULL,
	"max_output_tokens" integer NOT NULL,
	"input_micros_per_million" bigint NOT NULL,
	"output_micros_per_million" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprise"."organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'team' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"policy_revision" integer DEFAULT 1 NOT NULL,
	"independent_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth"."platform_admin" (
	"account_id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprise"."plugin_release" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"submitter_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"version" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"host_code" text,
	"client_code" text,
	"digest" text NOT NULL,
	"manifest_digest" text NOT NULL,
	"permissions_digest" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"review" jsonb,
	"reviewer_id" text,
	"signature" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_release_organization_id_plugin_id_version_unique" UNIQUE("organization_id","plugin_id","version")
);
--> statement-breakpoint
CREATE TABLE "enterprise"."role_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"unit_id" text,
	"role" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprise"."runtime" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"version" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "runtime_organization_id_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "enterprise"."subscription" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'team' NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"runtimes" integer DEFAULT 2 NOT NULL,
	"budget_micros" bigint DEFAULT 0 NOT NULL,
	"spent_micros" bigint DEFAULT 0 NOT NULL,
	"reserved_micros" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "subscription_nonnegative" CHECK ("enterprise"."subscription"."budget_micros" >= 0 AND "enterprise"."subscription"."spent_micros" >= 0 AND "enterprise"."subscription"."reserved_micros" >= 0 AND "enterprise"."subscription"."seats" > 0 AND "enterprise"."subscription"."runtimes" > 0)
);
--> statement-breakpoint
CREATE TABLE "enterprise"."org_unit" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"parent_id" text,
	"unit_type" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "org_unit_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "unit_not_self" CHECK ("enterprise"."org_unit"."parent_id" IS NULL OR "enterprise"."org_unit"."parent_id" <> "enterprise"."org_unit"."id")
);
--> statement-breakpoint
CREATE TABLE "enterprise"."usage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"runtime_id" text,
	"model_id" text NOT NULL,
	"purpose" text NOT NULL,
	"reserved_micros" bigint NOT NULL,
	"actual_micros" bigint,
	"billed_micros" bigint,
	"input_tokens" integer,
	"output_tokens" integer,
	"status" text DEFAULT 'reserved' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "usage_organization_id_idempotency_key_unique" UNIQUE("organization_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "enterprise_auth"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enterprise_auth"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "enterprise_auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."unit_assignment" ADD CONSTRAINT "unit_assignment_organization_id_membership_id_membership_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "enterprise"."membership"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."unit_assignment" ADD CONSTRAINT "unit_assignment_organization_id_unit_id_org_unit_organization_id_id_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "enterprise"."org_unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."audit" ADD CONSTRAINT "audit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."conversation" ADD CONSTRAINT "conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."conversation" ADD CONSTRAINT "conversation_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "enterprise_auth"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."session_event" ADD CONSTRAINT "session_event_organization_id_session_id_conversation_organization_id_id_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "enterprise"."conversation"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "enterprise_auth"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."invitation" ADD CONSTRAINT "invitation_organization_id_unit_id_org_unit_organization_id_id_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "enterprise"."org_unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."membership" ADD CONSTRAINT "membership_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."membership" ADD CONSTRAINT "membership_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "enterprise_auth"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."model_grant" ADD CONSTRAINT "model_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."model_grant" ADD CONSTRAINT "model_grant_model_id_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "enterprise_auth"."model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth"."platform_admin" ADD CONSTRAINT "platform_admin_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "enterprise_auth"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_release" ADD CONSTRAINT "plugin_release_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."role_binding" ADD CONSTRAINT "role_binding_organization_id_membership_id_membership_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "enterprise"."membership"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."role_binding" ADD CONSTRAINT "role_binding_organization_id_unit_id_org_unit_organization_id_id_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "enterprise"."org_unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."runtime" ADD CONSTRAINT "runtime_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."runtime" ADD CONSTRAINT "runtime_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "enterprise_auth"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise_auth"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "enterprise_auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."subscription" ADD CONSTRAINT "subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."org_unit" ADD CONSTRAINT "org_unit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."org_unit" ADD CONSTRAINT "org_unit_organization_id_parent_id_org_unit_organization_id_id_fk" FOREIGN KEY ("organization_id","parent_id") REFERENCES "enterprise"."org_unit"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."usage" ADD CONSTRAINT "usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."usage" ADD CONSTRAINT "usage_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "enterprise_auth"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."usage" ADD CONSTRAINT "usage_model_id_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "enterprise_auth"."model"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enterprise"."usage" ADD CONSTRAINT "usage_organization_id_runtime_id_runtime_organization_id_id_fk" FOREIGN KEY ("organization_id","runtime_id") REFERENCES "enterprise"."runtime"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_org_time" ON "enterprise"."audit" USING btree ("organization_id","created_at");
