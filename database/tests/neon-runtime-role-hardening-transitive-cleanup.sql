-- CI ONLY: cleanup for the transitive membership negative control.
\set ON_ERROR_STOP on
REVOKE neon_superuser FROM runtime_membership_bridge;
REVOKE runtime_membership_bridge FROM iam_app_runtime;
SELECT 'PASS: transitive membership fixture cleaned up' AS result;
