ALTER TABLE "enterprise"."plugin_installation" ADD COLUMN "owner_kind" text DEFAULT 'personal' NOT NULL;
--> statement-breakpoint
ALTER TABLE "enterprise"."usage" ADD COLUMN "plugin_id" text;
--> statement-breakpoint
ALTER TABLE "enterprise"."usage" ADD COLUMN "plugin_installation_id" text;
--> statement-breakpoint
ALTER TABLE "enterprise"."usage" ADD COLUMN "plugin_release_id" text;
--> statement-breakpoint
ALTER TABLE "enterprise"."usage" ADD COLUMN "plugin_call_id" text;
--> statement-breakpoint
CREATE INDEX "usage_plugin_installation" ON "enterprise"."usage" ("plugin_installation_id", "created_at");
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_installation" ADD COLUMN "data_space_id" text;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_installation" ADD COLUMN "permission_revision" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_installation" ADD COLUMN "desired_state" text DEFAULT 'disabled' NOT NULL;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_installation" ADD COLUMN "observed_state" text DEFAULT 'not-installed' NOT NULL;
--> statement-breakpoint
UPDATE "enterprise"."plugin_installation"
SET "desired_state" = CASE WHEN "enabled" THEN 'enabled' ELSE 'disabled' END,
    "observed_state" = CASE WHEN "enabled" THEN 'unknown' ELSE 'not-installed' END;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_installation" ADD COLUMN "last_error" text;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_installation" ADD COLUMN "uninstalled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_installation" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE "enterprise"."plugin_installation" SET data_space_id = id WHERE data_space_id IS NULL;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_installation" ALTER COLUMN "data_space_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_installation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enterprise"."plugin_installation" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "enterprise"."plugin_device_activation" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "enterprise"."organization"("id") ON DELETE CASCADE,
  "installation_id" text NOT NULL REFERENCES "enterprise"."plugin_installation"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL REFERENCES "enterprise_auth"."user"("id") ON DELETE CASCADE,
  "device_id" text NOT NULL,
  "target_kind" text NOT NULL,
  "desired_state" text DEFAULT 'disabled' NOT NULL,
  "observed_state" text DEFAULT 'not-installed' NOT NULL,
  "release_id" text NOT NULL REFERENCES "enterprise"."plugin_release"("id"),
  "permission_revision" integer DEFAULT 1 NOT NULL,
  "last_error" text,
  "heartbeat_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plugin_device_activation_unique" UNIQUE("installation_id", "device_id", "target_kind")
);
--> statement-breakpoint
CREATE INDEX "plugin_device_activation_account" ON "enterprise"."plugin_device_activation" ("organization_id", "account_id", "updated_at");
--> statement-breakpoint
CREATE TABLE "enterprise"."plugin_activation" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "enterprise"."organization"("id") ON DELETE CASCADE,
  "installation_id" text NOT NULL REFERENCES "enterprise"."plugin_installation"("id") ON DELETE CASCADE,
  "device_id" text NOT NULL,
  "target_kind" text NOT NULL,
  "release_id" text NOT NULL REFERENCES "enterprise"."plugin_release"("id"),
  "permission_revision" integer NOT NULL,
  "token_hash" text NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone DEFAULT now() + interval '15 minutes' NOT NULL,
  "stopped_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "plugin_activation_lookup" ON "enterprise"."plugin_activation" ("organization_id", "installation_id", "device_id");
--> statement-breakpoint
CREATE TABLE "enterprise"."plugin_operation" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "enterprise"."organization"("id") ON DELETE CASCADE,
  "installation_id" text NOT NULL REFERENCES "enterprise"."plugin_installation"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "stage" text NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plugin_operation_org_key_unique" UNIQUE("organization_id", "idempotency_key")
);
--> statement-breakpoint
CREATE INDEX "plugin_operation_installation" ON "enterprise"."plugin_operation" ("installation_id", "updated_at");
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_device_activation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enterprise"."plugin_device_activation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "enterprise"."plugin_device_activation" USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_activation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enterprise"."plugin_activation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "enterprise"."plugin_activation" USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_operation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enterprise"."plugin_operation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "enterprise"."plugin_operation" USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
