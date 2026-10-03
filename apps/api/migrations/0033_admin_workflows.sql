CREATE TABLE IF NOT EXISTS enterprise.sync_diff (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id),
  run_id text NOT NULL REFERENCES enterprise.sync_run(id),
  entity_type text NOT NULL,
  external_id text NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('create', 'update', 'disable', 'delete')),
  before jsonb,
  after jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  decided_by text REFERENCES enterprise_auth."user"(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_diff_org_status ON enterprise.sync_diff (organization_id, status, created_at);

CREATE TABLE IF NOT EXISTS enterprise.sync_rollback (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id),
  source_run_id text NOT NULL REFERENCES enterprise.sync_run(id),
  compensating_run_id text REFERENCES enterprise.sync_run(id),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'completed', 'failed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  requested_by text NOT NULL REFERENCES enterprise_auth."user"(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_rollback_org_time ON enterprise.sync_rollback (organization_id, created_at);

CREATE TABLE IF NOT EXISTS enterprise.identity_field_mapping (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id),
  provider_id text NOT NULL REFERENCES enterprise.identity_provider(id) ON DELETE CASCADE,
  source_field text NOT NULL,
  target_field text NOT NULL,
  transform text NOT NULL DEFAULT 'direct',
  required boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, source_field)
);

CREATE TABLE IF NOT EXISTS enterprise.identity_login_failure (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id),
  provider_id text REFERENCES enterprise.identity_provider(id) ON DELETE SET NULL,
  subject_hint text NOT NULL,
  reason_code text NOT NULL,
  ip_hash text,
  detail jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS identity_login_failure_org_time ON enterprise.identity_login_failure (organization_id, occurred_at);

CREATE TABLE IF NOT EXISTS enterprise.session_approval (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id),
  session_id text NOT NULL REFERENCES enterprise.conversation(id),
  requester_id text NOT NULL REFERENCES enterprise_auth."user"(id),
  action text NOT NULL CHECK (action IN ('read', 'export', 'share')),
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  decided_by text REFERENCES enterprise_auth."user"(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS session_approval_org_status ON enterprise.session_approval (organization_id, status, created_at);

ALTER TABLE enterprise.sync_diff ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.sync_diff FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_diff_tenant_scope ON enterprise.sync_diff
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true));
ALTER TABLE enterprise.sync_rollback ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.sync_rollback FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_rollback_tenant_scope ON enterprise.sync_rollback
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true));
ALTER TABLE enterprise.identity_field_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.identity_field_mapping FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_field_mapping_tenant_scope ON enterprise.identity_field_mapping
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true));
ALTER TABLE enterprise.identity_login_failure ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.identity_login_failure FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_login_failure_tenant_scope ON enterprise.identity_login_failure
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true));
ALTER TABLE enterprise.session_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.session_approval FORCE ROW LEVEL SECURITY;
CREATE POLICY session_approval_tenant_scope ON enterprise.session_approval
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true));
