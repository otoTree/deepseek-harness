ALTER TABLE enterprise.drive_description
  ADD COLUMN IF NOT EXISTS reference jsonb;

CREATE INDEX IF NOT EXISTS drive_description_fts
  ON enterprise.drive_description USING gin (to_tsvector('simple', content));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'drive_node_parent_fk'
      AND conrelid = 'enterprise.drive_node'::regclass
  ) THEN
    ALTER TABLE enterprise.drive_node
      ADD CONSTRAINT drive_node_parent_fk
      FOREIGN KEY (parent_id) REFERENCES enterprise.drive_node(id) ON DELETE CASCADE;
  END IF;
END $$;
