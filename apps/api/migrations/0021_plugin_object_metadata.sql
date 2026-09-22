CREATE TABLE "enterprise"."plugin_object" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "enterprise"."organization"("id") ON DELETE CASCADE,
  "installation_id" text NOT NULL REFERENCES "enterprise"."plugin_installation"("id") ON DELETE CASCADE,
  "data_space_id" text NOT NULL,
  "object_id" text NOT NULL,
  "version" text NOT NULL,
  "size" bigint NOT NULL,
  "content_type" text NOT NULL,
  "artifact_key" text NOT NULL,
  "idempotency_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "plugin_object_installation_version_unique" UNIQUE("installation_id", "object_id", "version"),
  CONSTRAINT "plugin_object_installation_idempotency_unique" UNIQUE("installation_id", "idempotency_key")
);
--> statement-breakpoint
CREATE INDEX "plugin_object_lookup" ON "enterprise"."plugin_object" ("organization_id", "data_space_id", "object_id", "created_at");
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_object" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enterprise"."plugin_object" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "enterprise"."plugin_object" USING (organization_id = current_setting('enterprise.organization_id', true)) WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
