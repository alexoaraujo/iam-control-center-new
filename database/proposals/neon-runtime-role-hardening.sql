-- PROPOSAL ONLY — NEVER EXECUTE AGAINST NEON WITHOUT SEPARATE APPROVAL.
-- Intended target after human review: Development first; Preview separately.
-- This file is exercised only against a disposable PostgreSQL database in CI.
-- Preflight the exact branch/database and inspect all role memberships first.

REVOKE neon_superuser FROM app_runtime_login;
REVOKE neon_superuser FROM app_runtime;

ALTER ROLE app_runtime_login
  NOLOGIN NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

ALTER ROLE app_runtime
  NOLOGIN NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Do not DROP either legacy role. Inventory dependent grants/objects separately.
-- Do not change iam_app_runtime_login credentials or grant object/table privileges.
-- Do not alter iam_owner / iam_migrator or any Production role.
