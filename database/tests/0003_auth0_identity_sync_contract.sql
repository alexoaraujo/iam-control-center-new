-- Migration 0003: executable PostgreSQL 18, rollback-only least-privilege test.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_user <> 'postgres' OR current_database() <> 'iam_schema_test'
     OR current_setting('server_version_num')::int < 180000 THEN
    RAISE EXCEPTION '0003 test requires disposable PostgreSQL 18 iam_schema_test';
  END IF;
  IF NOT has_function_privilege('iam_app_runtime_login',
      'iam.sync_auth0_identity(text,text,text,boolean,text,boolean,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'runtime function EXECUTE privilege missing';
  END IF;
  IF has_table_privilege('iam_app_runtime_login','iam.identities','INSERT')
    OR has_table_privilege('iam_app_runtime_login','iam.identities','UPDATE')
    OR (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname='iam_app_runtime_login') THEN
    RAISE EXCEPTION 'runtime direct write or RLS bypass detected';
  END IF;
END $guard$;

SET LOCAL ROLE iam_app_runtime_login;
DO $deny_direct$
BEGIN
  BEGIN
    INSERT INTO iam.identities(issuer,subject)
      VALUES ('https://iam-control-center.us.auth0.com/','auth0|pr42-should-deny');
    RAISE EXCEPTION 'FAIL: direct INSERT unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $deny_direct$;

-- Two-user import, replay of one user, and authenticated login update.
SELECT id FROM iam.sync_auth0_identity(
  'https://iam-control-center.us.auth0.com/','auth0|pr42-synthetic-a',
  'first@example.test',true,'Synthetic A',false,true);
SELECT id FROM iam.sync_auth0_identity(
  'https://iam-control-center.us.auth0.com/','auth0|pr42-synthetic-a',
  NULL,false,NULL,false,false);
SELECT id FROM iam.sync_auth0_identity(
  'https://iam-control-center.us.auth0.com/','auth0|pr42-synthetic-b',
  'second@example.test',false,'Synthetic B',false,true);

-- No tenant context and no membership: SELECT must remain empty.
DO $deny_reads$
BEGIN
  IF EXISTS (SELECT 1 FROM iam.identities
     WHERE subject IN ('auth0|pr42-synthetic-a','auth0|pr42-synthetic-b')) THEN
    RAISE EXCEPTION 'FAIL: cross-tenant identity visibility';
  END IF;
  BEGIN
    PERFORM id FROM iam.sync_auth0_identity(
      'https://wrong-issuer.example/','auth0|pr42-synthetic-c',
      NULL,false,NULL,true,false);
    RAISE EXCEPTION 'FAIL: issuer not restricted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM id FROM iam.sync_auth0_identity(
      'https://iam-control-center.us.auth0.com/','',
      NULL,false,NULL,true,false);
    RAISE EXCEPTION 'FAIL: empty subject accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $deny_reads$;
RESET ROLE;

DO $verify_import$
BEGIN
  IF (SELECT count(*) FROM iam.identities
      WHERE issuer='https://iam-control-center.us.auth0.com/'
        AND subject LIKE 'auth0|pr42-synthetic-%') <> 2 THEN
    RAISE EXCEPTION 'FAIL: duplicate/lost imported identities';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM iam.identities
    WHERE subject='auth0|pr42-synthetic-a'
      AND email='first@example.test' AND email_verified
      AND display_name='Synthetic A' AND last_authenticated_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL: import replay changed profile or manufactured login';
  END IF;
  IF EXISTS (SELECT 1 FROM iam.memberships m
    JOIN iam.identities i ON i.id=m.identity_id
    WHERE i.subject LIKE 'auth0|pr42-synthetic-%') THEN
    RAISE EXCEPTION 'FAIL: import created a membership';
  END IF;
END $verify_import$;

SET LOCAL ROLE iam_app_runtime_login;
SELECT id FROM iam.sync_auth0_identity(
  'https://iam-control-center.us.auth0.com/','auth0|pr42-synthetic-a',
  NULL,false,NULL,true,false);
RESET ROLE;

DO $verify_login$
BEGIN
  IF (SELECT count(*) FROM iam.identities
      WHERE subject LIKE 'auth0|pr42-synthetic-%') <> 2
     OR NOT EXISTS (SELECT 1 FROM iam.identities
      WHERE subject='auth0|pr42-synthetic-a' AND last_authenticated_at IS NOT NULL
        AND email_verified AND email='first@example.test') THEN
    RAISE EXCEPTION 'FAIL: login replay or verification preservation';
  END IF;
END $verify_login$;
ROLLBACK;

DO $verify_cleanup$
BEGIN
  IF EXISTS (SELECT 1 FROM iam.identities
     WHERE subject LIKE 'auth0|pr42-synthetic-%') THEN
    RAISE EXCEPTION 'FAIL: rollback leaked synthetic identities';
  END IF;
END $verify_cleanup$;
