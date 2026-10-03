ALTER TABLE enterprise.organization ADD COLUMN IF NOT EXISTS depth integer NOT NULL DEFAULT 0;
ALTER TABLE enterprise.organization ADD COLUMN IF NOT EXISTS path text NOT NULL DEFAULT '';

WITH RECURSIVE tree AS (
  SELECT id, parent_id, id::text AS path, 0 AS depth
  FROM enterprise.organization
  WHERE parent_id IS NULL
  UNION ALL
  SELECT child.id, child.parent_id, tree.path || '/' || child.id::text, tree.depth + 1
  FROM enterprise.organization child
  JOIN tree ON tree.id = child.parent_id
)
UPDATE enterprise.organization AS organization
SET path = tree.path, depth = tree.depth
FROM tree
WHERE organization.id = tree.id;

CREATE INDEX IF NOT EXISTS organization_path_idx ON enterprise.organization(path text_pattern_ops);
CREATE INDEX IF NOT EXISTS organization_parent_idx ON enterprise.organization(parent_id, created_at);
