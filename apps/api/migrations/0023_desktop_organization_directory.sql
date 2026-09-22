CREATE OR REPLACE FUNCTION enterprise.list_active_organizations_for_account(target_account text)
RETURNS TABLE(id text, name text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = enterprise, pg_catalog AS $$
  SELECT o.id, o.name, o.created_at
  FROM organization o
  JOIN membership m ON m.organization_id = o.id
  WHERE m.account_id = target_account
    AND m.status = 'active'
    AND o.status = 'active'
  ORDER BY o.created_at
$$;
REVOKE ALL ON FUNCTION enterprise.list_active_organizations_for_account(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enterprise.list_active_organizations_for_account(text) TO enterprise_app;
