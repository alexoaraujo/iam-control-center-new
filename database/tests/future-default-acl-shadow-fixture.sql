-- PostgreSQL 18 CI ONLY: demonstrate defaults that a schema-local REVOKE
-- cannot remove. All role/ACL edits are rolled back. No Neon credentials.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'iam_schema_test' OR current_user<>'postgres'
     OR current_setting('server_version_num')::integer <180000
 THEN RAISE EXCEPTION 'refuse future-default ACL shadow test outside isolated PG18 CI'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='iam_acl_shadow_fixture_owner')
 THEN RAISE EXCEPTION 'shadow owner already exists: fail closed'; END IF;
END
$guard$;
CREATE ROLE iam_acl_shadow_fixture_owner NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
-- Three distinct future privileges reaching the runtime:
-- 1. Owner-wide grant that IN SCHEMA REVOKE cannot cancel;
-- 2. An inherited application role;
-- 3. Everyone (PUBLIC).
ALTER DEFAULT PRIVILEGES FOR ROLE iam_acl_shadow_fixture_owner
 GRANT SELECT ON TABLES TO iam_app_runtime_login;
ALTER DEFAULT PRIVILEGES FOR ROLE iam_acl_shadow_fixture_owner IN SCHEMA public
 GRANT SELECT ON TABLES TO iam_app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE iam_acl_shadow_fixture_owner IN SCHEMA public
 GRANT SELECT ON TABLES TO PUBLIC;
DO $test_before$
DECLARE total int; global_login int; group_role int; public_any int;
BEGIN
 SELECT count(*),
 count(*) FILTER (WHERE d.defaclnamespace=0 AND a.grantee='iam_app_runtime_login'::regrole),
 count(*) FILTER (WHERE n.nspname='public' AND a.grantee='iam_app_runtime'::regrole),
 count(*) FILTER (WHERE n.nspname='public' AND a.grantee=0)
 INTO total,global_login,group_role,public_any
 FROM pg_default_acl d
 LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
 CROSS JOIN LATERAL aclexplode(d.defaclacl) a
 WHERE d.defaclrole='iam_acl_shadow_fixture_owner'::regrole
 AND d.defaclobjtype='r'::"char"
 AND (d.defaclnamespace=0 OR n.nspname='public')
 AND a.privilege_type='SELECT';
 IF total<>3 OR global_login<>1 OR group_role<>1 OR public_any<>1
 THEN RAISE EXCEPTION 'expected three shadow-grant paths: %, %, %, %',
 total,global_login,group_role,public_any; END IF;
END
$test_before$;
-- A local revoke of the login is insufficient to close the three indirect paths.
ALTER DEFAULT PRIVILEGES FOR ROLE iam_acl_shadow_fixture_owner IN SCHEMA public
 REVOKE SELECT ON TABLES FROM iam_app_runtime_login;
DO $test_after$
DECLARE total int;
BEGIN
 SELECT count(*) INTO total
 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
 CROSS JOIN LATERAL aclexplode(d.defaclacl) a
 WHERE d.defaclrole='iam_acl_shadow_fixture_owner'::regrole
 AND d.defaclobjtype='r'::"char"
 AND (d.defaclnamespace=0 OR n.nspname='public')
 AND a.privilege_type='SELECT'
 AND (a.grantee=0 OR a.grantee IN
       ('iam_app_runtime_login'::regrole,'iam_app_runtime'::regrole));
 IF total<>3
 THEN RAISE EXCEPTION 'unexpected shadow ACLs after ineffective schema-local REVOKE: %',total;END IF;
END
$test_after$;
ROLLBACK;
DO $post_rollback$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='iam_acl_shadow_fixture_owner')
 THEN RAISE EXCEPTION 'shadow fixture owner survived ROLLBACK'; END IF;
END
$post_rollback$;
SELECT 'PASS: globally granted, inherited-group and PUBLIC defaults survive schema-local REVOKE; rollback complete' AS result;
