-- CI ONLY: create a disposable fixture that reproduces the observed unsafe roles.
-- This must never be pointed at a Neon branch or any persistent database.
\set ON_ERROR_STOP on

DO $create_fixture_roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='neon_superuser') THEN
    CREATE ROLE neon_superuser NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_runtime_login') THEN
    CREATE ROLE app_runtime_login NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='iam_app_runtime_login') THEN
    CREATE ROLE iam_app_runtime_login LOGIN NOBYPASSRLS;
  END IF;
END
$create_fixture_roles$;

ALTER ROLE app_runtime LOGIN CREATEDB CREATEROLE REPLICATION BYPASSRLS;
ALTER ROLE app_runtime_login LOGIN CREATEDB CREATEROLE REPLICATION BYPASSRLS;
GRANT neon_superuser TO app_runtime;
GRANT neon_superuser TO app_runtime_login;
GRANT iam_app_runtime TO iam_app_runtime_login;
