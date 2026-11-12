-- CI ONLY. All role/default ACL mutations and probes are rolled back.
-- Must run using PostgreSQL 18 disposable iam_schema_test as postgres after run.sh bootstrap.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'iam_schema_test'
     OR current_user <> 'postgres'
     OR current_setting('server_version_num')::int < 180000 THEN
    RAISE EXCEPTION 'refusing runtime default ACL fixture outside disposable postgres18 CI';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='iam_app_runtime_login') THEN
    RAISE EXCEPTION 'missing isolated runtime login fixture';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='iam_acl_fixture_owner') THEN
    RAISE EXCEPTION 'fixture role unexpectedly exists';
  END IF;
END
$guard$;
CREATE ROLE iam_acl_fixture_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CREATE ON SCHEMA public TO iam_acl_fixture_owner;
SET LOCAL ROLE iam_acl_fixture_owner;

-- Reproduce the six observed future grants, only within this rollback-only transaction.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO iam_app_runtime_login;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO iam_app_runtime_login;

DO $before$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n
 FROM pg_default_acl d JOIN pg_namespace ns ON ns.oid=d.defaclnamespace
 CROSS JOIN LATERAL aclexplode(d.defaclacl) a
 WHERE d.defaclrole=current_user::regrole AND ns.nspname='public'
   AND a.grantee='iam_app_runtime_login'::regrole
   AND ((d.defaclobjtype='r' AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE'))
        OR (d.defaclobjtype='S' AND a.privilege_type IN ('SELECT','USAGE')));
 IF n<>6 THEN RAISE EXCEPTION 'expected 6 future grants, found %', n; END IF;
END
$before$;

-- Candidate least-privilege fix. Future public objects owned by this owner
-- must not be auto-granted to the application login.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM iam_app_runtime_login;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, USAGE ON SEQUENCES FROM iam_app_runtime_login;

DO $after$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n
 FROM pg_default_acl d JOIN pg_namespace ns ON ns.oid=d.defaclnamespace
 CROSS JOIN LATERAL aclexplode(d.defaclacl) a
 WHERE d.defaclrole=current_user::regrole AND ns.nspname='public'
   AND a.grantee='iam_app_runtime_login'::regrole;
 IF n<>0 THEN RAISE EXCEPTION 'runtime default grants remain after candidate fix: %',n; END IF;
END
$after$;
CREATE TABLE public.iam_acl_ci_probe(id bigint);
CREATE SEQUENCE public.iam_acl_ci_sequence;
RESET ROLE;

DO $privilege_test$
BEGIN
 IF has_table_privilege('iam_app_runtime_login','public.iam_acl_ci_probe','SELECT')
    OR has_table_privilege('iam_app_runtime_login','public.iam_acl_ci_probe','INSERT')
    OR has_table_privilege('iam_app_runtime_login','public.iam_acl_ci_probe','UPDATE')
    OR has_table_privilege('iam_app_runtime_login','public.iam_acl_ci_probe','DELETE')
    OR has_sequence_privilege('iam_app_runtime_login','public.iam_acl_ci_sequence','USAGE')
    OR has_sequence_privilege('iam_app_runtime_login','public.iam_acl_ci_sequence','SELECT')
 THEN RAISE EXCEPTION 'CI future-object grants violate least privilege'; END IF;
 IF (SELECT rolinherit FROM pg_roles WHERE rolname='iam_app_runtime_login') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'fixture changed runtime inheritance unexpectedly';
 END IF;
END
$privilege_test$;
ROLLBACK;
DO $rolled_back$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='iam_acl_fixture_owner')
    OR to_regclass('public.iam_acl_ci_probe') IS NOT NULL
    OR to_regclass('public.iam_acl_ci_sequence') IS NOT NULL
 THEN RAISE EXCEPTION 'rollback left ACL test artifacts'; END IF;
END
$rolled_back$;
SELECT 'PASS: 6 future ACLs revoked in rollback-only fixture; runtime unchanged' AS result;
