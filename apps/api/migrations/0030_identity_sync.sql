CREATE TABLE IF NOT EXISTS enterprise.identity_provider (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id),
  name text NOT NULL,
  protocol text NOT NULL,
  issuer text,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
CREATE TABLE IF NOT EXISTS enterprise.sync_script (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id),
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  approved_by text REFERENCES enterprise_auth.user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name, version)
);
CREATE TABLE IF NOT EXISTS enterprise.sync_run (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id),
  script_id text NOT NULL REFERENCES enterprise.sync_script(id),
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  preview jsonb NOT NULL DEFAULT '{}',
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
