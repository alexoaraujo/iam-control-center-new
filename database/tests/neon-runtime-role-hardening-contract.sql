-- CI ONLY: contract assertion after applying the proposal to disposable PostgreSQL.
\set ON_ERROR_STOP on

DO $assert_runtime_role_contract$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['app_runtime','app_runtime_login','iam_app_runtime'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      RAISE EXCEPTION 'required role % is missing', role_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_roles
      WHERE rolname=role_name
        AND (rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)
    ) THEN
      RAISE EXCEPTION 'runtime role % retains administrative attributes', role_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN ('app_runtime','app_runtime_login','iam_app_runtime')
      AND rolcanlogin
  ) THEN
    RAISE EXCEPTION 'legacy/group runtime roles must be NOLOGIN';
  END IF;

  -- The complete transitive membership closure must never reach an admin role.
  IF EXISTS (
    WITH RECURSIVE runtime_memberships(member_oid, granted_oid) AS (
      SELECT m.member, m.roleid
      FROM pg_auth_members m
      JOIN pg_roles member_role ON member_role.oid=m.member
      WHERE member_role.rolname IN
        ('app_runtime','app_runtime_login','iam_app_runtime','iam_app_runtime_login')
      UNION
      SELECT rm.member_oid, m.roleid
      FROM runtime_memberships rm
      JOIN pg_auth_members m ON m.member=rm.granted_oid
    )
    SELECT 1
    FROM runtime_memberships rm
    JOIN pg_roles granted_role ON granted_role.oid=rm.granted_oid
    WHERE granted_role.rolname IN ('neon_superuser','iam_owner','iam_migrator')
  ) THEN
    RAISE EXCEPTION 'runtime role reaches an administrative role through direct or transitive membership';
  END IF;

  -- Exact direct-membership allowlist: only the dedicated login may belong to
  -- iam_app_runtime; all legacy/group roles must have no memberships.
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid=m.member
    JOIN pg_roles granted_role ON granted_role.oid=m.roleid
    WHERE
      (member_role.rolname IN ('app_runtime','app_runtime_login','iam_app_runtime')
       OR (member_role.rolname='iam_app_runtime_login'
           AND granted_role.rolname <> 'iam_app_runtime'))
  ) THEN
    RAISE EXCEPTION 'runtime role has a membership outside the explicit allowlist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname='iam_app_runtime_login'
      AND rolcanlogin
      AND NOT rolbypassrls
      AND NOT rolcreatedb
      AND NOT rolcreaterole
      AND NOT rolreplication
  ) THEN
    RAISE EXCEPTION 'iam_app_runtime_login must remain a least-privilege LOGIN candidate';
  END IF;

  IF NOT pg_has_role('iam_app_runtime_login','iam_app_runtime','MEMBER') THEN
    RAISE EXCEPTION 'iam_app_runtime_login must remain a member of iam_app_runtime';
  END IF;
END
$assert_runtime_role_contract$;

SELECT 'PASS: runtime direct/transitive membership allowlist and least-privilege contract hold' AS result;
