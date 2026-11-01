-- CI ONLY: prove the contract detector catches a transitive admin membership.
\set ON_ERROR_STOP on

GRANT runtime_membership_bridge TO iam_app_runtime WITH INHERIT TRUE, SET TRUE, ADMIN FALSE;
GRANT neon_superuser TO runtime_membership_bridge WITH INHERIT TRUE, SET TRUE, ADMIN FALSE;

DO $assert_transitive_membership_is_detected$
BEGIN
  IF NOT EXISTS (
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
    WHERE granted_role.rolname='neon_superuser'
  ) THEN
    RAISE EXCEPTION 'negative test failed: transitive admin membership was not detected';
  END IF;
END
$assert_transitive_membership_is_detected$;

REVOKE neon_superuser FROM runtime_membership_bridge;
REVOKE runtime_membership_bridge FROM iam_app_runtime;
SELECT 'PASS: transitive administrative membership was detected and removed in disposable fixture' AS result;
