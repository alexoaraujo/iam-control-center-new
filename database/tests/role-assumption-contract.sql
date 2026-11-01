-- CI-only contract test. Disposable PostgreSQL 18 only; never run against Neon.
\set ON_ERROR_STOP on

CREATE ROLE iam_migrator_login LOGIN NOINHERIT NOBYPASSRLS;

GRANT iam_owner TO iam_migrator
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
GRANT iam_migrator TO iam_migrator_login
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;

DO $assert_role_attributes$
DECLARE membership record;
BEGIN
  IF (SELECT NOT rolcanlogin OR rolinherit OR rolbypassrls
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
  IF NOT has_database_privilege('iam_owner',current_database(),'CREATE') THEN
    RAISE EXCEPTION 'iam_owner must have CREATE on the target database';
  END IF;

  SELECT m.admin_option,m.inherit_option,m.set_option INTO membership
  FROM pg_auth_members m
  JOIN pg_roles member_role ON member_role.oid=m.member
  JOIN pg_roles granted_role ON granted_role.oid=m.roleid
  WHERE member_role.rolname='iam_migrator' AND granted_role.rolname='iam_owner';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'iam_migrator -> iam_owner membership is missing';
  END IF;
  IF membership.admin_option OR membership.inherit_option OR NOT membership.set_option THEN
    RAISE EXCEPTION 'iam_migrator -> iam_owner membership must be ADMIN FALSE, INHERIT FALSE, SET TRUE';
  END IF;

  SELECT m.admin_option,m.inherit_option,m.set_option INTO membership
  FROM pg_auth_members m
  JOIN pg_roles member_role ON member_role.oid=m.member
  JOIN pg_roles granted_role ON granted_role.oid=m.roleid
  WHERE member_role.rolname='iam_migrator_login' AND granted_role.rolname='iam_migrator';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'iam_migrator_login -> iam_migrator membership is missing';
  END IF;
  IF membership.admin_option OR membership.inherit_option OR NOT membership.set_option THEN
    RAISE EXCEPTION 'iam_migrator_login -> iam_migrator membership must be ADMIN FALSE, INHERIT FALSE, SET TRUE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid=m.member
    JOIN pg_roles granted_role ON granted_role.oid=m.roleid
    WHERE member_role.rolname='iam_migrator_login' AND granted_role.rolname='iam_owner'
  ) THEN
    RAISE EXCEPTION 'migrator login must use the intermediary iam_migrator role';
  END IF;
  IF pg_has_role('iam_migrator_login','iam_owner','USAGE') THEN
    RAISE EXCEPTION 'migrator login must not inherit owner privileges';
  END IF;
  IF pg_has_role('iam_app_runtime','iam_owner','MEMBER')
     OR pg_has_role('iam_app_runtime','iam_migrator','MEMBER') THEN
    RAISE EXCEPTION 'runtime must not be a member of owner or migrator';
  END IF;
END $assert_role_attributes$;

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
