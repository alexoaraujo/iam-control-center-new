-- NEW Neon Development deployed-runtime authorization contract, PostgreSQL 18.
-- Run via a direct TLS connection AS iam_app_runtime_login (NOT owner/migrator).
-- No credentials are embedded; no successful data writes are permitted.
-- Environment-specific gate: intended for the restored canonical IAM schema
-- with versioned 0003 hardening and 16 permission catalog rows.
DO $live_runtime_gate$
DECLARE
  runtime_record record;
  secured_functions integer;
  forced_rls integer;
  policy_count integer;
  tables_count integer;
  denied boolean := false;
BEGIN
  IF current_database() <> 'iam_database'
     OR current_user <> 'iam_app_runtime_login'
     OR session_user <> current_user THEN
    RAISE EXCEPTION 'wrong database/runtime session: db=%, login=%',
      current_database(), current_user;
  END IF;
  IF current_setting('server_version_num')::integer < 180000 THEN
    RAISE EXCEPTION 'PostgreSQL 18+ is required';
  END IF;
  SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
    INTO runtime_record
    FROM pg_roles WHERE rolname=current_user;
  IF NOT FOUND OR NOT runtime_record.rolcanlogin
     OR runtime_record.rolsuper OR runtime_record.rolbypassrls
     OR runtime_record.rolcreatedb OR runtime_record.rolcreaterole THEN
    RAISE EXCEPTION 'runtime login has privileged or invalid role flags';
  END IF;
  IF NOT has_database_privilege(current_user, current_database(), 'CONNECT')
     OR has_database_privilege(current_user, current_database(), 'CREATE')
     OR has_database_privilege(current_user, current_database(), 'TEMP') THEN
    RAISE EXCEPTION 'runtime database grants must be CONNECT-only';
  END IF;
  IF NOT pg_has_role(current_user, 'iam_app_runtime', 'USAGE')
     OR pg_has_role(current_user, 'iam_owner', 'MEMBER')
     OR pg_has_role(current_user, 'iam_migrator', 'MEMBER')
     OR pg_has_role(current_user, 'iam_owner', 'USAGE')
     OR pg_has_role(current_user, 'iam_migrator', 'USAGE') THEN
    RAISE EXCEPTION 'unexpected runtime login role membership/privilege inheritance';
  END IF;
  IF NOT has_schema_privilege(current_user, 'iam', 'USAGE')
     OR NOT has_schema_privilege(current_user, 'app_private', 'USAGE')
     OR has_schema_privilege(current_user, 'iam', 'CREATE')
     OR has_schema_privilege(current_user, 'audit', 'CREATE')
     OR has_schema_privilege(current_user, 'app_private', 'CREATE') THEN
    RAISE EXCEPTION 'runtime schema access deviates from least privilege';
  END IF;
  SELECT count(*) INTO tables_count FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p');
  SELECT count(*) INTO policy_count FROM pg_policy p
    JOIN pg_class c ON c.oid=p.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('iam','audit','app_private');
  SELECT count(*) INTO forced_rls FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('iam','audit','app_private')
      AND c.relkind IN ('r','p') AND c.relrowsecurity AND c.relforcerowsecurity;
  SELECT count(*) INTO secured_functions FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('iam','audit','app_private') AND p.prosecdef
      AND p.proconfig IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) cfg
        WHERE cfg LIKE 'search_path=%'
          AND cfg ~ '(^|[, ]+)public([, ]|$)'
      );
  IF tables_count <> 23 OR policy_count <> 41 OR forced_rls <> 20
     OR secured_functions <> 6 THEN
    RAISE EXCEPTION 'schema/SECURITY DEFINER gate mismatch: tables=%, policies=%, FORCE RLS=%, hardened functions=%',
      tables_count, policy_count, forced_rls, secured_functions;
  END IF;
  IF (SELECT count(*) FROM iam.permissions) <> 16 THEN
    RAISE EXCEPTION 'permission catalog seed parity gate failed';
  END IF;
  IF app_private.current_tenant_id() IS NOT NULL
     OR EXISTS (SELECT 1 FROM iam.tenants)
     OR EXISTS (SELECT 1 FROM iam.identities)
     OR EXISTS (SELECT 1 FROM iam.memberships) THEN
    RAISE EXCEPTION 'tenant data visible without signed context';
  END IF;
  -- This write must be rejected by the RLS policy with SQLSTATE 42501.
  -- Exception subtransaction reverts any attempted changes.
  BEGIN
    INSERT INTO iam.organizations(tenant_id,provider,external_organization_id,display_name)
    VALUES ('10000000-0000-4000-8000-000000000001',
            'runtime-gate','must-deny','Forbidden');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'no-context organization INSERT was not denied with 42501';
  END IF;
END
$live_runtime_gate$;
