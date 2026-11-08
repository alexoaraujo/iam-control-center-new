-- Dynamic tenant-context and RLS contract against the full source-schema restore.
-- Runs only in disposable PostgreSQL 18 CI after iam_database_schema.sql is restored.
-- All fixtures and context keys are synthetic and rolled back.
\\set ON_ERROR_STOP on

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

DO $runtime_rls_contract$
DECLARE
  v_tenant_a uuid := '10000000-0000-4000-8000-000000000001';
  v_tenant_b uuid := '20000000-0000-4000-8000-000000000002';
  v_identity_a uuid := '10000000-0000-4000-8000-000000000011';
  v_identity_b uuid := '20000000-0000-4000-8000-000000000022';
  v_expires bigint;
  v_nonce text;
  v_signature text;
  v_count bigint;
  v_rejected boolean;
  v_secret bytea := decode(repeat('42', 32), 'hex');
BEGIN
  IF current_user <> 'iam_app_runtime' THEN
    RAISE EXCEPTION 'RLS test must execute as iam_app_runtime; current_user=%', current_user;
  END IF;

  IF app_private.current_tenant_id() IS NOT NULL
     OR (SELECT count(*) FROM iam.tenants) <> 0
     OR (SELECT count(*) FROM iam.memberships) <> 0
     OR (SELECT count(*) FROM iam.identities) <> 0 THEN
    RAISE EXCEPTION 'missing context must fail closed for all tenant-scoped reads';
  END IF;

  v_expires := floor(extract(epoch FROM clock_timestamp()))::bigint + 180;
  v_nonce := 'ci-tenant-a';
  v_signature := encode(
    public.hmac(
      convert_to(v_tenant_a::text || '|' || v_identity_a::text || '|' ||
                 v_expires::text || '|' || v_nonce, 'UTF8'),
      v_secret,
      'sha256'
    ),
    'hex'
  );

  PERFORM iam.set_tenant_context(
    v_tenant_a, v_identity_a, v_expires, v_nonce, v_signature
  );

  IF app_private.current_tenant_id() IS DISTINCT FROM v_tenant_a THEN
    RAISE EXCEPTION 'valid signed context did not resolve tenant A';
  END IF;

  SELECT count(*) INTO v_count FROM iam.tenants;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM iam.tenants WHERE id = v_tenant_a) THEN
    RAISE EXCEPTION 'tenant A context did not isolate iam.tenants; visible=%', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM iam.memberships;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM iam.memberships
     WHERE tenant_id = v_tenant_a AND identity_id = v_identity_a
  ) THEN
    RAISE EXCEPTION 'tenant A context did not isolate iam.memberships; visible=%', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM iam.identities;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM iam.identities WHERE id = v_identity_a) THEN
    RAISE EXCEPTION 'identity_scope did not restrict identities to tenant A; visible=%', v_count;
  END IF;

  -- The runtime has INSERT on organizations; RLS WITH CHECK must still reject
  -- a row whose tenant_id is not the authenticated tenant.
  v_rejected := false;
  BEGIN
    INSERT INTO iam.organizations (
      tenant_id, provider, external_organization_id, display_name
    ) VALUES (
      v_tenant_b, 'ci', 'cross-tenant-write', 'Must be rejected'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'cross-tenant INSERT unexpectedly succeeded';
  END IF;

  -- Invalid signatures, expired contexts, and lifetimes over 300 seconds
  -- must be rejected and leave the transaction without tenant context.
  v_rejected := false;
  BEGIN
    PERFORM iam.set_tenant_context(
      v_tenant_a, v_identity_a, v_expires, v_nonce, repeat('0', 64)
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected OR app_private.current_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'tampered signature was not rejected fail-closed';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM iam.set_tenant_context(
      v_tenant_a, v_identity_a,
      floor(extract(epoch FROM clock_timestamp()))::bigint - 1,
      'ci-expired', v_signature
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected OR app_private.current_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'expired context was not rejected fail-closed';
  END IF;

  v_rejected := false;
  v_expires := floor(extract(epoch FROM clock_timestamp()))::bigint + 301;
  v_nonce := 'ci-too-long';
  v_signature := encode(
    public.hmac(
      convert_to(v_tenant_a::text || '|' || v_identity_a::text || '|' ||
                 v_expires::text || '|' || v_nonce, 'UTF8'),
      v_secret,
      'sha256'
    ),
    'hex'
  );
  BEGIN
    PERFORM iam.set_tenant_context(
      v_tenant_a, v_identity_a, v_expires, v_nonce, v_signature
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected OR app_private.current_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'context lifetime over 300 seconds was not rejected fail-closed';
  END IF;

  -- A separately signed tenant B context must expose B only, never A.
  v_expires := floor(extract(epoch FROM clock_timestamp()))::bigint + 180;
  v_nonce := 'ci-tenant-b';
  v_signature := encode(
    public.hmac(
      convert_to(v_tenant_b::text || '|' || v_identity_b::text || '|' ||
                 v_expires::text || '|' || v_nonce, 'UTF8'),
      v_secret,
      'sha256'
    ),
    'hex'
  );
  PERFORM iam.set_tenant_context(
    v_tenant_b, v_identity_b, v_expires, v_nonce, v_signature
  );

  SELECT count(*) INTO v_count FROM iam.tenants;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM iam.tenants WHERE id = v_tenant_b) THEN
    RAISE EXCEPTION 'tenant B context did not isolate iam.tenants; visible=%', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM iam.identities;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM iam.identities WHERE id = v_identity_b) THEN
    RAISE EXCEPTION 'tenant B identity visibility crossed tenant boundary; visible=%', v_count;
  END IF;
END
$runtime_rls_contract$;

ROLLBACK;
SELECT 'PASS runtime signed-context, fail-closed, cross-tenant SELECT/INSERT and tenant-isolation contract' AS result;
