DROP POLICY IF EXISTS tenant_scope ON enterprise.membership;
CREATE POLICY tenant_scope ON enterprise.membership
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id IN (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM enterprise.organization WHERE id = current_setting('enterprise.organization_id', true)
      UNION ALL SELECT parent.id, parent.parent_id FROM enterprise.organization parent JOIN ancestors child ON child.parent_id = parent.id
    ) SELECT id FROM ancestors
  ))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
DROP POLICY IF EXISTS tenant_scope ON enterprise.role_binding;
CREATE POLICY tenant_scope ON enterprise.role_binding
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id IN (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM enterprise.organization WHERE id = current_setting('enterprise.organization_id', true)
      UNION ALL SELECT parent.id, parent.parent_id FROM enterprise.organization parent JOIN ancestors child ON child.parent_id = parent.id
    ) SELECT id FROM ancestors
  ))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
DROP POLICY IF EXISTS tenant_scope ON enterprise.audit;
CREATE POLICY tenant_scope ON enterprise.audit
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
