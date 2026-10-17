SELECT set_config('enterprise.platform_admin', 'true', true);
CREATE TABLE enterprise_auth.model_provider (
  id text PRIMARY KEY, name text NOT NULL, enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE enterprise_auth.model_provider_version (
  provider_id text NOT NULL REFERENCES enterprise_auth.model_provider(id), version integer NOT NULL CHECK (version > 0),
  base_url text NOT NULL, secret text NOT NULL, credential_binding text NOT NULL,
  timeout_ms integer NOT NULL CHECK (timeout_ms > 0), retryable_http_statuses jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (provider_id, version)
);
ALTER TABLE enterprise_auth.model ADD COLUMN provider_id text REFERENCES enterprise_auth.model_provider(id);
ALTER TABLE enterprise_auth.model ADD COLUMN operations jsonb NOT NULL DEFAULT '["text.generate"]';
ALTER TABLE enterprise_auth.model ADD COLUMN output_modalities jsonb NOT NULL DEFAULT '["text"]';
ALTER TABLE enterprise_auth.model_adapter ADD COLUMN model_id text REFERENCES enterprise_auth.model(id);
INSERT INTO enterprise_auth.model_provider (id, name, enabled)
  SELECT id, name, enabled FROM enterprise_auth.model;
INSERT INTO enterprise_auth.model_provider_version
  (provider_id, version, base_url, secret, credential_binding, timeout_ms, retryable_http_statuses)
  SELECT id, 1, base_url, secret, id, model_call_timeout_ms, '[429,500,502,503,504]' FROM enterprise_auth.model;
UPDATE enterprise_auth.model SET provider_id = id;
INSERT INTO enterprise_auth.model_provider (id, name, enabled)
  SELECT id, public_model, enabled FROM enterprise_auth.model_adapter ON CONFLICT DO NOTHING;
INSERT INTO enterprise_auth.model_provider_version
  (provider_id, version, base_url, secret, credential_binding, timeout_ms, retryable_http_statuses)
  SELECT id, 1, configuration->>'baseUrl', secret, id, 300000, '[429,500,502,503,504]'
  FROM enterprise_auth.model_adapter ON CONFLICT DO NOTHING;
INSERT INTO enterprise_auth.model
  (id, name, base_url, upstream_model, secret, enabled, context_tokens, max_output_tokens,
   input_micros_per_million, output_micros_per_million, provider_id, operations, output_modalities)
  SELECT id, public_model, configuration->>'baseUrl', public_model, secret, enabled, 1024, 1024,
    0, 0, id, jsonb_build_array(operation), jsonb_build_array(split_part(operation, '.', 1))
  FROM enterprise_auth.model_adapter ON CONFLICT DO NOTHING;
UPDATE enterprise_auth.model_adapter SET model_id = id;
ALTER TABLE enterprise.model_task ADD COLUMN model_id text REFERENCES enterprise_auth.model(id);
ALTER TABLE enterprise.model_task ADD COLUMN engine_version integer NOT NULL DEFAULT 1;
ALTER TABLE enterprise.model_task ADD COLUMN plugin_installation_id text;
ALTER TABLE enterprise.model_task ADD COLUMN plugin_release_id text;
ALTER TABLE enterprise.model_task ADD COLUMN asset_status text NOT NULL DEFAULT 'pending'
  CHECK (asset_status IN ('pending', 'ready', 'review_required', 'not_applicable'));
ALTER TABLE enterprise.model_task ADD COLUMN asset_tracking_until timestamptz;
ALTER TABLE enterprise.model_task ADD COLUMN provider_results jsonb;
ALTER TABLE enterprise.model_task ADD COLUMN billing_basis text;
UPDATE enterprise.model_task t SET model_id = a.model_id
  FROM enterprise_auth.model_adapter a WHERE a.id = t.snapshot->>'adapterId';
CREATE TABLE enterprise.model_asset (
  id text PRIMARY KEY, organization_id text NOT NULL REFERENCES enterprise.organization(id),
  account_id text NOT NULL REFERENCES enterprise_auth."user"(id), plugin_installation_id text,
  task_id text REFERENCES enterprise.model_task(id), result_index integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'audio')), object_key text NOT NULL,
  mime_type text NOT NULL, byte_length bigint NOT NULL CHECK (byte_length > 0), checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (task_id, result_index)
);
ALTER TABLE enterprise_auth.model_provider ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_auth.model_provider FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_read ON enterprise_auth.model_provider FOR SELECT USING (true);
CREATE POLICY provider_write ON enterprise_auth.model_provider FOR ALL
  USING (current_setting('enterprise.platform_admin', true) = 'true')
  WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true');
ALTER TABLE enterprise_auth.model_provider_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_auth.model_provider_version FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_version_read ON enterprise_auth.model_provider_version FOR SELECT USING (true);
CREATE POLICY provider_version_insert ON enterprise_auth.model_provider_version FOR INSERT
  WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true');
ALTER TABLE enterprise.model_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.model_asset FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON enterprise.model_asset
  USING (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true))
  WITH CHECK (current_setting('enterprise.platform_admin', true) = 'true' OR organization_id = current_setting('enterprise.organization_id', true));

ALTER TABLE enterprise_auth.model_adapter DROP CONSTRAINT model_adapter_model_version;
CREATE UNIQUE INDEX model_adapter_identity_version ON enterprise_auth.model_adapter(model_id, operation, version);
UPDATE enterprise.model_task SET asset_status = 'not_applicable' WHERE status IN ('succeeded','failed','cancelled');
CREATE VIEW enterprise.model_usage WITH (security_invoker = true) AS
  SELECT u.* FROM enterprise.usage u
  UNION ALL
  SELECT (jsonb_populate_record(NULL::enterprise.usage, jsonb_build_object(
    'id', t.id, 'organization_id', t.organization_id, 'account_id', t.account_id,
    'runtime_id', t.runtime_id, 'plugin_installation_id', t.plugin_installation_id,
    'plugin_release_id', t.plugin_release_id, 'plugin_call_id', t.idempotency_key,
    'model_id', t.model_id, 'purpose', 'media_generation', 'reserved_micros', 0,
    'actual_micros', 0, 'billed_micros', 0, 'input_tokens', 0, 'cached_input_tokens', 0,
    'uncached_input_tokens', 0, 'output_tokens', tokens.quantity, 'reasoning_tokens', 0,
    'total_tokens', tokens.quantity, 'protocol', 'media-task', 'input_modalities',
    jsonb_build_array('text', split_part(t.operation, '.', 1)),
    'file_upload_count', 0, 'uploaded_bytes', 0, 'file_upload_failures', 0,
    'reconciliation_reason', t.review_reason, 'failure_reason', t.error->>'code',
    'currency', 'CNY', 'pricing_version', t.adapter_version, 'total_cost_micros_cny', t.final_micros_cny,
    'request_started_at', t.created_at, 'upstream_request_id', t.provider_task_id,
    'status', CASE WHEN t.settled_at IS NOT NULL THEN 'settled' ELSE 'pending_reconciliation' END,
    'idempotency_key', t.idempotency_key, 'created_at', t.created_at, 'settled_at', t.settled_at
  ))).* FROM enterprise.model_task t
  LEFT JOIN LATERAL (SELECT coalesce(sum(CASE WHEN i->>'unit' = 'token' AND i->>'quantity' ~ '^[0-9]+$'
    THEN (i->>'quantity')::numeric ELSE 0 END), 0)::bigint AS quantity
    FROM jsonb_array_elements(coalesce(t.usage->'items', '[]'::jsonb)) i) tokens ON true;
