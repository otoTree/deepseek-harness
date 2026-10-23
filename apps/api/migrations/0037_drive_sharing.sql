ALTER TABLE enterprise.drive_node ADD COLUMN created_by text REFERENCES enterprise_auth."user"(id);
ALTER TABLE enterprise.drive_node ADD COLUMN sharing jsonb;
UPDATE enterprise.drive_node n SET created_by = COALESCE(
  (SELECT account_id FROM enterprise.drive_space WHERE id = n.space_id),
  (SELECT created_by FROM enterprise.drive_version WHERE node_id = n.id ORDER BY created_at, id LIMIT 1)
);
-- Preserve the audience of committed organization roots. New roots receive an explicit private policy.
UPDATE enterprise.drive_node n SET sharing = jsonb_build_object(
  'organizationId', s.organization_id, 'scope', 'organization', 'permission', 'member',
  'memberIds', '[]'::jsonb, 'departments', '[]'::jsonb
) FROM enterprise.drive_space s WHERE s.id = n.space_id AND s.kind = 'organization' AND n.parent_id IS NULL;

-- 0: denied, 1: viewer, 2: editor, 3: sharing manager. Runs with the caller's table privileges.
CREATE FUNCTION enterprise.drive_node_access(node_id text, actor_id text, tenant_id text)
RETURNS integer LANGUAGE sql STABLE AS $$
  WITH RECURSIVE lineage AS (
    SELECT n.*, 0 AS distance, ARRAY[n.id] AS visited FROM enterprise.drive_node n WHERE n.id = node_id
    UNION ALL
    SELECT p.*, child.distance + 1, child.visited || p.id
    FROM enterprise.drive_node p JOIN lineage child ON p.id = child.parent_id AND p.space_id = child.space_id
    WHERE NOT p.id = ANY(child.visited)
  ), target AS (
    SELECT n.*, s.kind AS space_kind, s.account_id, s.organization_id
    FROM lineage n JOIN enterprise.drive_space s ON s.id = n.space_id WHERE distance = 0
  ), policy AS (
    SELECT sharing FROM lineage WHERE sharing IS NOT NULL ORDER BY distance LIMIT 1
  ), departments AS (
    SELECT u.id, u.parent_id, u.id AS source FROM enterprise.org_unit u
    WHERE u.organization_id = tenant_id AND EXISTS (
      SELECT 1 FROM policy, jsonb_array_elements(sharing->'departments') d WHERE d->>'id' = u.id
    )
    UNION
    SELECT u.id, u.parent_id, d.source FROM enterprise.org_unit u JOIN departments d ON u.parent_id = d.id
    WHERE u.organization_id = tenant_id AND EXISTS (
      SELECT 1 FROM policy, jsonb_array_elements(sharing->'departments') p
      WHERE p->>'id' = d.source AND (p->>'includeDescendants')::boolean
    )
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM enterprise.membership WHERE organization_id = tenant_id AND account_id = actor_id AND status = 'active') THEN 0
    WHEN EXISTS (SELECT 1 FROM lineage WHERE distance > 0 AND deleted_at IS NOT NULL) THEN 0
    WHEN t.space_kind = 'organization' AND t.organization_id <> tenant_id THEN 0
    WHEN t.account_id = actor_id THEN 3
    WHEN t.space_kind = 'organization' AND EXISTS (
      SELECT 1 FROM enterprise.role_binding r JOIN enterprise.membership m ON m.id = r.membership_id
      WHERE m.organization_id = tenant_id AND m.account_id = actor_id AND m.status = 'active'
      AND r.unit_id IS NULL AND r.effect = 'allow' AND r.role IN ('owner', 'administrator')
    ) THEN 3
    WHEN t.space_kind = 'organization' AND t.created_by = actor_id THEN 3
    WHEN (SELECT sharing->>'organizationId' FROM policy) = tenant_id AND (
      (SELECT sharing->>'scope' FROM policy) = 'organization' OR (
        (SELECT sharing->>'scope' FROM policy) = 'selected' AND (
          EXISTS (SELECT 1 FROM policy WHERE sharing->'memberIds' ? actor_id) OR
          EXISTS (SELECT 1 FROM enterprise.unit_assignment a JOIN enterprise.membership m ON m.id = a.membership_id
            JOIN departments d ON d.id = a.unit_id WHERE m.organization_id = tenant_id
            AND m.account_id = actor_id AND m.status = 'active')
        )
      )
    ) THEN CASE WHEN (SELECT sharing->>'permission' FROM policy) = 'member' THEN 2 ELSE 1 END
    ELSE 0 END FROM target t
$$;
