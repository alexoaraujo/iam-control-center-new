-- Run through authenticated iam_app_runtime_login, then SET ROLE.
\set ON_ERROR_STOP on
SET ROLE iam_app_runtime;

DO $role_assert$
BEGIN
  IF session_user <> 'iam_app_runtime_login' OR current_user <> 'iam_app_runtime' THEN
    RAISE EXCEPTION 'runtime test is not using the expected authenticated LOGIN and group role';
  END IF;
  IF (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
        FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'runtime group role has a prohibited administrative attribute';
  END IF;
END
$role_assert$;

-- SEC-01: no context must fail closed.
DO $absent_context$
DECLARE n bigint;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM ctx_lab.tenant_records;
    RAISE EXCEPTION 'query unexpectedly succeeded without context';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    NULL;
  END;
END
$absent_context$;

-- Unknown and expired fixture tokens must fail closed.
DO $invalid_context$
BEGIN
  BEGIN
    PERFORM ctx_lab.set_test_context('not-a-known-fixture-token');
    RAISE EXCEPTION 'unknown context unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    NULL;
  END;

  BEGIN
    PERFORM ctx_lab.set_test_context('fixture-token-expired');
    RAISE EXCEPTION 'expired context unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    NULL;
  END;
END
$invalid_context$;

-- Valid tenant A context returns A only. This tests RLS plumbing, not
-- resistance to replacing the test token with another tenant's token.
BEGIN;
SELECT ctx_lab.set_test_context('fixture-token-tenant-a');
DO $tenant_a_visibility$
DECLARE
  n bigint;
  unexpected_b bigint;
BEGIN
  SELECT count(*) INTO n FROM ctx_lab.tenant_records;
  SELECT count(*) INTO unexpected_b FROM ctx_lab.tenant_records
   WHERE tenant_id = '00000000-0000-4000-8000-000000000002';
  IF n <> 1 OR unexpected_b <> 0 THEN
    RAISE EXCEPTION 'tenant A context expected one A row and zero B rows; got total %, B %', n, unexpected_b;
  END IF;
END
$tenant_a_visibility$;
COMMIT;

-- SEC-14: transaction-local context must not survive COMMIT.
DO $transaction_scope$
DECLARE n bigint;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM ctx_lab.tenant_records;
    RAISE EXCEPTION 'context unexpectedly survived transaction boundary';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    NULL;
  END;
END
$transaction_scope$;

-- SEC-10 (test registry only): runtime cannot read the verifier registry.
DO $registry_denial$
BEGIN
  BEGIN
    PERFORM 1 FROM ctx_lab.test_context_registry;
    RAISE EXCEPTION 'runtime unexpectedly read the test context registry';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$registry_denial$;

RESET ROLE;
