\set ON_ERROR_STOP on

DO $assertions$
DECLARE
  membership record;
BEGIN
  IF current_setting('server_version_num')::integer < 180000
     OR current_setting('server_version_num')::integer >= 190000 THEN
    RAISE EXCEPTION 'Expected PostgreSQL 18; found %', current_setting('server_version');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname IN ('iam_owner', 'iam_migrator', 'iam_app_runtime')
      AND (rolcanlogin OR rolbypassrls OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'A group role has LOGIN or an elevated attribute';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname IN ('iam_migrator_login', 'iam_app_runtime_login')
      AND (NOT rolcanlogin OR rolbypassrls OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'A login role has an invalid or elevated attribute';
  END IF;

  SELECT m.inherit_option, m.set_option, m.admin_option
    INTO membership
  FROM pg_auth_members m
  JOIN pg_roles granted ON granted.oid = m.roleid
  JOIN pg_roles member ON member.oid = m.member
  WHERE granted.rolname = 'iam_owner' AND member.rolname = 'iam_migrator';
  IF NOT FOUND OR membership.inherit_option OR NOT membership.set_option OR membership.admin_option THEN
    RAISE EXCEPTION 'iam_migrator -> iam_owner membership options differ from INHERIT FALSE / SET TRUE / ADMIN FALSE';
  END IF;

  SELECT m.inherit_option, m.set_option, m.admin_option
    INTO membership
  FROM pg_auth_members m
  JOIN pg_roles granted ON granted.oid = m.roleid
  JOIN pg_roles member ON member.oid = m.member
  WHERE granted.rolname = 'iam_migrator' AND member.rolname = 'iam_migrator_login';
  IF NOT FOUND OR membership.inherit_option OR NOT membership.set_option OR membership.admin_option THEN
    RAISE EXCEPTION 'iam_migrator_login -> iam_migrator membership options are incorrect';
  END IF;

  SELECT m.inherit_option, m.set_option, m.admin_option
    INTO membership
  FROM pg_auth_members m
  JOIN pg_roles granted ON granted.oid = m.roleid
  JOIN pg_roles member ON member.oid = m.member
  WHERE granted.rolname = 'iam_app_runtime' AND member.rolname = 'iam_app_runtime_login';
  IF NOT FOUND OR NOT membership.inherit_option OR membership.set_option OR membership.admin_option THEN
    RAISE EXCEPTION 'runtime membership must be INHERIT TRUE / SET FALSE / ADMIN FALSE';
  END IF;

  IF pg_has_role('iam_migrator_login', 'iam_migrator', 'SET') IS NOT TRUE
     OR pg_has_role('iam_migrator_login', 'iam_owner', 'SET') IS NOT TRUE THEN
    RAISE EXCEPTION 'Migrator SET ROLE chain is incomplete';
  END IF;

  IF pg_has_role('iam_app_runtime_login', 'iam_owner', 'MEMBER')
     OR pg_has_role('iam_app_runtime_login', 'iam_migrator', 'MEMBER')
     OR pg_has_role('iam_app_runtime_login', 'iam_owner', 'SET')
     OR pg_has_role('iam_app_runtime_login', 'iam_migrator', 'SET')
     OR pg_has_role('iam_app_runtime_login', 'iam_app_runtime', 'SET') THEN
    RAISE EXCEPTION 'Runtime has unintended role membership or SET ROLE capability';
  END IF;

  IF NOT has_database_privilege('iam_owner', 'postgres', 'CREATE') THEN
    RAISE EXCEPTION 'iam_owner must have CREATE on the database for migration 0001';
  END IF;

  IF has_database_privilege('iam_migrator_login', 'postgres', 'CREATE') THEN
    RAISE EXCEPTION 'iam_migrator_login must not inherit database CREATE before SET ROLE';
  END IF;

  IF has_database_privilege('iam_app_runtime_login', 'postgres', 'CREATE')
     OR has_database_privilege('iam_app_runtime_login', 'postgres', 'TEMP')
     OR has_schema_privilege('iam_app_runtime_login', 'public', 'CREATE')
     OR has_schema_privilege('iam_app_runtime_login', 'bootstrap_fixture', 'CREATE')
     OR has_schema_privilege('iam_app_runtime_login', 'bootstrap_fixture', 'USAGE') THEN
    RAISE EXCEPTION 'Runtime has database/schema DDL or fixture schema access';
  END IF;

  IF has_table_privilege('iam_app_runtime_login', 'bootstrap_fixture.schema_migrations', 'SELECT')
     OR has_table_privilege('iam_app_runtime_login', 'bootstrap_fixture.schema_migrations', 'INSERT')
     OR has_table_privilege('iam_app_runtime_login', 'bootstrap_fixture.schema_migrations', 'UPDATE')
     OR has_table_privilege('iam_app_runtime_login', 'bootstrap_fixture.schema_migrations', 'DELETE')
     OR has_table_privilege('iam_app_runtime_login', 'bootstrap_fixture.schema_migrations', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Runtime has privileges on the migration ledger';
  END IF;
END
$assertions$;
