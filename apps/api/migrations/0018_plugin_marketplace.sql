ALTER TABLE "enterprise"."plugin_release" ADD COLUMN "visibility" text DEFAULT 'organization' NOT NULL;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_release" ADD COLUMN "package_format" text DEFAULT 'legacy-json' NOT NULL;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_release" ADD COLUMN "package_size" integer;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_release" ADD COLUMN "artifact_key" text;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_release" ADD COLUMN "published_at" timestamp with time zone;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_scope ON enterprise.plugin_release;
CREATE POLICY tenant_scope ON enterprise.plugin_release
USING (current_setting('enterprise.platform_admin', true) = 'true'
  OR organization_id = current_setting('enterprise.organization_id', true)
  OR (visibility = 'platform' AND status = 'published' AND revoked_at IS NULL))
WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
CREATE TABLE "enterprise"."plugin_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"release_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"target_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_installation_organization_id_account_id_release_id_unique" UNIQUE("organization_id","account_id","release_id")
);
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_installation" ADD CONSTRAINT "plugin_installation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "enterprise"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_installation" ADD CONSTRAINT "plugin_installation_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "enterprise_auth"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_installation" ADD CONSTRAINT "plugin_installation_release_id_plugin_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "enterprise"."plugin_release"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "plugin_installation_account" ON "enterprise"."plugin_installation" USING btree ("organization_id","account_id","updated_at");
--> statement-breakpoint
ALTER TABLE enterprise.plugin_installation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE enterprise.plugin_installation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_scope ON enterprise.plugin_installation
USING (organization_id = current_setting('enterprise.organization_id', true))
WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
