CREATE TABLE IF NOT EXISTS enterprise.permission (
  id text PRIMARY KEY,
  resource text NOT NULL,
  action text NOT NULL,
  description text NOT NULL,
  platform boolean NOT NULL DEFAULT false,
  high_risk boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS enterprise.custom_role (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES enterprise.organization(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  system boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
CREATE TABLE IF NOT EXISTS enterprise.custom_role_permission (
  role_id text NOT NULL REFERENCES enterprise.custom_role(id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES enterprise.permission(id),
  PRIMARY KEY (role_id, permission_id)
);
INSERT INTO enterprise.permission (id, resource, action, description, platform, high_risk) VALUES
  ('organization.read', 'organization', 'read', 'Read organization structure', false, false),
  ('organization.manage', 'organization', 'manage', 'Create and modify organizations', true, true),
  ('member.read', 'member', 'read', 'Read members and directory records', false, false),
  ('member.manage', 'member', 'manage', 'Invite, suspend and restore members', false, true),
  ('role.manage', 'role', 'manage', 'Manage roles and permission bindings', false, true),
  ('session.read', 'session', 'read', 'Read organization session content', false, true),
  ('session.export', 'session', 'export', 'Export organization session content', false, true),
  ('model.manage', 'model', 'manage', 'Manage platform models and adapters', true, true),
  ('sandbox.manage', 'sandbox', 'manage', 'Manage cloud workspaces', false, true),
  ('audit.read', 'audit', 'read', 'Read audit records', false, true)
ON CONFLICT (id) DO NOTHING;
