CREATE FUNCTION enterprise.authorization_organizations(target_org text)
RETURNS TABLE(id text, depth integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = enterprise, pg_catalog AS $$
  WITH RECURSIVE ancestors AS (
    SELECT o.id, o.parent_id, 0 AS depth FROM organization o WHERE o.id = target_org
    UNION ALL
    SELECT p.id, p.parent_id, a.depth + 1 FROM organization p JOIN ancestors a ON a.parent_id = p.id
    WHERE EXISTS (SELECT 1 FROM enterprise_auth.deployment WHERE id = 'primary' AND mode = 'private')
  )
  SELECT a.id, a.depth FROM ancestors a
$$;
REVOKE ALL ON FUNCTION enterprise.authorization_organizations(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enterprise.authorization_organizations(text) TO enterprise_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enterprise.find_membership_for_org(target_org text, target_account text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = enterprise, pg_catalog AS $$
  SELECT m.id FROM membership m JOIN authorization_organizations(target_org) a ON a.id = m.organization_id
  WHERE m.account_id = target_account AND m.status = 'active' ORDER BY a.depth LIMIT 1
$$;
--> statement-breakpoint
DROP POLICY tenant_scope ON enterprise.membership;
CREATE POLICY tenant_scope ON enterprise.membership
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id IN (
    SELECT id FROM enterprise.authorization_organizations(current_setting('enterprise.organization_id', true))
  ))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
DROP POLICY tenant_scope ON enterprise.role_binding;
CREATE POLICY tenant_scope ON enterprise.role_binding
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id IN (
    SELECT id FROM enterprise.authorization_organizations(current_setting('enterprise.organization_id', true))
  ))
  WITH CHECK (organization_id = current_setting('enterprise.organization_id', true));
