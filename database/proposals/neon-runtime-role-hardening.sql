-- PROPOSAL ONLY — NEVER EXECUTE AGAINST NEON WITHOUT SEPARATE APPROVAL.
-- Intended target after human review: Development first; Preview separately.
-- This file is exercised only against a disposable PostgreSQL database in CI.
-- Preflight the exact branch/database and inspect all role memberships first.

DO $preflight_runtime_memberships$
BEGIN
  -- Fail closed if observed direct memberships differ from the reviewed snapshot.
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid=m.member
    JOIN pg_roles granted_role ON granted_role.oid=m.roleid
    WHERE
      (member_role.rolname IN ('app_runtime','app_runtime_login')
       AND granted_role.rolname <> 'neon_superuser')
      OR (member_role.rolname IN ('iam_app_runtime','iam_app_runtime_login')
          AND NOT (member_role.rolname='iam_app_runtime_login'
                   AND granted_role.rolname='iam_app_runtime'))
  ) THEN
    RAISE EXCEPTION 'unexpected direct runtime membership; stop and review the full membership graph';
  END IF;

  -- A transitive administrative path must also stop execution.
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
    RAISE EXCEPTION 'runtime reaches an administrative role transitively; stop and review';
  END IF;
END
$preflight_runtime_memberships$;

REVOKE neon_superuser FROM app_runtime_login;
REVOKE neon_superuser FROM app_runtime;

ALTER ROLE app_runtime_login
  NOLOGIN NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

ALTER ROLE app_runtime
  NOLOGIN NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Do not DROP either legacy role. Inventory dependent grants/objects separately.
-- Do not change iam_app_runtime_login credentials or grant object/table privileges.
-- Do not alter iam_owner / iam_migrator or any Production role.
