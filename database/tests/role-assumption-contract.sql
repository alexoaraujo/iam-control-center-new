-- CI-only contract test. Disposable PostgreSQL 18 only; never run against Neon.
\set ON_ERROR_STOP on

CREATE ROLE iam_migrator_login LOGIN NOINHERIT NOBYPASSRLS;

GRANT iam_owner TO iam_migrator
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
GRANT iam_migrator TO iam_migrator_login
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;

DO $assert_role_attributes$
BEGIN
  IF (SELECT rolcanlogin OR rolinherit OR rolbypassrls
      FROM pg_roles WHERE rolname='iam_migrator_login') THEN
    RAISE EXCEPTION 'migrator login must be LOGIN, NOINHERIT, NOBYPASSRLS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN ('iam_owner','iam_migrator','iam_app_runtime')
      AND (rolcanlogin OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'group roles must remain NOLOGIN/NOBYPASSRLS';
  END IF;
  IF pg_has_role('iam_migrator_login','iam_owner','USAGE') THEN
    RAISE EXCEPTION 'migrator login must not inherit owner privileges';
  END IF;
  IF pg_has_role('iam_app_runtime','iam_owner','MEMBER')
     OR pg_has_role('iam_app_runtime','iam_migrator','MEMBER') THEN
    RAISE EXCEPTION 'runtime must not be a member of owner or migrator';
  END IF;
END $assert_role_attributes$;

-- Simulate the authenticated dedicated login within this disposable superuser session.
-- SET SESSION AUTHORIZATION changes session_user; it does not expose a password.
SET SESSION AUTHORIZATION iam_migrator_login;
SET ROLE iam_migrator;
DO $assert_migrator_role$
BEGIN
  IF session_user <> 'iam_migrator_login' OR current_user <> 'iam_migrator' THEN
    RAISE EXCEPTION 'first role transition failed: session_user %, current_user %',
      session_user,current_user;
  END IF;
END $assert_migrator_role$;

SET ROLE iam_owner;
DO $assert_owner_role$
BEGIN
  IF session_user <> 'iam_migrator_login' OR current_user <> 'iam_owner' THEN
    RAISE EXCEPTION 'owner role transition failed: session_user %, current_user %',
      session_user,current_user;
  END IF;
  IF (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'iam_owner must not have BYPASSRLS';
  END IF;
END $assert_owner_role$;

-- This process exits after the test; no Neon connection or persistent role is touched.
