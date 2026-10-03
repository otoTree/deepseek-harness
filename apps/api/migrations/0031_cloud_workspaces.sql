CREATE TABLE IF NOT EXISTS enterprise.workspace (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id),
  account_id text NOT NULL REFERENCES enterprise_auth."user"(id),
  name text NOT NULL,
  image text NOT NULL DEFAULT 'dsh-base',
  status text NOT NULL DEFAULT 'stopped' CHECK (status IN ('stopped', 'starting', 'running', 'failed')),
  provider text NOT NULL DEFAULT 'e2b',
  provider_id text,
  lease_id text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE INDEX IF NOT EXISTS workspace_org_status ON enterprise.workspace (organization_id, status);
ALTER TABLE enterprise.workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.workspace FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_tenant_scope ON enterprise.workspace
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true));
