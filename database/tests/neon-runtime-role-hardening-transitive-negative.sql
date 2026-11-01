-- CI ONLY: inject a transitive administrative path in disposable PostgreSQL.
\set ON_ERROR_STOP on

GRANT runtime_membership_bridge TO iam_app_runtime WITH INHERIT TRUE, SET TRUE, ADMIN FALSE;
GRANT neon_superuser TO runtime_membership_bridge WITH INHERIT TRUE, SET TRUE, ADMIN FALSE;
SELECT 'fixture injected: runtime -> bridge -> neon_superuser' AS result;
