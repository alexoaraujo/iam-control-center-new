-- IAM G1: read-only backup / role readiness evidence, never an authorization.
-- Use only with fixed project and branch identity independently checked via Neon API.
-- Does not export personal data or pretend to prove backup recovery.
WITH app_tables AS (
  SELECT c.oid,c.relowner,c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p')
), app_schemas AS (
  SELECT oid,nspname FROM pg_namespace
  WHERE nspname IN ('iam','audit','app_private')
), facts AS (
  SELECT
    current_database() AS database_name,
    current_setting('server_version_num')::integer AS server_version_num,
    (SELECT count(*) FROM app_schemas) AS schema_count,
    (SELECT count(*) FROM app_tables) AS table_count,
    (SELECT count(*) FROM app_tables WHERE relowner=to_regrole('iam_owner')) AS owned_count,
    (SELECT count(*) FROM app_tables WHERE relforcerowsecurity) AS force_rls_count,
    (SELECT count(*) FROM pg_policies WHERE schemaname IN ('iam','audit','app_private')) AS policy_count,
    (SELECT count(*) FROM iam.schema_migrations) AS ledger_count,
    (SELECT count(*) FROM pg_roles WHERE rolname IN ('iam_migrator_login','iam_worker_login')) AS login_roles_present,
    (SELECT count(*) FROM app_tables
      WHERE has_table_privilege('iam_schema_export_reader',oid,'MAINTAIN')) AS reader_maintain_count,
    (SELECT count(*) FROM app_tables
      WHERE has_table_privilege('iam_schema_export_reader',oid,'SELECT')) AS reader_select_count,
    (SELECT count(*) FROM app_schemas
      WHERE has_schema_privilege('iam_schema_export_reader',oid,'USAGE')) AS reader_usage_count,
    (SELECT rolcanlogin FROM pg_roles WHERE rolname='iam_schema_export_reader') AS reader_can_login,
    (SELECT rolbypassrls FROM pg_roles WHERE rolname='iam_schema_export_reader') AS reader_bypass_rls,
    (SELECT rolinherit FROM pg_roles WHERE rolname='iam_app_runtime_login') AS runtime_inherit,
    (SELECT m.set_option FROM pg_auth_members m
       JOIN pg_roles r ON r.oid=m.member JOIN pg_roles g ON g.oid=m.roleid
       WHERE r.rolname='iam_app_runtime_login' AND g.rolname='iam_app_runtime') AS runtime_can_set
)
SELECT database_name,
  CASE WHEN server_version_num>=180000 AND server_version_num<190000 THEN 'PASS' ELSE 'BLOCKED' END AS pg18,
  CASE WHEN schema_count=3 AND table_count=23 AND owned_count=23
       AND force_rls_count=20 AND policy_count=41 THEN 'PASS' ELSE 'BLOCKED' END AS schema_contract,
  CASE WHEN login_roles_present=2 AND runtime_inherit=true AND runtime_can_set=false
       THEN 'PASS' ELSE 'BLOCKED' END AS source_role_contract,
  CASE WHEN reader_can_login=true AND reader_bypass_rls=false
       AND reader_select_count=0 AND reader_maintain_count=23 AND reader_usage_count=3
       THEN 'PASS' ELSE 'BLOCKED' END AS schema_export_privileges,
  'NOT_EVALUATED_NO_ARCHIVE_OR_RESTORE' AS full_data_backup_recovery,
  jsonb_build_object(
    'app_schemas',schema_count,'app_tables',table_count,'owner_iam_owner',owned_count,
    'force_rls',force_rls_count,'policies',policy_count,'ledger_rows',ledger_count,
    'required_login_roles_present',login_roles_present,
    'reader_maintain',reader_maintain_count,'reader_usage',reader_usage_count,
    'reader_select',reader_select_count,'reader_login',reader_can_login,
    'reader_bypass_rls',reader_bypass_rls,
    'runtime_inherit',runtime_inherit,'runtime_set',runtime_can_set) AS catalog_metrics
FROM facts;
