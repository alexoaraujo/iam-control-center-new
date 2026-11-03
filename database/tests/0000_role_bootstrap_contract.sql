-- CI contract checks for database/bootstrap/0000_iam_roles.sql.
-- Run with a disposable PostgreSQL 18 administrator connection.
\set ON_ERROR_STOP on

DO $role_contract$
DECLARE
  r record;
BEGIN
  FOR r IN
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
      INTO STRICT r
      FROM pg_roles
     WHERE rolname = r.role_name;

    IF r.rolcanlogin IS DISTINCT FROM r.can_login
       OR r.rolinherit IS DISTINCT FROM r.can_inherit
       OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
       OR r.rolreplication OR r.rolbypassrls
       OR r.rolpassword IS NOT NULL THEN
      RAISE EXCEPTION 'role % violates the least-privilege bootstrap contract', r.role_name;
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
      JOIN pg_roles granted_role ON granted_role.oid = m.roleid
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
