ALTER TABLE enterprise.subscription ADD COLUMN expires_at timestamptz;
ALTER TABLE enterprise.organization ADD COLUMN resource_policy jsonb;
ALTER TABLE enterprise.membership ADD COLUMN budget jsonb NOT NULL DEFAULT '{"mode":"inherit"}';
ALTER TABLE enterprise.membership ADD COLUMN storage_limit_bytes bigint CHECK (storage_limit_bytes >= 0);
ALTER TABLE enterprise.invitation ADD COLUMN delivery_status text NOT NULL DEFAULT 'pending'
  CHECK (delivery_status IN ('pending', 'sent', 'failed'));
ALTER TABLE enterprise_auth.model ADD COLUMN audience jsonb NOT NULL DEFAULT '{"mode":"all","organizationIds":[]}';
ALTER TABLE enterprise_auth.model ADD COLUMN publication_revision integer NOT NULL DEFAULT 1 CHECK (publication_revision > 0);
ALTER TABLE enterprise.model_task DROP CONSTRAINT model_task_billing_status_check;
ALTER TABLE enterprise.model_task ADD CONSTRAINT model_task_billing_status_valid
  CHECK (billing_status IN ('pending', 'reserved', 'awaiting_usage', 'settled', 'partially_collected', 'review_required'));
CREATE TABLE enterprise.billing_attribution (
  id text PRIMARY KEY, organization_id text NOT NULL REFERENCES enterprise.organization(id),
  account_id text NOT NULL REFERENCES enterprise_auth."user"(id), membership_id text NOT NULL,
  month text NOT NULL, time_zone text NOT NULL, department_ids jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_attribution_member_month ON enterprise.billing_attribution(organization_id, account_id, month);
ALTER TABLE enterprise.billing_attribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.billing_attribution FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON enterprise.billing_attribution
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
GRANT SELECT, INSERT ON enterprise.billing_attribution TO enterprise_app;
REVOKE UPDATE, DELETE ON enterprise.billing_attribution FROM enterprise_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enterprise.authorization_organizations(target_org text)
RETURNS TABLE(id text, depth integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = enterprise, pg_catalog AS $$
  SELECT o.id, 0 FROM organization o WHERE o.id = target_org
$$;
INSERT INTO enterprise.permission (id, resource, action, description, platform, high_risk) VALUES
  ('budget.manage', 'budget', 'manage', 'Manage member budgets', false, true),
  ('billing.read', 'billing', 'read', 'Read team billing', false, false),
  ('storage.manage', 'storage', 'manage', 'Manage team storage and handovers', false, true),
  ('plugin.manage', 'plugin', 'manage', 'Manage team plugins', false, true),
  ('plugin.publish', 'plugin', 'publish', 'Publish team plugins', false, true),
  ('plugin.review', 'plugin', 'review', 'Review and revoke team plugins', false, true)
ON CONFLICT (id) DO NOTHING;

--> statement-breakpoint
ALTER TABLE enterprise.drive_node ADD COLUMN purge_requested_at timestamptz;
CREATE TABLE enterprise.drive_cleanup (
  id text PRIMARY KEY, organization_id text NOT NULL REFERENCES enterprise.organization(id),
  object_key text NOT NULL UNIQUE, version_id text, upload_id text, node_id text, error text,
  last_attempt_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE enterprise.drive_cleanup ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.drive_cleanup FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON enterprise.drive_cleanup
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON enterprise.drive_cleanup TO enterprise_app;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION enterprise.drive_node_access(node_id text, actor_id text, tenant_id text)
RETURNS integer LANGUAGE sql STABLE AS $$
  WITH RECURSIVE lineage AS (
    SELECT n.*, 0 AS distance, ARRAY[n.id] AS visited FROM enterprise.drive_node n WHERE n.id = node_id
    UNION ALL
    SELECT p.*, child.distance + 1, child.visited || p.id
    FROM enterprise.drive_node p JOIN lineage child ON p.id = child.parent_id AND p.space_id = child.space_id
    WHERE NOT p.id = ANY(child.visited)
  ), target AS (
    SELECT n.*, s.kind AS space_kind, s.account_id, s.organization_id
    FROM lineage n JOIN enterprise.drive_space s ON s.id = n.space_id WHERE distance = 0
  ), policy AS (
    SELECT sharing FROM lineage WHERE sharing IS NOT NULL ORDER BY distance LIMIT 1
  ), departments AS (
    SELECT u.id, u.parent_id, u.id AS source FROM enterprise.org_unit u
    WHERE u.organization_id = tenant_id AND EXISTS (
      SELECT 1 FROM policy, jsonb_array_elements(sharing->'departments') d WHERE d->>'id' = u.id
    )
    UNION
    SELECT u.id, u.parent_id, d.source FROM enterprise.org_unit u JOIN departments d ON u.parent_id = d.id
    WHERE u.organization_id = tenant_id AND EXISTS (
      SELECT 1 FROM policy, jsonb_array_elements(sharing->'departments') p
      WHERE p->>'id' = d.source AND (p->>'includeDescendants')::boolean
    )
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM enterprise.membership WHERE organization_id = tenant_id AND account_id = actor_id AND status = 'active') THEN 0
    WHEN EXISTS (SELECT 1 FROM lineage WHERE distance > 0 AND deleted_at IS NOT NULL) THEN 0
    WHEN t.organization_id IS DISTINCT FROM tenant_id THEN 0
    WHEN t.account_id = actor_id THEN 3
    WHEN t.space_kind = 'organization' AND t.created_by = actor_id THEN 3
    WHEN (SELECT sharing->>'organizationId' FROM policy) = tenant_id AND (
      (SELECT sharing->>'scope' FROM policy) = 'organization' OR (
        (SELECT sharing->>'scope' FROM policy) = 'selected' AND (
          EXISTS (SELECT 1 FROM policy WHERE sharing->'memberIds' ? actor_id) OR
          EXISTS (SELECT 1 FROM enterprise.unit_assignment a JOIN enterprise.membership m ON m.id = a.membership_id
            JOIN departments d ON d.id = a.unit_id WHERE m.organization_id = tenant_id
            AND m.account_id = actor_id AND m.status = 'active')
        )
      )
    ) THEN CASE WHEN (SELECT sharing->>'permission' FROM policy) = 'member' THEN 2 ELSE 1 END
    ELSE 0 END FROM target t
$$;

ALTER TABLE enterprise.organization ADD COLUMN next_budget_time_zone text;
ALTER TABLE enterprise.organization ADD COLUMN next_budget_time_zone_at timestamptz;

ALTER TABLE enterprise.drive_space ADD COLUMN custodian_account_id text REFERENCES enterprise_auth."user"(id);
CREATE TABLE enterprise.handover (
  id text PRIMARY KEY, organization_id text NOT NULL REFERENCES enterprise.organization(id),
  membership_id text NOT NULL REFERENCES enterprise.membership(id), target_membership_id text NOT NULL REFERENCES enterprise.membership(id),
  reason text NOT NULL, created_by text NOT NULL REFERENCES enterprise_auth."user"(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE enterprise.handover ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.handover FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON enterprise.handover
  USING (organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
GRANT SELECT, INSERT ON enterprise.handover TO enterprise_app;

INSERT INTO enterprise.permission (id, resource, action, description, platform, high_risk) VALUES
  ('model.use', 'model', 'use', 'Execute published team models', false, false),
  ('storage.write', 'storage', 'write', 'Create team-funded files', false, false)
ON CONFLICT (id) DO NOTHING;
ALTER TABLE enterprise.wallet_ledger DROP CONSTRAINT wallet_ledger_kind_valid;
ALTER TABLE enterprise.wallet_ledger ADD CONSTRAINT wallet_ledger_kind_valid CHECK (
  (kind = 'redemption_credit' AND amount_micros_cny > 0 AND redemption_code_id IS NOT NULL AND usage_id IS NULL)
  OR (kind = 'model_usage_debit' AND amount_micros_cny <= 0 AND usage_id IS NOT NULL AND redemption_code_id IS NULL)
  OR (kind = 'manual_adjustment' AND amount_micros_cny <> 0 AND usage_id IS NULL AND redemption_code_id IS NULL)
);

ALTER TABLE enterprise.model_task ADD COLUMN cancel_requested_at timestamptz;
ALTER TABLE enterprise.model_task ADD COLUMN cancel_attempted_at timestamptz;

ALTER TABLE enterprise.model_asset ADD COLUMN expires_at timestamptz;
ALTER TABLE enterprise.drive_cleanup ADD COLUMN asset_id text;

ALTER TABLE enterprise.drive_upload ADD COLUMN base_version_id text;
ALTER TABLE enterprise.drive_upload ADD COLUMN staging_cleanup_at timestamptz;
ALTER TABLE enterprise.drive_upload ADD COLUMN import_request jsonb;

ALTER TABLE enterprise.identity_provider ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE POLICY account_recovery_read ON enterprise.runtime FOR SELECT USING (
  current_setting('enterprise.platform_admin', true) = 'true'
  AND account_id = current_setting('enterprise.account_recovery_id', true)
);
CREATE POLICY account_recovery_revoke ON enterprise.runtime FOR UPDATE USING (
  current_setting('enterprise.platform_admin', true) = 'true'
  AND account_id = current_setting('enterprise.account_recovery_id', true)
) WITH CHECK (
  current_setting('enterprise.platform_admin', true) = 'true'
  AND account_id = current_setting('enterprise.account_recovery_id', true)
);
