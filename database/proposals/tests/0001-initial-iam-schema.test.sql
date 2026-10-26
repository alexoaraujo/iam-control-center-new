\set ON_ERROR_STOP on

-- Run only as a real disposable IAM runtime LOGIN, never SET ROLE from admin.
DO $assert_login$
BEGIN
  IF current_user <> 'iam_runtime_test' THEN
    RAISE EXCEPTION 'tests must connect as iam_runtime_test, current_user=%', current_user;
  END IF;
END;
$assert_login$;

-- No signed context means no tenant-scoped rows.
BEGIN;
DO $no_context$
BEGIN
  IF app_private.current_tenant_id() IS NOT NULL
     OR (SELECT count(*) FROM iam.roles) <> 0
     OR (SELECT count(*) FROM iam.memberships) <> 0
     OR (SELECT count(*) FROM iam.role_permissions) <> 0 THEN
    RAISE EXCEPTION 'missing signed context did not fail closed';
  END IF;
END;
$no_context$;
COMMIT;

-- Tenant A capability: role, membership, assignment, permission mapping and
-- audit rows must be scoped to A only.
BEGIN;
SET LOCAL app.tenant_context = :'tenant_a_context';
DO $tenant_a$
BEGIN
  IF app_private.current_tenant_id() IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'valid signed tenant A context was not resolved';
  END IF;
  IF (SELECT count(*) FROM iam.roles) <> 1
     OR (SELECT count(*) FROM iam.memberships) <> 1
     OR (SELECT count(*) FROM iam.membership_roles) <> 1
     OR (SELECT count(*) FROM iam.role_permissions) <> 1
     OR (SELECT count(*) FROM audit.events) <> 1 THEN
    RAISE EXCEPTION 'tenant A visibility mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM iam.role_permissions WHERE permission_key = 'iam.control_center.read')
     OR EXISTS (SELECT 1 FROM iam.role_permissions WHERE permission_key = 'iam.production.deploy') THEN
    RAISE EXCEPTION 'tenant B permission leaked into tenant A context';
  END IF;
END;
$tenant_a$;
COMMIT;

-- Empty/malformed/expired/overlong capability must fail closed.
BEGIN;
SET LOCAL app.tenant_context = '';
DO $empty_context$
BEGIN
  IF app_private.current_tenant_id() IS NOT NULL OR (SELECT count(*) FROM iam.roles) <> 0 THEN
    RAISE EXCEPTION 'empty signed context should fail closed';
  END IF;
END;
$empty_context$;
COMMIT;

BEGIN;
SET LOCAL app.tenant_context = 'not-a-valid-token';
DO $malformed_context$
BEGIN
  IF app_private.current_tenant_id() IS NOT NULL OR (SELECT count(*) FROM iam.roles) <> 0 THEN
    RAISE EXCEPTION 'malformed signed context should fail closed';
  END IF;
END;
$malformed_context$;
COMMIT;

BEGIN;
SET LOCAL app.tenant_context = :'expired_context';
DO $expired_context$
BEGIN
  IF app_private.current_tenant_id() IS NOT NULL OR (SELECT count(*) FROM iam.roles) <> 0 THEN
    RAISE EXCEPTION 'expired signed context should fail closed';
  END IF;
END;
$expired_context$;
COMMIT;

BEGIN;
SET LOCAL app.tenant_context = :'long_lived_context';
DO $long_lived_context$
BEGIN
  IF app_private.current_tenant_id() IS NOT NULL OR (SELECT count(*) FROM iam.roles) <> 0 THEN
    RAISE EXCEPTION 'context exceeding maximum lifetime should fail closed';
  END IF;
END;
$long_lived_context$;
COMMIT;

-- Tenant B capability exposes B's role and permission, not A's.
BEGIN;
SET LOCAL app.tenant_context = :'tenant_b_context';
DO $tenant_b$
BEGIN
  IF app_private.current_tenant_id() IS DISTINCT FROM '00000000-0000-0000-0000-000000000002'::uuid
     OR (SELECT count(*) FROM iam.roles) <> 1 THEN
    RAISE EXCEPTION 'valid signed tenant B context was not resolved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM iam.role_permissions WHERE permission_key = 'iam.production.deploy')
     OR EXISTS (SELECT 1 FROM iam.role_permissions WHERE permission_key = 'iam.control_center.read') THEN
    RAISE EXCEPTION 'tenant A permission leaked into tenant B context';
  END IF;
END;
$tenant_b$;
COMMIT;

-- Tampering with tenant, identity or membership invalidates the HMAC.
BEGIN;
SELECT set_config(
  'app.tenant_context',
  replace(:'tenant_a_context', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'),
  true
);
DO $tampered_tenant$
BEGIN
  IF app_private.current_tenant_id() IS NOT NULL OR (SELECT count(*) FROM iam.roles) <> 0 THEN
    RAISE EXCEPTION 'tampered tenant field accepted';
  END IF;
END;
$tampered_tenant$;
COMMIT;

BEGIN;
SELECT set_config(
  'app.tenant_context',
  replace(:'tenant_a_context', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102'),
  true
);
DO $tampered_identity$
BEGIN
  IF app_private.current_tenant_id() IS NOT NULL OR (SELECT count(*) FROM iam.roles) <> 0 THEN
    RAISE EXCEPTION 'tampered identity field accepted';
  END IF;
END;
$tampered_identity$;
COMMIT;

BEGIN;
SELECT set_config(
  'app.tenant_context',
  replace(:'tenant_a_context', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000202'),
  true
);
DO $tampered_membership$
BEGIN
  IF app_private.current_tenant_id() IS NOT NULL OR (SELECT count(*) FROM iam.roles) <> 0 THEN
    RAISE EXCEPTION 'tampered membership field accepted';
  END IF;
END;
$tampered_membership$;
COMMIT;

-- Changing the old/simple GUC cannot switch the tenant once the signed A
-- capability is installed; RLS ignores app.tenant_id entirely.
BEGIN;
SET LOCAL app.tenant_context = :'tenant_a_context';
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000002';
DO $simple_guc_spoof$
BEGIN
  IF app_private.current_tenant_id() IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
     OR (SELECT count(*) FROM iam.roles) <> 1
     OR NOT EXISTS (SELECT 1 FROM iam.roles WHERE id = '00000000-0000-0000-0000-000000000301')
     OR EXISTS (SELECT 1 FROM iam.roles WHERE id = '00000000-0000-0000-0000-000000000302') THEN
    RAISE EXCEPTION 'changing app.tenant_id bypassed signed capability';
  END IF;
  RAISE NOTICE 'PASS: simple GUC spoof cannot switch tenant while signed capability remains A';
END;
$simple_guc_spoof$;
COMMIT;

-- Runtime can append an audit event only to the signed current tenant.
BEGIN;
SET LOCAL app.tenant_context = :'tenant_a_context';
INSERT INTO audit.events
  (id, tenant_id, actor_identity_id, actor_membership_id, event_key, outcome, metadata)
VALUES
  ('00000000-0000-0000-0000-000000000501',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000201',
   'test.audit.allowed', 'success', '{}'::jsonb);
COMMIT;

BEGIN;
SET LOCAL app.tenant_context = :'tenant_a_context';
DO $audit_cross_tenant$
BEGIN
  BEGIN
    INSERT INTO audit.events (id, tenant_id, event_key, outcome, metadata)
    VALUES (
      '00000000-0000-0000-0000-000000000502',
      '00000000-0000-0000-0000-000000000002',
      'test.audit.denied', 'denied', '{}'::jsonb
    );
    RAISE EXCEPTION 'cross-tenant audit insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: cross-tenant audit INSERT denied by RLS';
  END;
END;
$audit_cross_tenant$;
ROLLBACK;

-- Runtime must not read global/administrative tables, signing keys or ledger.
DO $global_grants$
BEGIN
  IF has_table_privilege(current_user, 'iam.tenants', 'SELECT')
     OR has_table_privilege(current_user, 'iam.identities', 'SELECT')
     OR has_table_privilege(current_user, 'iam.permissions', 'SELECT')
     OR has_table_privilege(current_user, 'iam.schema_migrations', 'SELECT')
     OR has_table_privilege(current_user, 'app_private.tenant_context_keys', 'SELECT') THEN
    RAISE EXCEPTION 'unexpected SELECT grant on global/admin/signing-key table';
  END IF;
  BEGIN
    PERFORM 1 FROM iam.identities;
    RAISE EXCEPTION 'runtime unexpectedly read iam.identities';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: direct runtime SELECT on iam.identities denied';
  END;
  BEGIN
    PERFORM 1 FROM app_private.tenant_context_keys;
    RAISE EXCEPTION 'runtime unexpectedly read tenant signing keys';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: runtime cannot read tenant signing keys';
  END;
END;
$global_grants$;

DO $runtime_ddl$
BEGIN
  BEGIN
    EXECUTE 'CREATE TABLE iam.runtime_ddl_probe (id integer)';
    RAISE EXCEPTION 'runtime DDL unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: runtime DDL denied';
  END;
END;
$runtime_ddl$;

-- SET LOCAL is transaction-scoped: following transaction has no signed context.
BEGIN;
DO $context_reset$
BEGIN
  IF app_private.current_tenant_id() IS NOT NULL OR (SELECT count(*) FROM iam.roles) <> 0 THEN
    RAISE EXCEPTION 'signed tenant context leaked after transaction end';
  END IF;
END;
$context_reset$;
COMMIT;

\echo 'SIGNED CONTEXT TESTS PASSED: HMAC tampering/expiry and plain-GUC spoof are denied.'
