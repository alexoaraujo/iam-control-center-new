-- Required IAM security gate: fail closed in the disposable PostgreSQL 18 CI database.
-- Execute only after source-schema restore, signed A/B tests and runtime login.
-- Never use against Neon/Development/Production.
DO $iam_required_security_gate$
DECLARE
  v_force integer;
  v_policies integer;
  v_tenants integer;
  v_memberships integer;
  v_signers integer;
BEGIN
  IF current_database() <> 'iam_source_restore_test'
     OR current_user <> 'postgres'
     OR current_setting('server_version_num')::integer < 180000 THEN
    RAISE EXCEPTION 'security gate must run exclusively on disposable PG18 CI';
  END IF;

  SELECT count(*) INTO v_force
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('iam','audit','app_private')
     AND c.relkind IN ('r','p') AND c.relforcerowsecurity;
  SELECT count(*) INTO v_policies
    FROM pg_policies WHERE schemaname IN ('iam','audit','app_private');
  SELECT count(*) INTO v_tenants FROM iam.tenants;
  SELECT count(*) INTO v_memberships FROM iam.memberships;
  SELECT count(*) INTO v_signers FROM app_private.context_keys WHERE active;

  IF v_force <> 20 OR v_policies <> 41
     OR v_tenants <> 0 OR v_memberships <> 0 OR v_signers <> 0
     OR (SELECT rolbypassrls FROM pg_roles
          WHERE rolname='iam_app_runtime_login') IS DISTINCT FROM FALSE
     OR NOT EXISTS (
          SELECT 1 FROM pg_auth_members m
          JOIN pg_roles r ON r.oid=m.member
          JOIN pg_roles inherited ON inherited.oid=m.roleid
          WHERE r.rolname='iam_app_runtime_login'
            AND inherited.rolname='iam_app_runtime'
            AND m.inherit_option AND NOT m.set_option
        )
  THEN
    RAISE EXCEPTION 'IAM signed RLS/role/security contract failed, FORCE=%, policies=%, tenants=%, memberships=%, active_keys=%',
      v_force, v_policies, v_tenants, v_memberships, v_signers;
  END IF;
END $iam_required_security_gate$;

SELECT 'PASS_IAM_SECURITY_GATE_CATALOG_RUNTIME_NO_FIXTURE_LEAK' AS result;
