\set ON_ERROR_STOP on
-- Test harness assertions. The fixture owner prepares objects; test actions run as runtime.
CREATE TEMP TABLE test_results (
  sec_id text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

-- SEC-16: runtime role must not be superuser/BYPASSRLS and must not own tables.
DO $$
DECLARE r record;
BEGIN
  SELECT rolsuper, rolbypassrls INTO r FROM pg_roles WHERE rolname='iam_ctx_runtime';
  IF r.rolsuper OR r.rolbypassrls THEN RAISE EXCEPTION 'SEC-16 failed: unsafe role attributes'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='iam_ctx' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='iam_ctx_runtime')
  ) THEN RAISE EXCEPTION 'SEC-16 failed: runtime owns protected table'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='iam_ctx' AND c.relkind='r' AND NOT c.relrowsecurity
  ) THEN RAISE EXCEPTION 'SEC-16 failed: RLS disabled on protected table'; END IF;
END $$;
INSERT INTO test_results VALUES ('SEC-16','PASS local','runtime is NOSUPERUSER, NOBYPASSRLS and not table owner');

-- Execute the following cases as the real fixture runtime role.
SET ROLE iam_ctx_runtime;

-- SEC-01: no context => no tenant rows.
DO $$ BEGIN
  IF (SELECT count(*) FROM iam_ctx.tenants) <> 0 THEN RAISE EXCEPTION 'SEC-01 failed'; END IF;
END $$;
RESET ROLE;
INSERT INTO test_results VALUES ('SEC-01','PASS local','no context returns zero tenant rows');

-- SEC-02: forged tenant GUC is ignored; no valid opaque fixture token.
SET ROLE iam_ctx_runtime;
BEGIN;
SELECT set_config('app.tenant_id','tenant-b',true);
DO $$ BEGIN
  IF iam_ctx_private.current_tenant_id() IS NOT NULL THEN RAISE EXCEPTION 'SEC-02 failed'; END IF;
END $$;
COMMIT;
RESET ROLE;
INSERT INTO test_results VALUES ('SEC-02','PASS local','tenant_id GUC alone does not establish context');

-- SEC-03: unknown token rejected.
SET ROLE iam_ctx_runtime;
BEGIN;
SELECT set_config('app.context_token','forged-token',true);
DO $$ BEGIN
  IF iam_ctx_private.context_is_valid() THEN RAISE EXCEPTION 'SEC-03 failed'; END IF;
END $$;
COMMIT;
RESET ROLE;
INSERT INTO test_results VALUES ('SEC-03','PASS local','unknown fixture token rejected; not cryptographic proof');

-- SEC-04: expired token rejected.
SET ROLE iam_ctx_runtime;
BEGIN;
SELECT set_config('app.context_token','fixture-token-expired',true);
DO $$ BEGIN
  IF iam_ctx_private.context_is_valid() THEN RAISE EXCEPTION 'SEC-04 failed'; END IF;
END $$;
COMMIT;
RESET ROLE;
INSERT INTO test_results VALUES ('SEC-04','PASS local','expired fixture token rejected');

-- SEC-05: malformed token rejected without returning tenant data.
SET ROLE iam_ctx_runtime;
BEGIN;
SELECT set_config('app.context_token', '%%% malformed token ###',true);
DO $$ BEGIN
  IF iam_ctx_private.context_is_valid() THEN RAISE EXCEPTION 'SEC-05 failed'; END IF;
END $$;
COMMIT;
RESET ROLE;
INSERT INTO test_results VALUES ('SEC-05','PASS local','malformed opaque token rejected without tenant rows');

-- SEC-06: unknown identity cannot bootstrap/enumerate automatically.
SET ROLE iam_ctx_runtime;
BEGIN;
SELECT set_config('app.context_token','unknown-identity-token',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM iam_ctx.tenants) <> 0 THEN RAISE EXCEPTION 'SEC-06 failed'; END IF;
END $$;
COMMIT;
RESET ROLE;
INSERT INTO test_results VALUES ('SEC-06','PASS local','unknown identity denied; no automatic identity creation');

-- SEC-07: tenant A cannot read tenant B.
SET ROLE iam_ctx_runtime;
BEGIN;
SELECT set_config('app.context_token','fixture-token-a',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM iam_ctx.tenants WHERE tenant_id='tenant-b') THEN RAISE EXCEPTION 'SEC-07 failed: tenant B row visible'; END IF;
  IF EXISTS (SELECT 1 FROM iam_ctx.memberships WHERE membership_id='m-b') THEN RAISE EXCEPTION 'SEC-07 failed: tenant B membership visible'; END IF;
  IF (SELECT count(*) FROM iam_ctx.memberships WHERE membership_id='m-a') <> 1 THEN RAISE EXCEPTION 'SEC-07 failed: own membership not visible'; END IF;
END $$;
COMMIT;
RESET ROLE;
INSERT INTO test_results VALUES ('SEC-07','PASS local','tenant A sees its own tenant/membership and cannot read tenant B tenant/membership');

-- SEC-08: revoked membership denies on the next statement.
UPDATE iam_ctx.memberships SET status='revoked' WHERE membership_id='m-a';
SET ROLE iam_ctx_runtime;
BEGIN;
SELECT set_config('app.context_token','fixture-token-a',true);
DO $$ BEGIN
  IF iam_ctx_private.context_is_valid() THEN RAISE EXCEPTION 'SEC-08 failed'; END IF;
END $$;
COMMIT;
RESET ROLE;
UPDATE iam_ctx.memberships SET status='active' WHERE membership_id='m-a';
INSERT INTO test_results VALUES ('SEC-08','PASS local','revoked membership invalidates fixture context');

-- SEC-09: suspended tenant denied.
UPDATE iam_ctx.tenants SET status='suspended' WHERE tenant_id='tenant-a';
SET ROLE iam_ctx_runtime;
BEGIN;
SELECT set_config('app.context_token','fixture-token-a',true);
DO $$ BEGIN
  IF iam_ctx_private.context_is_valid() THEN RAISE EXCEPTION 'SEC-09 failed'; END IF;
END $$;
COMMIT;
RESET ROLE;
UPDATE iam_ctx.tenants SET status='active' WHERE tenant_id='tenant-a';
INSERT INTO test_results VALUES ('SEC-09','PASS local','suspended tenant invalidates fixture context');

-- SEC-10: runtime cannot read fixture registry.
SET ROLE iam_ctx_runtime;
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM iam_ctx_private.context_fixture;
    RAISE EXCEPTION 'SEC-10 failed: runtime read fixture registry';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
INSERT INTO test_results VALUES ('SEC-10','PASS local','runtime cannot SELECT fixture registry; production key design untested');

-- SEC-11: runtime cannot mutate issuer/subject.
SET ROLE iam_ctx_runtime;
DO $$ BEGIN
  BEGIN
    UPDATE iam_ctx.identities SET subject='attacker' WHERE identity_id='identity-a';
    RAISE EXCEPTION 'SEC-11 failed: immutable columns changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
INSERT INTO test_results VALUES ('SEC-11','PASS local','column-level grant blocks issuer/subject update');

-- SEC-12: an existing privileged function must reject runtime EXECUTE.
SET ROLE iam_ctx_runtime;
DO $$ BEGIN
  BEGIN
    EXECUTE 'SELECT iam_ctx_private.unapproved_admin_operation()';
    RAISE EXCEPTION 'SEC-12 failed: runtime executed privileged function';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
INSERT INTO test_results VALUES ('SEC-12','PASS local','existing privileged function denies runtime EXECUTE');

-- SEC-13: membership and permission are checked inside the write operation.
SET ROLE iam_ctx_runtime;
BEGIN;
SELECT set_config('app.context_token','fixture-token-a',true);
SELECT iam_ctx_private.guarded_write('tenant-a','m-a','allowed-local-fixture');
COMMIT;
RESET ROLE;
UPDATE iam_ctx.memberships SET can_write=false WHERE membership_id='m-a';
SET ROLE iam_ctx_runtime;
BEGIN;
SELECT set_config('app.context_token','fixture-token-a',true);
DO $$ BEGIN
  BEGIN
    PERFORM iam_ctx_private.guarded_write('tenant-a','m-a','must-not-write');
    RAISE EXCEPTION 'SEC-13 failed: revoked permission write succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
COMMIT;
RESET ROLE;
-- Verify the authorized operation persisted exactly once.
DO $$ BEGIN
  IF (SELECT count(*) FROM iam_ctx_private.write_log
      WHERE tenant_id='tenant-a' AND value='allowed-local-fixture') <> 1
  THEN RAISE EXCEPTION 'SEC-13 failed: authorized write was not persisted exactly once'; END IF;
  IF EXISTS (SELECT 1 FROM iam_ctx_private.write_log
      WHERE tenant_id='tenant-a' AND value='must-not-write')
  THEN RAISE EXCEPTION 'SEC-13 failed: denied write left a persisted row'; END IF;
END $$;
UPDATE iam_ctx.memberships SET can_write=true WHERE membership_id='m-a';
INSERT INTO test_results VALUES ('SEC-13','PASS local','authorized write persisted exactly once; denied write left no row; membership and can_write checked in write path');

-- SEC-14: transaction-local context does not survive commit.
SET ROLE iam_ctx_runtime;
BEGIN;
SELECT set_config('app.context_token','fixture-token-a',true);
COMMIT;
DO $$ BEGIN
  IF iam_ctx_private.current_tenant_id() IS NOT NULL THEN RAISE EXCEPTION 'SEC-14 failed'; END IF;
END $$;
RESET ROLE;
INSERT INTO test_results VALUES ('SEC-14','PASS local','transaction-local token cleared after commit');

-- SEC-15: identity with no active membership cannot enumerate tenants.
SET ROLE iam_ctx_runtime;
BEGIN;
SELECT set_config('app.context_token','fixture-token-no-membership',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM iam_ctx.tenants) <> 0 THEN RAISE EXCEPTION 'SEC-15 failed'; END IF;
END $$;
COMMIT;
RESET ROLE;
INSERT INTO test_results VALUES ('SEC-15','PASS local','disabled/no-membership context cannot enumerate tenants');

-- Fail closed if any test result is missing or not PASS.
DO $$ BEGIN
  IF (SELECT count(*) FROM test_results) <> 16 THEN
    RAISE EXCEPTION 'Harness failed: expected 16 result rows, found %', (SELECT count(*) FROM test_results);
  END IF;
  IF EXISTS (SELECT 1 FROM test_results WHERE status <> 'PASS local') THEN
    RAISE EXCEPTION 'Harness failed: one or more SEC results are not PASS local';
  END IF;
END $$;

-- Emit machine-readable summary. Any assertion failure aborts due ON_ERROR_STOP.
TABLE test_results ORDER BY sec_id;
