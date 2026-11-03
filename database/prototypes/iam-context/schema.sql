-- CI/local disposable prototype only. Not a production migration.
BEGIN;

DO $preflight$
DECLARE r record;
BEGIN
  IF session_user <> 'iam_migrator_login' THEN
    RAISE EXCEPTION 'expected authenticated session_user iam_migrator_login';
  END IF;
  IF current_user <> 'iam_owner' THEN
    RAISE EXCEPTION 'expected effective current_user iam_owner';
  END IF;

  SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
         rolreplication, rolbypassrls
    INTO r FROM pg_roles WHERE rolname = session_user;
  IF NOT FOUND OR NOT r.rolcanlogin OR r.rolinherit OR r.rolsuper
     OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls THEN
    RAISE EXCEPTION 'migration login attributes violate prototype contract';
  END IF;

  IF to_regnamespace('ctx_lab') IS NOT NULL THEN
    RAISE EXCEPTION 'ctx_lab already exists; prototype requires a clean disposable database';
  END IF;
END
$preflight$;

CREATE SCHEMA ctx_lab AUTHORIZATION iam_owner;

CREATE TABLE ctx_lab.test_context_registry (
  token text PRIMARY KEY,
  tenant_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE ctx_lab.tenant_records (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  payload text NOT NULL
);

ALTER TABLE ctx_lab.tenant_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctx_lab.tenant_records FORCE ROW LEVEL SECURITY;

CREATE FUNCTION ctx_lab.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, ctx_lab
AS $function$
DECLARE
  resolved_tenant uuid;
  supplied_token text;
BEGIN
  supplied_token := current_setting('app.context_token', true);
  IF supplied_token IS NULL OR supplied_token = '' THEN
    RAISE EXCEPTION 'tenant context missing' USING ERRCODE = '28000';
  END IF;

  SELECT registry.tenant_id
    INTO resolved_tenant
    FROM ctx_lab.test_context_registry AS registry
   WHERE registry.token = supplied_token
     AND registry.active
     AND registry.expires_at > statement_timestamp();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant context invalid or expired' USING ERRCODE = '28000';
  END IF;

  RETURN resolved_tenant;
END
$function$;

CREATE FUNCTION ctx_lab.set_test_context(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, ctx_lab
AS $function$
BEGIN
  PERFORM set_config('app.context_token', p_token, true);
  PERFORM ctx_lab.current_tenant_id();
END
$function$;

CREATE POLICY tenant_records_context_policy
  ON ctx_lab.tenant_records
  FOR ALL
  USING (tenant_id = ctx_lab.current_tenant_id())
  WITH CHECK (tenant_id = ctx_lab.current_tenant_id());

REVOKE ALL ON SCHEMA ctx_lab FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ctx_lab FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ctx_lab FROM PUBLIC;
REVOKE ALL ON ctx_lab.test_context_registry FROM iam_app_runtime;
REVOKE ALL ON ctx_lab.tenant_records FROM iam_app_runtime;
REVOKE ALL ON FUNCTION ctx_lab.current_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION ctx_lab.set_test_context(text) FROM PUBLIC;

GRANT USAGE ON SCHEMA ctx_lab TO iam_app_runtime;
GRANT SELECT ON ctx_lab.tenant_records TO iam_app_runtime;
GRANT EXECUTE ON FUNCTION ctx_lab.current_tenant_id() TO iam_app_runtime;
GRANT EXECUTE ON FUNCTION ctx_lab.set_test_context(text) TO iam_app_runtime;

COMMIT;
