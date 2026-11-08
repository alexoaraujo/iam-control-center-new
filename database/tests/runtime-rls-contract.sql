-- Dynamic tenant-context and RLS contract against the full source-schema restore.
-- Runs only in disposable PostgreSQL 18 CI after iam_database_schema.sql is restored.
-- All fixtures and context keys are synthetic and rolled back.
\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE iam_owner;
INSERT INTO iam.tenants (id, display_name)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'CI Tenant A'),
  ('20000000-0000-4000-8000-000000000002', 'CI Tenant B');

INSERT INTO iam.identities (id, issuer, subject)
VALUES
  ('10000000-0000-4000-8000-000000000011', 'https://ci.invalid/', 'identity-a'),
  ('20000000-0000-4000-8000-000000000022', 'https://ci.invalid/', 'identity-b');

INSERT INTO iam.memberships (tenant_id, identity_id, status)
VALUES
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011', 'active'),
  ('20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000022', 'active');

INSERT INTO app_private.context_keys (key_id, secret, active)
VALUES ('ci-runtime-rls-key', decode(repeat('42', 32), 'hex'), true);

RESET ROLE;
SET LOCAL ROLE iam_app_runtime;

-- Missing context must deny all tenant-scoped reads.
DO $missing_context$
BEGIN
  IF current_user <> 'iam_app_runtime'
     OR app_private.current_tenant_id() IS NOT NULL
     OR (SELECT count(*) FROM iam.tenants) <> 0
     OR (SELECT count(*) FROM iam.memberships) <> 0
     OR (SELECT count(*) FROM iam.identities) <> 0 THEN
    RAISE EXCEPTION 'missing context must fail closed for runtime reads';
  END IF;
END
$missing_context$;

-- A valid signature resolves exactly tenant A and cannot write into tenant B.
DO $valid_tenant_a$
DECLARE
  v_tenant uuid := '10000000-0000-4000-8000-000000000001';
  v_identity uuid := '10000000-0000-4000-8000-000000000011';
  v_expires bigint := floor(extract(epoch FROM clock_timestamp()))::bigint + 180;
  v_nonce text := 'ci-tenant-a';
  v_signature text;
  v_secret bytea := decode(repeat('42', 32), 'hex');
  v_count bigint;
  v_rejected boolean := false;
BEGIN
  v_signature := encode(public.hmac(
    convert_to(v_tenant::text || '|' || v_identity::text || '|' ||
               v_expires::text || '|' || v_nonce, 'UTF8'),
    v_secret, 'sha256'), 'hex');

  PERFORM iam.set_tenant_context(v_tenant, v_identity, v_expires, v_nonce, v_signature);
  IF app_private.current_tenant_id() IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'valid signed context did not resolve tenant A';
  END IF;

  SELECT count(*) INTO v_count FROM iam.tenants;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM iam.tenants WHERE id = v_tenant) THEN
    RAISE EXCEPTION 'tenant A did not isolate iam.tenants; visible=%', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM iam.memberships;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM iam.memberships
     WHERE tenant_id = v_tenant AND identity_id = v_identity
  ) THEN
    RAISE EXCEPTION 'tenant A did not isolate iam.memberships; visible=%', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM iam.identities;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM iam.identities WHERE id = v_identity) THEN
    RAISE EXCEPTION 'identity_scope did not isolate tenant A; visible=%', v_count;
  END IF;

  BEGIN
    INSERT INTO iam.organizations (
      tenant_id, provider, external_organization_id, display_name
    ) VALUES (
      '20000000-0000-4000-8000-000000000002',
      'ci', 'cross-tenant-write', 'Must be rejected'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'cross-tenant INSERT unexpectedly succeeded';
  END IF;

  PERFORM iam.clear_tenant_context();
END
$valid_tenant_a$;

-- Each invalid-context case is a separate top-level statement so the
-- STABLE resolver is re-evaluated after the previous GUC state is cleared.
DO $tampered_signature$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM iam.set_tenant_context(
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000011',
      floor(extract(epoch FROM clock_timestamp()))::bigint + 180,
      'ci-tampered', repeat('0', 64)
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected OR app_private.current_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'tampered signature was not rejected fail-closed';
  END IF;
END
$tampered_signature$;

DO $expired_context$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM iam.set_tenant_context(
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000011',
      floor(extract(epoch FROM clock_timestamp()))::bigint - 1,
      'ci-expired', repeat('0', 64)
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected OR app_private.current_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'expired context was not rejected fail-closed';
  END IF;
END
$expired_context$;

DO $excessive_lifetime$
DECLARE
  v_tenant uuid := '10000000-0000-4000-8000-000000000001';
  v_identity uuid := '10000000-0000-4000-8000-000000000011';
  v_expires bigint := floor(extract(epoch FROM clock_timestamp()))::bigint + 301;
  v_nonce text := 'ci-too-long';
  v_signature text;
  v_rejected boolean := false;
BEGIN
  v_signature := encode(public.hmac(
    convert_to(v_tenant::text || '|' || v_identity::text || '|' ||
               v_expires::text || '|' || v_nonce, 'UTF8'),
    decode(repeat('42', 32), 'hex'), 'sha256'), 'hex');

  BEGIN
    PERFORM iam.set_tenant_context(v_tenant, v_identity, v_expires, v_nonce, v_signature);
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected OR app_private.current_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'context lifetime over 300 seconds was not rejected fail-closed';
  END IF;
END
$excessive_lifetime$;

-- A separately signed tenant B context exposes B and identity B only.
DO $valid_tenant_b$
DECLARE
  v_tenant uuid := '20000000-0000-4000-8000-000000000002';
  v_identity uuid := '20000000-0000-4000-8000-000000000022';
  v_expires bigint := floor(extract(epoch FROM clock_timestamp()))::bigint + 180;
  v_nonce text := 'ci-tenant-b';
  v_signature text;
  v_count bigint;
BEGIN
  v_signature := encode(public.hmac(
    convert_to(v_tenant::text || '|' || v_identity::text || '|' ||
               v_expires::text || '|' || v_nonce, 'UTF8'),
    decode(repeat('42', 32), 'hex'), 'sha256'), 'hex');

  PERFORM iam.set_tenant_context(v_tenant, v_identity, v_expires, v_nonce, v_signature);

  SELECT count(*) INTO v_count FROM iam.tenants;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM iam.tenants WHERE id = v_tenant) THEN
    RAISE EXCEPTION 'tenant B did not isolate iam.tenants; visible=%', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM iam.identities;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM iam.identities WHERE id = v_identity) THEN
    RAISE EXCEPTION 'tenant B identity visibility crossed tenant boundary; visible=%', v_count;
  END IF;

  PERFORM iam.clear_tenant_context();
END
$valid_tenant_b$;

RESET ROLE;
ROLLBACK;
SELECT 'PASS runtime signed-context, fail-closed, cross-tenant SELECT/INSERT and tenant-isolation contract' AS result;
