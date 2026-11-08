-- CI-only contract for proposed migration 0002.
-- Run after the proposal is applied to the disposable operational fixture.
\set ON_ERROR_STOP on

SELECT set_config('ci.resolver_checksum', :'resolver_checksum', false);
SELECT set_config('ci.source_sha', :'source_sha', false);

DO $assert_function_hardening$
DECLARE
  v_current record;
  v_setter record;
  v_ledger record;
BEGIN
  SELECT p.provolatile, p.prosecdef, pg_get_userbyid(p.proowner) AS owner,
         p.proconfig
    INTO v_current
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('app_private.current_tenant_id()');
  IF NOT FOUND OR v_current.provolatile <> 'v'
     OR NOT v_current.prosecdef OR v_current.owner <> 'iam_owner'
     OR NOT (v_current.proconfig @> ARRAY['search_path=pg_catalog, app_private, iam']::text[])
     OR v_current.proconfig @> ARRAY['search_path=pg_catalog, app_private, iam, public']::text[] THEN
    RAISE EXCEPTION 'current_tenant_id must be VOLATILE, SECURITY DEFINER, iam_owner-owned and use hardened search_path';
  END IF;

  SELECT p.provolatile, p.prosecdef, pg_get_userbyid(p.proowner) AS owner,
         p.proconfig
    INTO v_setter
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('iam.set_tenant_context(uuid,uuid,bigint,text,text)');
  IF NOT FOUND OR NOT v_setter.prosecdef OR v_setter.owner <> 'iam_owner'
     OR NOT (v_setter.proconfig @> ARRAY['search_path=pg_catalog, app_private, iam']::text[])
     OR v_setter.proconfig @> ARRAY['search_path=pg_catalog, app_private, iam, public']::text[] THEN
    RAISE EXCEPTION 'set_tenant_context must remain SECURITY DEFINER and remove public from search_path';
  END IF;

  SELECT migration_id, checksum_sha256, source_sha, execution_role
    INTO v_ledger
    FROM iam.schema_migrations
   WHERE migration_id = '0002_context_resolver_volatility_hardening';
  IF NOT FOUND
     OR v_ledger.checksum_sha256 <> current_setting('ci.resolver_checksum')
     OR v_ledger.source_sha <> current_setting('ci.source_sha')
     OR v_ledger.execution_role <> 'iam_migrator_login' THEN
    RAISE EXCEPTION 'proposal 0002 ledger evidence mismatch: %', v_ledger;
  END IF;
END
$assert_function_hardening$;

BEGIN;
SET LOCAL ROLE iam_owner;
INSERT INTO iam.tenants (id, status)
VALUES
  ('30000000-0000-4000-8000-000000000003', 'active'),
  ('40000000-0000-4000-8000-000000000004', 'active');
INSERT INTO iam.identities (id, status)
VALUES
  ('30000000-0000-4000-8000-000000000033', 'active'),
  ('40000000-0000-4000-8000-000000000044', 'active');
INSERT INTO iam.memberships (tenant_id, identity_id, status)
VALUES
  ('30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000033', 'active'),
  ('40000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000044', 'active');
INSERT INTO app_private.context_keys (key_id, secret, active)
VALUES ('ci-volatility-key', decode(repeat('42', 32), 'hex'), true);

RESET ROLE;
SET LOCAL ROLE iam_owner;

-- This single DO statement deliberately switches tenant context twice as the
-- non-login object owner. The resolver must observe tenant B immediately;
-- cross-tenant row visibility is covered separately by the full-source RLS test.
DO $same_statement_context_switch$
DECLARE
  v_tenant uuid;
  v_identity uuid;
  v_expires bigint;
  v_nonce text;
  v_signature text;
BEGIN
  v_tenant := '30000000-0000-4000-8000-000000000003';
  v_identity := '30000000-0000-4000-8000-000000000033';
  v_expires := floor(extract(epoch FROM clock_timestamp()))::bigint + 180;
  v_nonce := 'ci-volatility-a';
  v_signature := encode(public.hmac(
    convert_to(v_tenant::text || '|' || v_identity::text || '|' || v_expires::text || '|' || v_nonce, 'UTF8'),
    decode(repeat('42', 32), 'hex'), 'sha256'), 'hex');
  PERFORM iam.set_tenant_context(v_tenant, v_identity, v_expires, v_nonce, v_signature);

  IF app_private.current_tenant_id() IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'first context A was not resolved';
  END IF;
  v_tenant := '40000000-0000-4000-8000-000000000004';
  v_identity := '40000000-0000-4000-8000-000000000044';
  v_expires := floor(extract(epoch FROM clock_timestamp()))::bigint + 180;
  v_nonce := 'ci-volatility-b';
  v_signature := encode(public.hmac(
    convert_to(v_tenant::text || '|' || v_identity::text || '|' || v_expires::text || '|' || v_nonce, 'UTF8'),
    decode(repeat('42', 32), 'hex'), 'sha256'), 'hex');
  PERFORM iam.set_tenant_context(v_tenant, v_identity, v_expires, v_nonce, v_signature);

  IF app_private.current_tenant_id() IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'context switch A -> B returned a stale tenant id';
  END IF;
  PERFORM iam.clear_tenant_context();
END
$same_statement_context_switch$;

-- Invalid context attempts are checked from an empty context in independent
-- statements; the application must abort the request transaction on failure.
DO $invalid_signature$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM iam.set_tenant_context(
      '30000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000033',
      floor(extract(epoch FROM clock_timestamp()))::bigint + 180,
      'ci-invalid-signature', repeat('0', 64)
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'tampered signature was not rejected';
  END IF;
END
$invalid_signature$;

RESET ROLE;
ROLLBACK;
SELECT 'PASS proposed 0002: VOLATILE tenant resolver, hardened setter search_path and same-statement tenant context switching' AS result;
