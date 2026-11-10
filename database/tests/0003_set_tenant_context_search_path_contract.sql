-- Contract for migration 0003, run after applying it to a disposable restored schema.
DO $contract$
DECLARE
  effective_owner name;
  config text[];
  is_definer boolean;
  function_body text;
  insecure_functions text[];
BEGIN
  SELECT pg_get_userbyid(p.proowner), p.proconfig, p.prosecdef, pg_get_functiondef(p.oid)
    INTO effective_owner, config, is_definer, function_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='iam'
     AND p.proname='set_tenant_context'
     AND pg_get_function_identity_arguments(p.oid) =
         'p_tenant_id uuid, p_identity_id uuid, p_expires_at bigint, p_nonce text, p_signature text';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_tenant_context function missing after migration 0003';
  END IF;
  IF effective_owner <> 'iam_owner' OR is_definer IS DISTINCT FROM true
     OR config IS DISTINCT FROM ARRAY['search_path=pg_catalog, app_private, iam']::text[] THEN
    RAISE EXCEPTION 'migration 0003 function contract failed: owner=%, definer=%, config=%',
      effective_owner, is_definer, config;
  END IF;
  IF position('app_private.current_tenant_id()' IN function_body) = 0 THEN
    RAISE EXCEPTION 'migration 0003 altered or removed qualified validation call';
  END IF;

  -- Function-local search_path, not runtime session search_path: no untrusted
  -- public schema is permitted on any SECURITY DEFINER IAM function.
  SELECT array_agg(n.nspname || '.' || p.proname ORDER BY n.nspname, p.proname)
    INTO insecure_functions
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('iam','audit','app_private')
     AND p.prosecdef
     AND (
       p.proconfig IS NULL
       OR EXISTS (
         SELECT 1 FROM unnest(p.proconfig) AS c(setting)
          WHERE setting LIKE 'search_path=%'
            AND setting ~ '(^|[, ]+)public([, ]|$)'
       )
     );
  IF insecure_functions IS NOT NULL THEN
    RAISE EXCEPTION 'unsafe IAM SECURITY DEFINER search_path on %',
      insecure_functions;
  END IF;
END
$contract$;

SELECT 'PASS: tenant context SECURITY DEFINER search_path is hardened' AS check_result;
