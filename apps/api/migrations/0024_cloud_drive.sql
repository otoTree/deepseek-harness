CREATE TABLE enterprise.drive_space (
  id text PRIMARY KEY,
  organization_id text REFERENCES enterprise.organization(id) ON DELETE CASCADE,
  account_id text REFERENCES enterprise_auth."user"(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('personal', 'organization')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drive_space_owner ON enterprise.drive_space (organization_id, account_id);
CREATE TABLE enterprise.drive_node (
  id text PRIMARY KEY,
  space_id text NOT NULL REFERENCES enterprise.drive_space(id) ON DELETE CASCADE,
  parent_id text,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('folder', 'file')),
  size bigint NOT NULL DEFAULT 0,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  version_id text,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(space_id, parent_id, name)
);
CREATE INDEX drive_node_parent ON enterprise.drive_node (space_id, parent_id, updated_at, id);
ALTER TABLE enterprise.drive_node ADD CONSTRAINT drive_node_parent_fk FOREIGN KEY (parent_id) REFERENCES enterprise.drive_node(id) ON DELETE CASCADE;
CREATE TABLE enterprise.drive_version (
  id text PRIMARY KEY,
  node_id text NOT NULL REFERENCES enterprise.drive_node(id) ON DELETE CASCADE,
  size bigint NOT NULL,
  content_type text NOT NULL,
  checksum text NOT NULL,
  object_key text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE enterprise.drive_node ADD CONSTRAINT drive_node_version_fk FOREIGN KEY (version_id) REFERENCES enterprise.drive_version(id);
CREATE TABLE enterprise.drive_description (
  id text PRIMARY KEY,
  node_id text NOT NULL REFERENCES enterprise.drive_node(id) ON DELETE CASCADE,
  version_id text REFERENCES enterprise.drive_version(id),
  type text NOT NULL,
  content text NOT NULL,
  fields jsonb,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  reference jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drive_description_node ON enterprise.drive_description (node_id, status);
CREATE INDEX drive_description_fts ON enterprise.drive_description USING gin (to_tsvector('simple', content));
CREATE TABLE enterprise.drive_upload (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id) ON DELETE CASCADE,
  space_id text NOT NULL REFERENCES enterprise.drive_space(id) ON DELETE CASCADE,
  node_id text REFERENCES enterprise.drive_node(id) ON DELETE CASCADE,
  parent_id text,
  expected_name text NOT NULL,
  version_id text NOT NULL,
  object_key text NOT NULL,
  expected_size bigint NOT NULL,
  expected_content_type text NOT NULL,
  expected_checksum text,
  status text NOT NULL DEFAULT 'created',
  expires_at timestamptz NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drive_upload_expiry ON enterprise.drive_upload (status, expires_at);
CREATE TABLE enterprise.drive_edit_session (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES enterprise.drive_node(id) ON DELETE CASCADE,
  base_version_id text NOT NULL,
  account_id text NOT NULL REFERENCES enterprise_auth."user"(id),
  status text NOT NULL DEFAULT 'active',
  conflict boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX drive_edit_session_owner ON enterprise.drive_edit_session (account_id, status, expires_at);
CREATE TABLE enterprise.drive_audit (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  space_id text,
  node_id text,
  version_id text,
  description_id text,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drive_audit_lookup ON enterprise.drive_audit (organization_id, space_id, created_at, id);
