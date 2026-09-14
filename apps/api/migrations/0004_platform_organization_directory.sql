DROP POLICY IF EXISTS organization_scope ON enterprise.organization;
CREATE POLICY organization_scope ON enterprise.organization
  USING (
    id = current_setting('enterprise.organization_id', true)
    OR current_setting('enterprise.platform_admin', true) = 'true'
  )
  WITH CHECK (id = current_setting('enterprise.organization_id', true));
