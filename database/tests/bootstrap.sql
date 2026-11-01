-- CI-only fixture. Never run against Neon or a shared database.
\set ON_ERROR_STOP on
CREATE ROLE iam_owner NOLOGIN NOBYPASSRLS;
CREATE ROLE iam_migrator NOLOGIN NOBYPASSRLS;
CREATE ROLE iam_app_runtime NOLOGIN NOBYPASSRLS;
