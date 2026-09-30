CREATE TABLE enterprise_auth.model_adapter (
  id text PRIMARY KEY,
  public_model text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('embedding.create', 'image.generate', 'video.generate', 'audio.synthesize', 'audio.transcribe')),
  version integer NOT NULL CHECK (version > 0),
  enabled boolean NOT NULL DEFAULT false,
  secret text NOT NULL,
  configuration jsonb NOT NULL,
  prices jsonb NOT NULL,
  reserve_micros_cny bigint NOT NULL CHECK (reserve_micros_cny >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_adapter_model_version UNIQUE (public_model, operation, version)
);
CREATE INDEX model_adapter_published ON enterprise_auth.model_adapter (enabled, public_model, operation);
ALTER TABLE enterprise_auth.model_adapter ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_auth.model_adapter FORCE ROW LEVEL SECURITY;
CREATE POLICY model_adapter_read ON enterprise_auth.model_adapter
  FOR SELECT USING (enabled OR current_setting('enterprise.platform_admin', true) = 'true');
CREATE POLICY model_adapter_write ON enterprise_auth.model_adapter
  FOR ALL USING (current_setting('enterprise.platform_admin', true) = 'true')
  WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true');
--> statement-breakpoint
CREATE TABLE enterprise.model_task (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id),
  account_id text NOT NULL REFERENCES enterprise_auth."user"(id),
  runtime_id text,
  idempotency_key text NOT NULL,
  public_model text NOT NULL,
  operation text NOT NULL,
  adapter_version integer NOT NULL,
  snapshot jsonb NOT NULL,
  input jsonb NOT NULL,
  parameters jsonb NOT NULL,
  provider_task_id text,
  status text NOT NULL CHECK (status IN ('queued', 'submitting', 'processing', 'succeeded', 'failed', 'cancelled', 'unknown')),
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  usage jsonb,
  error jsonb,
  billing_status text NOT NULL CHECK (billing_status IN ('reserved', 'awaiting_usage', 'settled', 'partially_collected', 'review_required')),
  reserved_micros_cny bigint NOT NULL CHECK (reserved_micros_cny >= 0),
  final_micros_cny bigint,
  collected_micros_cny bigint NOT NULL DEFAULT 0 CHECK (collected_micros_cny >= 0),
  outstanding_micros_cny bigint NOT NULL DEFAULT 0 CHECK (outstanding_micros_cny >= 0),
  query_lease_until timestamptz,
  query_lease_token text,
  last_queried_at timestamptz,
  next_query_at timestamptz NOT NULL DEFAULT now(),
  review_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT model_task_org_idempotency UNIQUE (organization_id, idempotency_key),
  CONSTRAINT model_task_runtime_org_fk FOREIGN KEY (organization_id, runtime_id) REFERENCES enterprise.runtime(organization_id, id)
);
CREATE INDEX model_task_scan_due ON enterprise.model_task (created_at, billing_status, next_query_at, query_lease_until);
CREATE INDEX model_task_owner ON enterprise.model_task (organization_id, account_id, created_at);
ALTER TABLE enterprise.model_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.model_task FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON enterprise.model_task
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true));
--> statement-breakpoint
CREATE TABLE enterprise.model_task_ledger (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id),
  task_id text NOT NULL REFERENCES enterprise.model_task(id),
  account_id text NOT NULL REFERENCES enterprise_auth."user"(id),
  runtime_id text,
  event_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reserve', 'settle', 'release', 'charge', 'adjustment')),
  amount_micros_cny bigint NOT NULL,
  balance_after_micros_cny bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_task_ledger_event UNIQUE (task_id, event_key),
  CONSTRAINT model_task_ledger_runtime_org_fk FOREIGN KEY (organization_id, runtime_id) REFERENCES enterprise.runtime(organization_id, id)
);
CREATE INDEX model_task_ledger_org_time ON enterprise.model_task_ledger (organization_id, created_at, id);
ALTER TABLE enterprise.model_task_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.model_task_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON enterprise.model_task_ledger
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true));
REVOKE UPDATE, DELETE ON enterprise.model_task_ledger FROM enterprise_app;
