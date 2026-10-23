ALTER TABLE enterprise.subscription DROP CONSTRAINT subscription_nonnegative;
ALTER TABLE enterprise.subscription DROP COLUMN runtimes;
ALTER TABLE enterprise.subscription ADD CONSTRAINT subscription_nonnegative
  CHECK (budget_micros >= 0 AND spent_micros >= 0 AND reserved_micros >= 0 AND seats > 0);
--> statement-breakpoint
ALTER TABLE enterprise.runtime RENAME COLUMN lease_until TO expires_at;
--> statement-breakpoint
DROP FUNCTION enterprise_auth.resolve_runtime_token(text);
CREATE FUNCTION enterprise_auth.resolve_runtime_token(p_token_hash text)
RETURNS TABLE(id text, organization_id text, account_id text, email text, expires_at timestamptz, revoked_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, enterprise AS $$
  SELECT runtime.id, runtime.organization_id, runtime.account_id, account.email, runtime.expires_at, runtime.revoked_at
  FROM enterprise.runtime
  JOIN enterprise_auth."user" account ON account.id = runtime.account_id
  WHERE runtime.token_hash = p_token_hash
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION enterprise_auth.resolve_runtime_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enterprise_auth.resolve_runtime_token(text) TO enterprise_app;
