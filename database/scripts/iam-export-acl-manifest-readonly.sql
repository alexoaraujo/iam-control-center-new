-- Read-only PostgreSQL 18 catalog manifest. Never queries application rows.
WITH relation_acl AS (
  SELECT n.nspname AS schema_name,
         c.relname AS relation_name,
         pg_get_userbyid(c.relowner) AS owner_name,
         c.relacl::text AS raw_acl,
         COALESCE((
           SELECT jsonb_agg(
             jsonb_build_array(
               pg_get_userbyid(a.grantor),
               CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
               a.privilege_type,
               a.is_grantable
             )
             ORDER BY a.grantor, a.grantee, a.privilege_type, a.is_grantable
           )
           FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS a
         ), '[]'::jsonb) AS effective_acl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('iam', 'audit', 'app_private')
     AND c.relkind IN ('r', 'p')
)
SELECT COALESCE(jsonb_agg(
  jsonb_build_object(
    'schema', schema_name,
    'relation', relation_name,
    'owner', owner_name,
    'raw_acl', raw_acl,
    'effective_acl', effective_acl
  )
  ORDER BY schema_name, relation_name
), '[]'::jsonb) AS manifest
FROM relation_acl;
