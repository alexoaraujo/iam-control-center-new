-- CI contract checks for database/bootstrap/0000_iam_roles.sql.
-- Run with a disposable PostgreSQL 18 administrator connection.
\set ON_ERROR_STOP on

DO $role_contract$
DECLARE
  expected_role record;
  actual_role record;
BEGIN
  FOR expected_role IN
    SELECT * FROM (VALUES
      ('iam_owner', false, false),
      ('iam_migrator', false, false),
      ('iam_app_runtime', false, true),
      ('iam_migrator_login', true, false),
      ('iam_app_runtime_login', true, true)
    ) AS expected(role_name, can_login, can_inherit)
  LOOP
    SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb,
           rolcreaterole, rolreplication, rolbypassrls, rolpassword
      INTO STRICT actual_role
      FROM pg_roles
     WHERE rolname = expected_role.role_name;

    IF actual_role.rolcanlogin IS DISTINCT FROM expected_role.can_login
       OR actual_role.rolinherit IS DISTINCT FROM expected_role.can_inherit
       OR actual_role.rolsuper OR actual_role.rolcreatedb OR actual_role.rolcreaterole
       OR actual_role.rolreplication OR actual_role.rolbypassrls
       OR actual_role.rolpassword IS NOT NULL THEN
      RAISE EXCEPTION 'role % violates bootstrap contract: login=% (expected %), inherit=% (expected %), superuser=%, createdb=%, createrole=%, replication=%, bypassrls=%, password_present=%', expected_role.role_name, actual_role.rolcanlogin, expected_role.can_login, actual_role.rolinherit, expected_role.can_inherit, actual_role.rolsuper, actual_role.rolcreatedb, actual_role.rolcreaterole, actual_role.rolreplication, actual_role.rolbypassrls, actual_role.rolpassword IS NOT NULL;
    END IF;
  END LOOP;
END
$role_contract$;

DO $membership_contract$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_auth_members m
      JOIN pg_roles member_role ON member_role.oid = m.member
      JOIN pg_roles granted_role ON granted_role.oid = m.roleid
     WHERE member_role.rolname = 'iam_migrator'
       AND granted_role.rolname = 'iam_owner'
       AND m.inherit_option IS FALSE
       AND m.set_option IS TRUE
       AND m.admin_option IS FALSE
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_auth_members m
      JOIN pg_roles member_role ON member_role.oid = m.member
      JOIN pg_roles granted_role ON granted_role.oid = m.roleid
     WHERE member_role.rolname = 'iam_migrator_login'
       AND granted_role.rolname = 'iam_migrator'
       AND m.inherit_option IS FALSE
       AND m.set_option IS TRUE
       AND m.admin_option IS FALSE
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_auth_members m
      JOIN pg_roles member_role ON member_role.oid = m.member
      JOIN pg_roles granted_role ON granted_role.oid = m.roleid
     WHERE member_role.rolname = 'iam_app_runtime_login'
       AND granted_role.rolname = 'iam_app_runtime'
       AND m.inherit_option IS TRUE
       AND m.set_option IS FALSE
       AND m.admin_option IS FALSE
  ) THEN
    RAISE EXCEPTION 'IAM role memberships do not match the reviewed topology';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_auth_members m
      JOIN pg_roles member_role ON member_role.oid = m.member
     WHERE member_role.rolname IN (
       'iam_owner','iam_migrator','iam_migrator_login',
       'iam_app_runtime','iam_app_runtime_login'
     )
       AND m.admin_option
  ) THEN
    RAISE EXCEPTION 'IAM bootstrap roles must not hold ADMIN OPTION memberships';
  END IF;
END
$membership_contract$;

DO $database_privileges$
BEGIN
  IF NOT has_database_privilege('iam_owner', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'iam_owner is missing the CREATE database privilege';
  END IF;
  IF NOT has_database_privilege('iam_migrator_login', current_database(), 'CONNECT')
     OR NOT has_database_privilege('iam_app_runtime_login', current_database(), 'CONNECT') THEN
    RAISE EXCEPTION 'IAM LOGIN roles are missing explicit CONNECT';
  END IF;
  IF has_database_privilege('iam_migrator_login', current_database(), 'CREATE')
     OR has_database_privilege('iam_app_runtime_login', current_database(), 'CREATE')
     OR has_database_privilege('iam_app_runtime', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'LOGIN/runtime roles must not have database CREATE';
  END IF;
END
$database_privileges$;

-- The bootstrap intentionally grants no schema/table privileges and does not
-- configure RLS policies. Migration 0001 owns schema creation; runtime remains
-- default-deny until a separately reviewed authorization design is approved.
