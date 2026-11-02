-- PROPOSAL ONLY — do not execute against Neon until separately approved.
-- Target: Development branch, database "Iam-control-center".
-- Expected administrative login: "Iam-control-center_owner".
-- The Neon provider-managed administrator must match the observed Development
-- attributes and neon_superuser membership. This is a bootstrap-only exception.
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

  IF current_user <> session_user THEN
    RAISE EXCEPTION 'Unexpected effective role: current_user % differs from session_user %',
      current_user, session_user;
  END IF;

  SELECT * INTO v_admin
    FROM pg_catalog.pg_roles
   WHERE rolname = session_user;

  IF NOT FOUND
     OR NOT v_admin.rolcanlogin
     OR NOT v_admin.rolinherit
     OR v_admin.rolsuper
     OR NOT v_admin.rolcreatedb
     OR NOT v_admin.rolcreaterole
     OR NOT v_admin.rolreplication
     OR NOT v_admin.rolbypassrls THEN
    RAISE EXCEPTION
      'Administrative principal does not match the observed Neon Development bootstrap profile';
  END IF;

  -- Require the exact provider-managed membership observed on Development.
  -- Do not accept a generic CREATEROLE login as a substitute administrator.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = m.roleid
      JOIN pg_catalog.pg_roles member_role ON member_role.oid = m.member
     WHERE granted_role.rolname = 'neon_superuser'
       AND member_role.rolname = session_user
       AND m.admin_option IS FALSE
       AND m.inherit_option IS TRUE
       AND m.set_option IS TRUE
  ) THEN
    RAISE EXCEPTION
      'Expected exact membership in neon_superuser (ADMIN FALSE, INHERIT TRUE, SET TRUE)';
  END IF;

  IF NOT pg_catalog.pg_has_role(session_user, 'neon_superuser', 'SET') THEN
    RAISE EXCEPTION 'Administrative principal cannot SET ROLE neon_superuser as observed';
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

-- TEMPORARY remains granted to PUBLIC by the existing database ACL.
-- Do not change this shared ACL in the role bootstrap: the consumer inventory
-- is incomplete. Runtime credentials must not be activated until a separate,
-- reviewed ACL decision removes or narrowly replaces this privilege.

GRANT CREATE ON DATABASE "Iam-control-center" TO iam_owner;

COMMIT;
