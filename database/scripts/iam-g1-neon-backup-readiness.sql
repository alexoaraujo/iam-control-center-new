-- IAM G1: read-only backup / role readiness evidence, never an authorization.
-- Use only with fixed project and branch identity independently checked via Neon API.
-- Does not export personal data or pretend to prove backup recovery.
WITH app_tables AS (
  SELECT c.oid,c.relowner,c.relrowsecurity,c.relforcerowsecurity
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
    (SELECT count(*) FROM app_tables WHERE relrowsecurity AND relforcerowsecurity) AS force_rls_count,
    (SELECT count(*) FROM pg_policies WHERE schemaname IN ('iam','audit','app_private')) AS policy_count,
    (SELECT count(*) FROM iam.schema_migrations) AS ledger_count,
    (SELECT count(*) FROM pg_roles WHERE rolname IN ('iam_migrator_login','iam_worker_login')) AS login_roles_present,
    (SELECT count(*) FROM pg_roles WHERE
       rolname IN ('iam_app_runtime_login','iam_migrator_login','iam_worker_login')
       AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb
       AND NOT rolcreaterole AND NOT rolreplication
       AND rolinherit = (rolname='iam_app_runtime_login')) AS canonical_login_role_count,
    (SELECT count(*) FROM pg_auth_members m
       JOIN pg_roles member ON member.oid=m.member
       WHERE member.rolname IN ('iam_app_runtime_login','iam_migrator_login','iam_worker_login'))
       AS login_membership_count,
    (SELECT count(*) FROM pg_auth_members m
       JOIN pg_roles member ON member.oid=m.member
       JOIN pg_roles granted ON granted.oid=m.roleid
       WHERE (member.rolname='iam_app_runtime_login'
              AND granted.rolname='iam_app_runtime'
              AND m.inherit_option AND NOT m.set_option AND NOT m.admin_option)
          OR (member.rolname='iam_migrator_login'
              AND granted.rolname='iam_migrator'
              AND NOT m.inherit_option AND m.set_option AND NOT m.admin_option)
          OR (member.rolname='iam_worker_login'
              AND granted.rolname='iam_worker'
              AND m.inherit_option AND m.set_option AND NOT m.admin_option))
       AS canonical_login_membership_count,
    (SELECT count(*) FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member
       WHERE member.rolname='iam_migrator') AS migrator_membership_count,
    (SELECT count(*) FROM pg_auth_members m
       JOIN pg_roles member ON member.oid=m.member
       JOIN pg_roles granted ON granted.oid=m.roleid
       WHERE member.rolname='iam_migrator' AND granted.rolname='iam_owner'
         AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option)
       AS canonical_migrator_membership_count,
    (SELECT count(*) FROM app_tables
      WHERE has_table_privilege('iam_schema_export_reader',oid,'MAINTAIN')) AS reader_maintain_count,
    (SELECT count(*) FROM app_tables
      WHERE has_table_privilege('iam_schema_export_reader',oid,'SELECT')) AS reader_select_count,
    (SELECT count(*) FROM app_tables WHERE
      has_table_privilege('iam_schema_export_reader',oid,'INSERT') OR
      has_table_privilege('iam_schema_export_reader',oid,'UPDATE') OR
      has_table_privilege('iam_schema_export_reader',oid,'DELETE') OR
      has_table_privilege('iam_schema_export_reader',oid,'TRUNCATE') OR
      has_table_privilege('iam_schema_export_reader',oid,'REFERENCES') OR
      has_table_privilege('iam_schema_export_reader',oid,'TRIGGER')) AS reader_write_count,
    (SELECT count(*) FROM app_schemas
      WHERE has_schema_privilege('iam_schema_export_reader',oid,'USAGE')) AS reader_usage_count,
    (SELECT count(*) FROM app_schemas
      WHERE has_schema_privilege('iam_schema_export_reader',oid,'CREATE')) AS reader_schema_create_count,
    (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
      WHERE r.rolname='iam_schema_export_reader') AS reader_membership_count,
    (SELECT rolcanlogin FROM pg_roles WHERE rolname='iam_schema_export_reader') AS reader_can_login,
    (SELECT rolbypassrls FROM pg_roles WHERE rolname='iam_schema_export_reader') AS reader_bypass_rls,
    (SELECT count(*) FROM pg_roles WHERE rolname='iam_schema_export_reader'
       AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit))
       AS reader_excess_role_attributes,
    (SELECT rolinherit FROM pg_roles WHERE rolname='iam_app_runtime_login') AS runtime_inherit,
    (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
       WHERE r.rolname='iam_app_runtime_login') AS runtime_membership_count,
    (SELECT m.inherit_option FROM pg_auth_members m
       JOIN pg_roles r ON r.oid=m.member JOIN pg_roles g ON g.oid=m.roleid
       WHERE r.rolname='iam_app_runtime_login' AND g.rolname='iam_app_runtime') AS runtime_member_inherit,
    (SELECT m.admin_option FROM pg_auth_members m
       JOIN pg_roles r ON r.oid=m.member JOIN pg_roles g ON g.oid=m.roleid
       WHERE r.rolname='iam_app_runtime_login' AND g.rolname='iam_app_runtime') AS runtime_member_admin,
    (SELECT m.set_option FROM pg_auth_members m
       JOIN pg_roles r ON r.oid=m.member JOIN pg_roles g ON g.oid=m.roleid
       WHERE r.rolname='iam_app_runtime_login' AND g.rolname='iam_app_runtime') AS runtime_can_set
)
SELECT database_name,
  CASE WHEN server_version_num>=180000 AND server_version_num<190000 THEN 'PASS' ELSE 'BLOCKED' END AS pg18,
  CASE WHEN schema_count=3 AND table_count=23 AND owned_count=23
       AND force_rls_count=20 AND policy_count=41 THEN 'PASS' ELSE 'BLOCKED' END AS schema_contract,
  CASE WHEN login_roles_present=2 AND canonical_login_role_count=3
       AND login_membership_count=3 AND canonical_login_membership_count=3
       AND migrator_membership_count=1 AND canonical_migrator_membership_count=1
       AND runtime_inherit IS TRUE
       AND runtime_membership_count=1 AND runtime_member_inherit IS TRUE
       AND runtime_member_admin IS FALSE AND runtime_can_set IS FALSE
       THEN 'PASS' ELSE 'BLOCKED' END AS source_role_contract,
  CASE WHEN reader_can_login IS TRUE AND reader_bypass_rls IS FALSE
       AND reader_excess_role_attributes=0
       AND reader_select_count=0 AND reader_write_count=0 AND reader_schema_create_count=0
       AND reader_membership_count=0 AND reader_maintain_count=23 AND reader_usage_count=3
       THEN 'PASS' ELSE 'BLOCKED' END AS schema_export_privileges,
  'NOT_EVALUATED_NO_ARCHIVE_OR_RESTORE' AS full_data_backup_recovery,
  jsonb_build_object(
    'app_schemas',schema_count,'app_tables',table_count,'owner_iam_owner',owned_count,
    'force_rls',force_rls_count,'policies',policy_count,'ledger_rows',ledger_count,
    'required_login_roles_present',login_roles_present,
    'canonical_login_role_count',canonical_login_role_count,
    'login_memberships',login_membership_count,
    'canonical_login_memberships',canonical_login_membership_count,
    'migrator_memberships',migrator_membership_count,
    'canonical_migrator_memberships',canonical_migrator_membership_count,
    'reader_maintain',reader_maintain_count,'reader_usage',reader_usage_count,
    'reader_select',reader_select_count,'reader_write',reader_write_count,
    'reader_schema_create',reader_schema_create_count,'reader_memberships',reader_membership_count,
    'reader_excess_role_attributes',reader_excess_role_attributes,
    'reader_login',reader_can_login,
    'reader_bypass_rls',reader_bypass_rls,
    'runtime_inherit',runtime_inherit,'runtime_member_inherit',runtime_member_inherit,
    'runtime_membership_count',runtime_membership_count,'runtime_admin',runtime_member_admin,
    'runtime_set',runtime_can_set) AS catalog_metrics
FROM facts;
