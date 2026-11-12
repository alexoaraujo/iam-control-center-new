-- PEOS: read-only, fail-closed metadata preflight for a future OPERATOR-APPROVED action.
-- This is NOT a migration or authorization to apply any persistent Neon DDL.
-- Target identity (project_id / branch_id) MUST be verified by the caller using
-- the Neon control plane; PostgreSQL cannot independently prove Neon branch ID.
-- Expected fingerprint is intentionally pinned to the reviewed 2026-11-12
-- NEW Development snapshot. Any drift blocks the proposed ACL change.
WITH expected(kind, privilege) AS (
 VALUES ('r'::"char", 'SELECT'::text),
        ('r'::"char", 'INSERT'),
        ('r'::"char", 'UPDATE'),
        ('r'::"char", 'DELETE'),
        ('S'::"char", 'SELECT'),
        ('S'::"char", 'USAGE')
),
runtime AS (
 SELECT oid,rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
 FROM pg_roles WHERE rolname='iam_app_runtime_login'
),
target_acl AS (
 SELECT d.defaclobjtype AS kind, a.privilege_type::text AS privilege,
        a.is_grantable AS grantable
 FROM pg_default_acl d
 JOIN pg_namespace n ON n.oid=d.defaclnamespace
 JOIN pg_roles owner_role ON owner_role.oid=d.defaclrole
 CROSS JOIN LATERAL aclexplode(d.defaclacl) a
 JOIN runtime rt ON rt.oid=a.grantee
 WHERE n.nspname='public' AND owner_role.rolname='neondb_owner'
),
acl_counts AS (
 SELECT count(*) AS total,
        count(*) FILTER (WHERE e.kind IS NOT NULL AND NOT a.grantable) AS matching,
        count(*) FILTER (WHERE e.kind IS NULL OR a.grantable) AS unexpected
 FROM target_acl a LEFT JOIN expected e ON e.kind=a.kind AND e.privilege=a.privilege
),
public_other_owner AS (
 SELECT count(*) AS count
 FROM pg_default_acl d
 JOIN pg_namespace n ON n.oid=d.defaclnamespace
 JOIN pg_roles owner_role ON owner_role.oid=d.defaclrole
 CROSS JOIN LATERAL aclexplode(d.defaclacl) a
 JOIN runtime rt ON rt.oid=a.grantee
 WHERE n.nspname='public' AND owner_role.rolname<>'neondb_owner'
),
public_objects AS (
 SELECT count(*) AS count
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m')
),
application_objects AS (
 SELECT count(*) AS count,
        count(*) FILTER (WHERE pg_get_userbyid(c.relowner)<>'iam_owner') AS foreign_owned,
        count(*) FILTER (WHERE c.relforcerowsecurity) AS force_rls
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('iam','audit','app_private')
   AND c.relkind IN ('r','p','S','v','m')
),
policies AS (
 SELECT count(*) AS count
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('iam','audit','app_private')
),
ledger AS (SELECT count(*) AS count FROM iam.schema_migrations),
membership AS (
 SELECT count(*) AS count
 FROM pg_auth_members m
 JOIN pg_roles parent ON parent.oid=m.roleid
 JOIN runtime rt ON rt.oid=m.member
 WHERE parent.rolname='iam_app_runtime' AND m.inherit_option AND NOT m.set_option AND NOT m.admin_option
),
details AS (
 SELECT current_database() AS db, current_user AS session_role,
 current_setting('server_version_num')::integer AS pg_version,
 (SELECT rolcanlogin FROM runtime) AS runtime_login,
 (SELECT rolinherit FROM runtime) AS runtime_inherit,
 (SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication FROM runtime) AS runtime_unsafe,
 has_database_privilege('iam_app_runtime_login',current_database(),'CREATE') AS runtime_database_create,
 has_database_privilege('iam_app_runtime_login',current_database(),'TEMP') AS runtime_temp,
 has_schema_privilege('iam_app_runtime_login','public','CREATE') AS runtime_public_create,
 acl_counts.total AS future_acl_count,
 acl_counts.matching AS expected_acl_count,
 acl_counts.unexpected AS unexpected_acl_count,
 public_other_owner.count AS other_owner_public_acl,
 public_objects.count AS public_object_count,
 application_objects.count AS application_object_count,
 application_objects.foreign_owned AS foreign_owned_application_objects,
 application_objects.force_rls AS force_rls_count,
 policies.count AS policy_count,
 ledger.count AS ledger_rows,
 membership.count AS expected_runtime_memberships
 FROM acl_counts,public_other_owner,public_objects,application_objects,policies,ledger,membership
)
SELECT jsonb_build_object(
 'format','iam-neon-dev-acl-preflight/v1',
 'database',db,'sql_role',session_role,'server_version_num',pg_version,
 'runtime_login',runtime_login,'runtime_inherit',runtime_inherit,
 'runtime_unsafe',runtime_unsafe,'runtime_database_create',runtime_database_create,
 'runtime_temp',runtime_temp,'runtime_public_create',runtime_public_create,
 'future_acl_count',future_acl_count,'expected_acl_count',expected_acl_count,
 'unexpected_acl_count',unexpected_acl_count,
 'other_owner_public_acl',other_owner_public_acl,
 'public_object_count',public_object_count,
 'application_object_count',application_object_count,
 'foreign_owned_application_objects',foreign_owned_application_objects,
 'force_rls_count',force_rls_count,'policy_count',policy_count,
 'ledger_rows',ledger_rows,
 'expected_runtime_memberships',expected_runtime_memberships,
 'verdict', CASE
   WHEN db<>'iam_database' OR session_role<>'neondb_owner' OR pg_version<180000
       THEN 'BLOCKED_WRONG_CONTEXT'
   WHEN runtime_login IS DISTINCT FROM TRUE
      OR runtime_inherit IS DISTINCT FROM TRUE
      OR runtime_unsafe IS DISTINCT FROM FALSE
      OR runtime_database_create IS DISTINCT FROM FALSE
      OR runtime_temp IS DISTINCT FROM FALSE
      OR runtime_public_create IS DISTINCT FROM FALSE
      OR expected_runtime_memberships<>1
       THEN 'BLOCKED_UNSAFE_RUNTIME_ROLE'
   WHEN future_acl_count<>6 OR expected_acl_count<>6 OR unexpected_acl_count<>0
      OR other_owner_public_acl<>0
       THEN 'BLOCKED_UNEXPECTED_FUTURE_ACLS'
   WHEN public_object_count<>0 OR application_object_count<>27
      OR foreign_owned_application_objects<>0 OR force_rls_count<>20
      OR policy_count<>41 OR ledger_rows<>0
       THEN 'BLOCKED_BASELINE_DRIFT'
   ELSE 'PRECHECK_MATCH_REVIEW_REQUIRED'
 END
) AS acl_promotion_preflight
FROM details;
