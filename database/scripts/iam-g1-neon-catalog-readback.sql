-- IAM G1 — reproducible catalog-only readback, PostgreSQL 18.
-- READ ONLY. Invoke against project tiny-rice-70320263:
-- development/br-ancient-term-b6mmx5ol/iam_database, or
-- validation/br-sweet-union-b6j80a7j/iam_database, or the disposable clone.
-- NEVER use this query as permission to export rows, run DDL, or cut over.
-- Do not run on Production. Do not dump passwords, API keys or identity rows.
WITH app_schemas AS (
  SELECT oid, nspname, nspowner, nspacl FROM pg_namespace
  WHERE nspname IN ('iam', 'audit', 'app_private')
), app_tables AS (
  SELECT c.oid, n.nspname, c.relname, c.relowner,
         c.relrowsecurity, c.relforcerowsecurity, c.relacl
  FROM pg_class c
  JOIN app_schemas n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p')
)
SELECT current_database() AS database_name,
       current_user AS inspecting_role,
       (SELECT count(*) FROM app_schemas) AS schema_count,
       (SELECT count(*) FROM app_tables) AS table_count,
       (SELECT count(*) FROM pg_policies
         WHERE schemaname IN ('iam','audit','app_private')) AS policy_count,
       (SELECT count(*) FROM app_tables WHERE relforcerowsecurity) AS force_rls_count,
       (SELECT count(*) FROM iam.schema_migrations) AS ledger_row_count,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'name',rolname,'login',rolcanlogin,'inherit',rolinherit,
          'superuser',rolsuper,'bypassrls',rolbypassrls,'createrole',rolcreaterole)
          ORDER BY rolname), '[]'::jsonb)
        FROM pg_roles WHERE rolname LIKE 'iam_%') AS iam_role_attributes,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'member',member.rolname,'role',granted.rolname,
          'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option)
          ORDER BY member.rolname,granted.rolname),'[]'::jsonb)
        FROM pg_auth_members m
        JOIN pg_roles member ON member.oid=m.member
        JOIN pg_roles granted ON granted.oid=m.roleid
        WHERE member.rolname LIKE 'iam_%' OR granted.rolname LIKE 'iam_%')
        AS iam_memberships,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'name',nspname,'owner',nspowner::regrole::text,
          'acl',nspacl::text,
          'reader_usage',has_schema_privilege('iam_schema_export_reader',oid,'USAGE'),
          'reader_create',has_schema_privilege('iam_schema_export_reader',oid,'CREATE'))
          ORDER BY nspname),'[]'::jsonb)
        FROM app_schemas) AS schema_acl_inventory,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'name',nspname || '.' || relname,
          'owner',relowner::regrole::text,
          'row_security',relrowsecurity,'force_rls',relforcerowsecurity,
          'acl',relacl::text,
          'reader_maintain',has_table_privilege('iam_schema_export_reader',oid,'MAINTAIN'),
          'reader_select',has_table_privilege('iam_schema_export_reader',oid,'SELECT'))
          ORDER BY nspname,relname),'[]'::jsonb)
        FROM app_tables) AS table_acl_inventory,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'owner',defaclrole::regrole::text,
          'schema',CASE WHEN defaclnamespace=0 THEN 'global'
                        ELSE defaclnamespace::regnamespace::text END,
          'type',defaclobjtype,'acl',defaclacl::text)
          ORDER BY defaclrole::regrole::text,defaclobjtype),'[]'::jsonb)
        FROM pg_default_acl
        WHERE defaclnamespace=0
           OR defaclnamespace IN (SELECT oid FROM app_schemas))
        AS default_acl_inventory,
       (SELECT COALESCE(jsonb_agg(extname ORDER BY extname),'[]'::jsonb)
        FROM pg_extension) AS installed_extensions;
