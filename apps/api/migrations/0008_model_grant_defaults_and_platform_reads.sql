ALTER TABLE enterprise.model_grant ADD COLUMN priority integer NOT NULL DEFAULT 100;
ALTER TABLE enterprise.model_grant ADD COLUMN is_default boolean NOT NULL DEFAULT false;
ALTER TABLE enterprise.model_grant ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE enterprise.model_grant ADD CONSTRAINT model_grant_priority_positive CHECK (priority > 0);
CREATE UNIQUE INDEX model_grant_one_default_per_org ON enterprise.model_grant (organization_id) WHERE is_default = true AND enabled = true;

DROP POLICY IF EXISTS tenant_scope ON enterprise.org_unit;
CREATE POLICY tenant_scope ON enterprise.org_unit
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
DROP POLICY IF EXISTS tenant_scope ON enterprise.unit_assignment;
CREATE POLICY tenant_scope ON enterprise.unit_assignment
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
DROP POLICY IF EXISTS tenant_scope ON enterprise.subscription;
CREATE POLICY tenant_scope ON enterprise.subscription
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
DROP POLICY IF EXISTS tenant_scope ON enterprise.model_grant;
CREATE POLICY tenant_scope ON enterprise.model_grant
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
DROP POLICY IF EXISTS tenant_scope ON enterprise.usage;
CREATE POLICY tenant_scope ON enterprise.usage
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
DROP POLICY IF EXISTS tenant_scope ON enterprise.conversation;
CREATE POLICY tenant_scope ON enterprise.conversation
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
DROP POLICY IF EXISTS tenant_scope ON enterprise.session_event;
CREATE POLICY tenant_scope ON enterprise.session_event
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
DROP POLICY IF EXISTS tenant_scope ON enterprise.plugin_release;
CREATE POLICY tenant_scope ON enterprise.plugin_release
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
DROP POLICY IF EXISTS tenant_scope ON enterprise.runtime;
CREATE POLICY tenant_scope ON enterprise.runtime
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
