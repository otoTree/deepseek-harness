ALTER TABLE "enterprise"."plugin_installation"
  ADD COLUMN IF NOT EXISTS "plugin_id" text DEFAULT '';
ALTER TABLE "enterprise"."plugin_installation" DISABLE ROW LEVEL SECURITY;
UPDATE "enterprise"."plugin_installation" i
SET "plugin_id" = r."plugin_id"
FROM "enterprise"."plugin_release" r
WHERE i."release_id" = r."id" AND i."plugin_id" IS NULL;
DELETE FROM "enterprise"."plugin_installation" WHERE "plugin_id" = '';
ALTER TABLE "enterprise"."plugin_installation" ALTER COLUMN "plugin_id" SET NOT NULL;
ALTER TABLE "enterprise"."plugin_installation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enterprise"."plugin_installation" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "enterprise"."plugin_installation"
  ADD COLUMN IF NOT EXISTS "cleanup_state" text DEFAULT 'none' NOT NULL;
ALTER TABLE "enterprise"."plugin_device_activation"
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone;
ALTER TABLE "enterprise"."plugin_device_activation"
  ADD COLUMN IF NOT EXISTS "cleanup_state" text DEFAULT 'none' NOT NULL;
ALTER TABLE "enterprise"."plugin_operation"
  ADD COLUMN IF NOT EXISTS "retryable" boolean DEFAULT true NOT NULL;
ALTER TABLE "enterprise"."plugin_operation"
  ADD COLUMN IF NOT EXISTS "recovery_action" text;
--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, account_id, plugin_id
    ORDER BY (uninstalled_at IS NULL) DESC, (desired_state = 'enabled') DESC, created_at ASC, id ASC
  ) AS rank
  FROM "enterprise"."plugin_installation"
  WHERE owner_kind = 'personal'
), duplicates AS (SELECT id FROM ranked WHERE rank > 1)
UPDATE "enterprise"."plugin_activation" a
SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP), stopped_at = COALESCE(stopped_at, CURRENT_TIMESTAMP)
WHERE a.installation_id IN (SELECT id FROM duplicates);
--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, account_id, plugin_id
    ORDER BY (uninstalled_at IS NULL) DESC, (desired_state = 'enabled') DESC, created_at ASC, id ASC
  ) AS rank
  FROM "enterprise"."plugin_installation"
  WHERE owner_kind = 'personal'
), duplicates AS (SELECT id FROM ranked WHERE rank > 1)
DELETE FROM "enterprise"."plugin_installation" WHERE id IN (SELECT id FROM duplicates);
--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, plugin_id
    ORDER BY (uninstalled_at IS NULL) DESC, (desired_state = 'enabled') DESC, created_at ASC, id ASC
  ) AS rank
  FROM "enterprise"."plugin_installation"
  WHERE owner_kind = 'organization'
), duplicates AS (SELECT id FROM ranked WHERE rank > 1)
UPDATE "enterprise"."plugin_activation" a
SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP), stopped_at = COALESCE(stopped_at, CURRENT_TIMESTAMP)
WHERE a.installation_id IN (SELECT id FROM duplicates);
--> statement-breakpoint
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, plugin_id
    ORDER BY (uninstalled_at IS NULL) DESC, (desired_state = 'enabled') DESC, created_at ASC, id ASC
  ) AS rank
  FROM "enterprise"."plugin_installation"
  WHERE owner_kind = 'organization'
), duplicates AS (SELECT id FROM ranked WHERE rank > 1)
DELETE FROM "enterprise"."plugin_installation" WHERE id IN (SELECT id FROM duplicates);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_installation_personal_owner_plugin"
  ON "enterprise"."plugin_installation" (organization_id, account_id, plugin_id)
  WHERE owner_kind = 'personal';
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_installation_organization_plugin"
  ON "enterprise"."plugin_installation" (organization_id, plugin_id)
  WHERE owner_kind = 'organization';
CREATE INDEX IF NOT EXISTS "plugin_device_activation_lease"
  ON "enterprise"."plugin_device_activation" (organization_id, device_id, lease_expires_at);
