ALTER TABLE enterprise.drive_upload
  ADD COLUMN IF NOT EXISTS reserved_node_id text;

UPDATE enterprise.drive_upload
SET reserved_node_id = split_part(object_key, '/', 3)
WHERE reserved_node_id IS NULL
  AND node_id IS NULL
  AND object_key LIKE 'drive/%/%/%';
