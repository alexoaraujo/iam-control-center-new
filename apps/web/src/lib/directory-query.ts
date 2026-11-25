// Static parameterized query shared with the disposable PG18 contract.
// No identifier, permission, projection or SQL fragment comes from a browser.
export const DIRECTORY_SQL = `
WITH authorized AS MATERIALIZED (
  SELECT 1
  FROM iam.identities i
  JOIN iam.memberships m ON m.identity_id = i.id
  JOIN iam.tenants t ON t.id = m.tenant_id
  JOIN pg_roles r ON r.rolname = current_user
  WHERE i.id = $2::uuid AND i.issuer = $3::text AND i.subject = $4::text
    AND m.tenant_id = $1::uuid AND m.status = 'active' AND t.status = 'active'
    AND app_private.current_tenant_id() = $1::uuid
    AND current_user = 'iam_app_runtime_login' AND session_user = current_user
    AND NOT r.rolsuper AND NOT r.rolbypassrls
    AND current_setting('neon.branch_id', true) = $7::text
    AND $5::text IN ('organizations', 'identities')
    AND EXISTS (SELECT 1 FROM iam.effective_permissions(m.id) p
      WHERE p.permission_key = CASE $5::text WHEN 'organizations' THEN 'iam.tenant.read' ELSE 'iam.identity.read' END)
    AND NOT EXISTS (SELECT 1 FROM iam.access_policies ap WHERE ap.tenant_id = m.tenant_id AND ap.enabled)
), candidates AS (
  SELECT t.id, t.display_name, t.status::text AS status
  FROM iam.tenants t
  WHERE $5::text = 'organizations' AND t.id = $1::uuid AND EXISTS (SELECT 1 FROM authorized)
  UNION ALL
  SELECT i.id, i.display_name, m.status::text AS status
  FROM iam.identities i JOIN iam.memberships m ON m.identity_id = i.id
  WHERE $5::text = 'identities' AND m.tenant_id = $1::uuid AND m.status = 'active'
    AND ($6::uuid IS NULL OR i.id > $6::uuid) AND EXISTS (SELECT 1 FROM authorized)
), page AS (SELECT * FROM candidates ORDER BY id LIMIT 51)
SELECT EXISTS (SELECT 1 FROM authorized) AS allowed,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'displayName', display_name, 'status', status) ORDER BY id) FROM page), '[]'::jsonb) AS rows
`;
