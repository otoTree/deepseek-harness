ALTER TABLE enterprise.organization ADD COLUMN parent_id text;
ALTER TABLE enterprise.organization ADD COLUMN root_id text;
ALTER TABLE enterprise_auth.deployment ADD COLUMN root_organization_id text;
ALTER TABLE enterprise.organization DISABLE ROW LEVEL SECURITY;
UPDATE enterprise.organization SET root_id = id WHERE root_id IS NULL;
ALTER TABLE enterprise.organization ALTER COLUMN root_id SET NOT NULL;
ALTER TABLE enterprise.organization
  ADD CONSTRAINT organization_parent_fk FOREIGN KEY (parent_id) REFERENCES enterprise.organization(id);
ALTER TABLE enterprise.organization
  ADD CONSTRAINT organization_root_fk FOREIGN KEY (root_id) REFERENCES enterprise.organization(id);
ALTER TABLE enterprise.organization
  ADD CONSTRAINT organization_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id);
CREATE INDEX organization_parent_idx ON enterprise.organization(parent_id);
CREATE INDEX organization_root_idx ON enterprise.organization(root_id);
ALTER TABLE enterprise.organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.organization FORCE ROW LEVEL SECURITY;
