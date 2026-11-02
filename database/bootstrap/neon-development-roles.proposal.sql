-- PROPOSAL ONLY — do not execute against Neon until separately approved.
-- Target: Development branch, database "Iam-control-center".
-- Expected administrative login: "Iam-control-center_owner".
-- No passwords, secrets, application grants, schema ownership, or migrations here.

BEGIN;

DO $preflight$
DECLARE
  v_admin pg_catalog.pg_roles%ROWTYPE;
  v_db_owner name;
BEGIN
  IF current_database() <> 'Iam-control-center' THEN
    RAISE EXCEPTION 'Unexpected database: %', current_database();
  END IF;

  IF session_user <> 'Iam-control-center_owner' THEN
    RAISE EXCEPTION 'Unexpected session user: %', session_user;
  END IF;

  SELECT * INTO v_admin
    FROM pg_catalog.pg_roles
   WHERE rolname = session_user;

  IF NOT FOUND OR NOT v_admin.rolcreaterole OR v_admin.rolsuper THEN
    RAISE EXCEPTION 'Expected non-superuser CREATEROLE administrator';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(datdba)
    INTO v_db_owner
    FROM pg_catalog.pg_database
   WHERE datname = current_database();

  IF v_db_owner <> session_user THEN
    RAISE EXCEPTION 'Expected session user to own target database; owner is %', v_db_owner;
  END IF;

  IF NOT pg_catalog.has_database_privilege(session_user, current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'Administrator lacks CREATE on target database';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE rolname IN (
       'iam_owner',
       'iam_migrator',
       'iam_migrator_login',
       'iam_app_runtime',
       'iam_app_runtime_login'
     )
  ) THEN
    RAISE EXCEPTION 'At least one target IAM role already exists; refusing partial/repeated bootstrap';
  END IF;
END
$preflight$;

CREATE ROLE iam_owner
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

CREATE ROLE iam_migrator
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

CREATE ROLE iam_migrator_login
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

CREATE ROLE iam_app_runtime
  NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

CREATE ROLE iam_app_runtime_login
  LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

GRANT iam_owner TO iam_migrator
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

GRANT iam_migrator TO iam_migrator_login
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;

GRANT iam_app_runtime TO iam_app_runtime_login
  WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;

GRANT CREATE ON DATABASE "Iam-control-center" TO iam_owner;

COMMIT;
