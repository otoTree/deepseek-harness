ALTER TABLE enterprise.role_binding ADD COLUMN IF NOT EXISTS effect text NOT NULL DEFAULT 'allow';
ALTER TABLE enterprise.role_binding ADD CONSTRAINT role_binding_effect_valid CHECK (effect IN ('allow', 'deny'));
INSERT INTO enterprise.permission (id, resource, action, description, platform, high_risk) VALUES
  ('identity.manage', 'identity', 'manage', 'Configure identity providers', false, true),
  ('directory.sync', 'directory', 'sync', 'Run and publish directory synchronization', false, true)
ON CONFLICT (id) DO NOTHING;
