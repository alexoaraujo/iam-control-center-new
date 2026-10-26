\set ON_ERROR_STOP on

-- This test file must connect as the actual disposable iam_runtime_test LOGIN,
-- not as a superuser executing SET ROLE.

DO $assert_login$
BEGIN
  IF current_user <> 'iam_runtime_test' THEN
    RAISE EXCEPTION 'tests must connect as iam_runtime_test, current_user=%', current_user;
  END IF;
END;
$assert_login$;

-- Missing context: tenant-scoped reads return no rows.
BEGIN;
DO $no_context$
BEGIN
  IF app_private.current_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'missing context should resolve to NULL';
  END IF;
  IF (SELECT count(*) FROM iam.roles) <> 0 THEN
    RAISE EXCEPTION 'roles visible without tenant context';
  END IF;
  IF (SELECT count(*) FROM iam.memberships) <> 0 THEN
    RAISE EXCEPTION 'memberships visible without tenant context';
  END IF;
  IF (SELECT count(*) FROM iam.role_permissions) <> 0 THEN
    RAISE EXCEPTION 'role_permissions visible without tenant context';
  END IF;
END;
$no_context$;
COMMIT;

-- Tenant A can see its own membership/RBAC rows and no rows from tenant B.
BEGIN;
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001';
DO $tenant_a$
DECLARE
  role_count integer;
  membership_count integer;
  assignment_count integer;
  permission_count integer;
  audit_count integer;
BEGIN
  IF app_private.current_tenant_id() <> '00000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'tenant A context was not resolved';
  END IF;
  SELECT count(*) INTO role_count FROM iam.roles;
  SELECT count(*) INTO membership_count FROM iam.memberships;
  SELECT count(*) INTO assignment_count FROM iam.membership_roles;
  SELECT count(*) INTO permission_count FROM iam.role_permissions;
  SELECT count(*) INTO audit_count FROM audit.events;
  IF role_count <> 1 OR membership_count <> 1 OR assignment_count <> 1 OR permission_count <> 1 OR audit_count <> 1 THEN
    RAISE EXCEPTION 'tenant A visibility mismatch: roles %, memberships %, assignments %, permissions %, audit %',
      role_count, membership_count, assignment_count, permission_count, audit_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM iam.role_permissions
    WHERE permission_key = 'iam.control_center.read'
  ) THEN
    RAISE EXCEPTION 'tenant A permission missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM iam.role_permissions
    WHERE permission_key = 'iam.production.deploy'
  ) THEN
    RAISE EXCEPTION 'tenant B permission leaked to tenant A';
  END IF;
END;
$tenant_a$;
COMMIT;

-- Empty and malformed context must fail closed, not raise a UUID cast error.
BEGIN;
SET LOCAL app.tenant_id = '';
DO $empty_context$
BEGIN
  IF app_private.current_tenant_id() IS NOT NULL OR (SELECT count(*) FROM iam.roles) <> 0 THEN
    RAISE EXCEPTION 'empty context should fail closed';
  END IF;
END;
$empty_context$;
COMMIT;

BEGIN;
SET LOCAL app.tenant_id = 'not-a-uuid';
DO $malformed_context$
BEGIN
  IF app_private.current_tenant_id() IS NOT NULL OR (SELECT count(*) FROM iam.roles) <> 0 THEN
    RAISE EXCEPTION 'malformed context should fail closed';
  END IF;
END;
$malformed_context$;
COMMIT;

-- Tenant B can see only its own rows.
BEGIN;
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000002';
DO $tenant_b$
BEGIN
  IF (SELECT count(*) FROM iam.roles) <> 1 THEN
    RAISE EXCEPTION 'tenant B role count mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM iam.role_permissions
    WHERE permission_key = 'iam.production.deploy'
  ) THEN
    RAISE EXCEPTION 'tenant B permission missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM iam.role_permissions
    WHERE permission_key = 'iam.control_center.read'
  ) THEN
    RAISE EXCEPTION 'tenant A permission leaked to tenant B';
  END IF;
END;
$tenant_b$;
COMMIT;

-- Runtime can append an audit event for its current tenant.
BEGIN;
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001';
INSERT INTO audit.events
  (id, tenant_id, actor_identity_id, actor_membership_id, event_key, outcome, metadata)
VALUES
  ('00000000-0000-0000-0000-000000000301',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000201',
   'test.audit.allowed', 'success', '{}'::jsonb);
COMMIT;

-- Cross-tenant audit insert must be rejected by the RLS WITH CHECK policy.
BEGIN;
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001';
DO $audit_cross_tenant$
BEGIN
  BEGIN
    INSERT INTO audit.events
      (id, tenant_id, event_key, outcome, metadata)
    VALUES
      ('00000000-0000-0000-0000-000000000302',
       '00000000-0000-0000-0000-000000000002',
       'test.audit.denied', 'denied', '{}'::jsonb);
    RAISE EXCEPTION 'cross-tenant audit insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: cross-tenant audit INSERT denied by RLS';
  END;
END;
$audit_cross_tenant$;
ROLLBACK;

-- Prove global tables and migration ledger have no direct runtime SELECT grant.
DO $global_grants$
BEGIN
  IF has_table_privilege(current_user, 'iam.tenants', 'SELECT')
     OR has_table_privilege(current_user, 'iam.identities', 'SELECT')
     OR has_table_privilege(current_user, 'iam.permissions', 'SELECT')
     OR has_table_privilege(current_user, 'iam.schema_migrations', 'SELECT') THEN
    RAISE EXCEPTION 'unexpected direct SELECT grant on a global/administrative table';
  END IF;
  BEGIN
    PERFORM 1 FROM iam.identities;
    RAISE EXCEPTION 'runtime unexpectedly read iam.identities';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: direct runtime SELECT on iam.identities denied';
  END;
END;
$global_grants$;

-- Runtime must not have DDL privileges.
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

-- KNOWN LIMITATION / expected security finding:
-- a caller able to issue arbitrary SQL can modify a custom GUC. This test is
-- expected to demonstrate that tenant B becomes visible after the caller
-- changes the context; do not interpret this as a passing isolation guarantee.
BEGIN;
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000002';
DO $guc_spoofing$
BEGIN
  IF (SELECT count(*) FROM iam.roles) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM iam.roles
       WHERE id = '00000000-0000-0000-0000-000000000202'
     ) THEN
    RAISE EXCEPTION 'expected GUC-spoofing limitation was not reproduced';
  END IF;
  RAISE NOTICE 'KNOWN LIMITATION REPRODUCED: caller-settable app.tenant_id changes visible tenant; migration promotion remains BLOCKED';
END;
$guc_spoofing$;
COMMIT;

-- SET LOCAL is transaction-scoped: following transaction starts without context.
BEGIN;
DO $context_reset$
BEGIN
  IF app_private.current_tenant_id() IS NOT NULL OR (SELECT count(*) FROM iam.roles) <> 0 THEN
    RAISE EXCEPTION 'tenant context leaked after transaction end';
  END IF;
END;
$context_reset$;
COMMIT;

\echo 'DISPOSABLE RUNTIME CONTRACT TESTS PASSED; GUC spoofing limitation was also reproduced as a promotion blocker.'
