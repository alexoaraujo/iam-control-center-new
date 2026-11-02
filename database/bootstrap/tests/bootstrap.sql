\set ON_ERROR_STOP on

DO $version$
BEGIN
  IF current_setting('server_version_num')::integer < 180000
     OR current_setting('server_version_num')::integer >= 190000 THEN
    RAISE EXCEPTION 'Expected PostgreSQL 18; found %', current_setting('server_version');
  END IF;
END
$version$;

-- Test-only roles. No passwords and no Neon connection are used.
CREATE ROLE iam_owner
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE iam_migrator
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE iam_migrator_login
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE iam_app_runtime
  NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE iam_app_runtime_login
  LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT iam_owner TO iam_migrator
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
GRANT iam_migrator TO iam_migrator_login
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
GRANT iam_app_runtime TO iam_app_runtime_login
  WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;

REVOKE CREATE, TEMPORARY ON DATABASE postgres FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON DATABASE postgres TO iam_owner;

CREATE SCHEMA bootstrap_fixture AUTHORIZATION iam_owner;
REVOKE ALL ON SCHEMA bootstrap_fixture FROM PUBLIC;

SET ROLE iam_owner;
CREATE TABLE bootstrap_fixture.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO bootstrap_fixture.schema_migrations(version) VALUES ('fixture-001');
RESET ROLE;

REVOKE ALL ON TABLE bootstrap_fixture.schema_migrations FROM PUBLIC;
