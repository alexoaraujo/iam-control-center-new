WITH expected(schema_name, table_name) AS (
  VALUES ('audit','events'), ('iam','invitations'), ('iam','membership_roles'),
         ('iam','memberships'), ('iam','role_permissions'), ('iam','roles'), ('iam','tenants')
)
SELECT current_setting('neon.project_id', true) = :'project'
   AND current_setting('neon.branch_id', true) = :'branch'
   AND current_setting('neon.endpoint_id', true) = :'endpoint'
   AND current_setting('server_version_num')::int / 10000 = 18
   AND current_setting('transaction_read_only') = 'on'
   AND current_database() = :'database' AND current_user = :'login' AND session_user = current_user
   AND pg_has_role(current_user, 'iam_app_runtime', 'USAGE')
   AND EXISTS (
       SELECT 1 FROM pg_auth_members
       WHERE member = current_user::regrole AND roleid = 'iam_app_runtime'::regrole
         AND inherit_option AND NOT admin_option AND NOT set_option
   )
   AND NOT EXISTS (
       SELECT 1 FROM pg_roles r
       WHERE pg_has_role(current_user, r.oid, 'MEMBER')
         AND (r.rolname NOT IN (:'login', 'iam_app_runtime')
              OR r.rolcanlogin <> (r.rolname = :'login') OR r.rolsuper OR r.rolbypassrls
              OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)
   )
   AND NOT EXISTS (
       SELECT 1 FROM expected e
       WHERE NOT EXISTS (
           SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = e.schema_name AND c.relname = e.table_name
             AND c.relkind IN ('r','p') AND c.relrowsecurity AND c.relforcerowsecurity
       )
   );
