-- IAM Control Center — migration 0003: harden SECURITY DEFINER tenant context search_path.
-- Review/verification candidate: requires existing canonical IAM schema and iam_owner.
-- This file does not create a migration ledger entry; version/checksum must be
-- registered transactionally by an approved migration runner before production use.
BEGIN;

DO $preflight$
DECLARE
  actual_owner text;
  actual_language text;
  actual_security_definer boolean;
  actual_config text[];
  actual_definition text;
BEGIN
  IF current_user <> 'iam_owner' THEN
    RAISE EXCEPTION 'migration 0003 must run as effective iam_owner, got %', current_user;
  END IF;

  SELECT pg_get_userbyid(p.proowner),
         l.lanname,
         p.prosecdef,
         p.proconfig,
         pg_get_functiondef(p.oid)
    INTO actual_owner, actual_language, actual_security_definer, actual_config,
         actual_definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'iam'
     AND p.proname = 'set_tenant_context'
     AND pg_get_function_identity_arguments(p.oid) =
         'p_tenant_id uuid, p_identity_id uuid, p_expires_at bigint, p_nonce text, p_signature text';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'canonical iam.set_tenant_context(uuid,uuid,bigint,text,text) is missing';
  END IF;
  IF actual_owner <> 'iam_owner' OR actual_language <> 'plpgsql'
     OR actual_security_definer IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'function owner/language/SECURITY DEFINER contract does not match';
  END IF;
  IF actual_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, app_private, iam, public']::text[]
     AND actual_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, app_private, iam']::text[] THEN
    RAISE EXCEPTION 'unexpected existing function search_path: %', actual_config;
  END IF;
  IF position('app_private.current_tenant_id()' IN actual_definition) = 0 THEN
    RAISE EXCEPTION 'unrecognized body: expected qualified tenant context validator call';
  END IF;
END
$preflight$;

-- Do not modify the function body, signature, SECURITY DEFINER flag, ownership,
-- permissions, or client-facing behaviour. Only remove the untrusted public schema
-- from its function-local search_path.
ALTER FUNCTION iam.set_tenant_context(uuid, uuid, bigint, text, text)
  SET search_path TO pg_catalog, app_private, iam;

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'iam'
       AND p.proname = 'set_tenant_context'
       AND p.prosecdef
       AND p.proowner = 'iam_owner'::regrole
       AND p.proconfig = ARRAY['search_path=pg_catalog, app_private, iam']::text[]
  ) THEN
    RAISE EXCEPTION 'post-migration search_path/owner/security verification failed';
  END IF;
END
$postflight$;

COMMIT;
