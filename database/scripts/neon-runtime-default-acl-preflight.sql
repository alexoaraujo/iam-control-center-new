-- READ ONLY: future default ACL preflight, never a migration or DDL authorization.
WITH expected(kind, privilege) AS (
  VALUES ('r'::"char",'SELECT'::text),('r'::"char",'INSERT'),('r'::"char",'UPDATE'),
         ('r'::"char",'DELETE'),('S'::"char",'SELECT'),('S'::"char",'USAGE')
),
runtime AS (
  SELECT rolsuper,rolbypassrls,rolinherit,rolcanlogin
  FROM pg_roles WHERE rolname='iam_app_runtime_login'
),
actual AS (
  SELECT d.defaclobjtype AS kind,a.privilege_type::text AS privilege,a.is_grantable AS grantable
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid=d.defaclnamespace
  JOIN pg_roles owner_role ON owner_role.oid=d.defaclrole
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  JOIN pg_roles grantee ON grantee.oid=a.grantee
  WHERE n.nspname='public' AND owner_role.rolname='neondb_owner'
    AND grantee.rolname='iam_app_runtime_login'
),
counts AS (
 SELECT (SELECT count(*) FROM actual) AS total,
        (SELECT count(*) FROM actual a JOIN expected e ON e.kind=a.kind AND e.privilege=a.privilege WHERE NOT a.grantable) AS matched,
        (SELECT count(*) FROM actual a LEFT JOIN expected e ON e.kind=a.kind AND e.privilege=a.privilege WHERE e.kind IS NULL OR a.grantable) AS unexpected
)
SELECT current_database() AS database_name,
       current_setting('server_version_num')::integer AS server_version_num,
       (SELECT rolcanlogin FROM runtime) AS runtime_login,
       (SELECT rolinherit FROM runtime) AS runtime_inherit,
       (SELECT rolbypassrls FROM runtime) AS runtime_bypassrls,
       counts.total AS runtime_public_default_grants,
       counts.matched AS expected_future_grants,
       counts.unexpected AS unexpected_future_grants,
       CASE
         WHEN current_database() <> 'iam_database' OR current_setting('server_version_num')::integer < 180000
           THEN 'BLOCKED_UNEXPECTED_DATABASE'
         WHEN NOT EXISTS (SELECT 1 FROM runtime)
           THEN 'BLOCKED_RUNTIME_ROLE_MISSING'
         WHEN EXISTS (SELECT 1 FROM runtime WHERE rolsuper OR rolbypassrls OR NOT rolcanlogin)
           THEN 'BLOCKED_UNSAFE_RUNTIME_ROLE'
         WHEN counts.total=6 AND counts.matched=6 AND counts.unexpected=0
           THEN 'BLOCKED_SIX_FUTURE_DEFAULT_GRANTS'
         WHEN counts.total=0
           THEN 'METADATA_ONLY_NO_FUTURE_DEFAULT_GRANTS'
         ELSE 'BLOCKED_UNEXPECTED_ACL_DRIFT'
       END AS verdict
FROM counts;
