-- CI-only PostgreSQL 18 fixture. NEVER execute against Neon or a shared database.
\set ON_ERROR_STOP on

DO $disposable_target_guard$
BEGIN
  IF current_database() <> 'iam_role_harness' THEN
    RAISE EXCEPTION 'Refusing fixture outside database iam_role_harness; found %', current_database();
  END IF;
  IF current_setting('server_version_num')::integer < 180000
     OR current_setting('server_version_num')::integer >= 190000 THEN
    RAISE EXCEPTION 'Refusing fixture outside PostgreSQL 18; found %', current_setting('server_version');
  END IF;
  IF session_user <> 'postgres'
     OR current_setting('application_name', true) <> 'postgres18-role-security-disposable' THEN
    RAISE EXCEPTION 'Refusing fixture without disposable harness principal and application_name';
  END IF;
END
$disposable_target_guard$;

CREATE ROLE iam_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE iam_migrator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE iam_migrator_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE iam_app_runtime NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE iam_app_runtime_login LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT iam_owner TO iam_migrator WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
GRANT iam_migrator TO iam_migrator_login WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
GRANT iam_app_runtime TO iam_app_runtime_login WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
GRANT CREATE ON DATABASE iam_role_harness TO iam_owner;
CREATE SCHEMA runtime_fixture AUTHORIZATION iam_owner;
CREATE TABLE runtime_fixture.read_probe (id integer PRIMARY KEY);
INSERT INTO runtime_fixture.read_probe VALUES (1);
GRANT USAGE ON SCHEMA runtime_fixture TO iam_app_runtime;
GRANT SELECT ON runtime_fixture.read_probe TO iam_app_runtime;
