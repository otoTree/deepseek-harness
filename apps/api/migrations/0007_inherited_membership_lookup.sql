ALTER TABLE enterprise.organization NO FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise.membership NO FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise.role_binding NO FORCE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION enterprise.find_membership_for_org(target_org text, target_account text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = enterprise, pg_catalog AS $$
  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id, 0 AS depth FROM organization WHERE id = target_org
    UNION ALL SELECT p.id, p.parent_id, a.depth + 1 FROM organization p JOIN ancestors a ON a.parent_id = p.id
  )
  SELECT m.id FROM membership m JOIN ancestors a ON a.id = m.organization_id
  WHERE m.account_id = target_account AND m.status = 'active' ORDER BY a.depth LIMIT 1
$$;
REVOKE ALL ON FUNCTION enterprise.find_membership_for_org(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enterprise.find_membership_for_org(text, text) TO enterprise_app;
