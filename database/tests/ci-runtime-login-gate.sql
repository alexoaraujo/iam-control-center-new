-- CI-only contract: authenticate over a new PostgreSQL connection as the real
-- LOGIN principal (not by using SET ROLE in an administrator's session).
-- Only run after canonical schema restore in the disposable PostgreSQL 18
-- iam_source_restore_test database. No tenant data or secrets are stored.
DO $ci_runtime_login_gate$
DECLARE
  login_role record;
  v_tables integer;
  v_policies integer;
  v_forced integer;
  v_denied boolean := false;
BEGIN
  IF current_database() <> 'iam_source_restore_test'
     OR current_user <> 'iam_app_runtime_login'
     OR session_user <> current_user THEN
    RAISE EXCEPTION 'CI runtime test must use a direct iam_app_runtime_login session';
  END IF;
  IF current_setting('server_version_num')::integer < 180000 THEN
    RAISE EXCEPTION 'PostgreSQL 18+ is required';
  END IF;
  SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole
    INTO login_role FROM pg_roles WHERE rolname=current_user;
  IF NOT FOUND OR NOT login_role.rolcanlogin OR login_role.rolsuper
     OR login_role.rolbypassrls OR login_role.rolcreatedb
     OR login_role.rolcreaterole THEN
    RAISE EXCEPTION 'runtime role must be LOGIN, NOSUPERUSER, NOBYPASSRLS and non-admin';
  END IF;
  IF NOT has_database_privilege(current_user,current_database(),'CONNECT')
     OR has_database_privilege(current_user,current_database(),'CREATE')
     OR has_database_privilege(current_user,current_database(),'TEMP') THEN
    RAISE EXCEPTION 'runtime login must only have CONNECT at database level';
  END IF;
  IF NOT pg_has_role(current_user,'iam_app_runtime','USAGE')
     OR pg_has_role(current_user,'iam_owner','MEMBER')
     OR pg_has_role(current_user,'iam_migrator','MEMBER') THEN
    RAISE EXCEPTION 'runtime may inherit only the approved non-owner IAM role';
  END IF;
  IF NOT has_schema_privilege(current_user,'iam','USAGE')
     OR NOT has_schema_privilege(current_user,'app_private','USAGE')
     OR has_schema_privilege(current_user,'iam','CREATE')
     OR has_schema_privilege(current_user,'app_private','CREATE')
     OR has_schema_privilege(current_user,'audit','CREATE') THEN
    RAISE EXCEPTION 'unexpected runtime schema privileges';
  END IF;
  SELECT count(*) INTO v_tables
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p');
  SELECT count(*) INTO v_policies
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('iam','audit','app_private');
  SELECT count(*) INTO v_forced
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('iam','audit','app_private')
      AND c.relkind IN ('r','p') AND c.relrowsecurity AND c.relforcerowsecurity;
  IF v_tables <> 23 OR v_policies <> 41 OR v_forced <> 20 THEN
    RAISE EXCEPTION 'unexpected canonical schema RLS inventory: tables %, policies %, FORCE %',
      v_tables,v_policies,v_forced;
  END IF;
  IF app_private.current_tenant_id() IS NOT NULL
     OR EXISTS (SELECT 1 FROM iam.tenants)
     OR EXISTS (SELECT 1 FROM iam.identities)
     OR EXISTS (SELECT 1 FROM iam.memberships) THEN
    RAISE EXCEPTION 'tenant data visible without signed context';
  END IF;
  BEGIN
    INSERT INTO iam.organizations(tenant_id,provider,external_organization_id,display_name)
    VALUES ('10000000-0000-4000-8000-000000000001',
            'ci','unscoped-write','Must be denied');
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'no-context INSERT did not fail closed with SQLSTATE 42501';
  END IF;
END
$ci_runtime_login_gate$;

SELECT 'PASS: authenticated CI runtime LOGIN, least privilege, forced RLS and no-context deny' AS result;
