# IAM runtime role and default-ACL reconciliation — gated proposal

Status: **PROPOSAL / TEST ONLY**. No direct Neon DDL has been authorized by this document. The SQL below is **not** a migration runner nor permission to modify persistent Development or Production.

## Observed read-only facts (12 Nov 2026)

Legacy source `twilight-fire-88497009/main/iam_database`: `iam_app_runtime_login` is LOGIN/NOINHERIT/NOBYPASSRLS and has group `iam_app_runtime` with member flags INHERIT TRUE, SET TRUE. Dedicated `iam_migrator_login` and `iam_worker_login` exist. The migration ledger contains one verified `0001_context_key_hardening` row.

NEW Development `tiny-rice-70320263/development/iam_database`: `iam_app_runtime_login` is LOGIN/INHERIT/NOBYPASSRLS and inherits only `iam_app_runtime` with INHERIT TRUE, SET FALSE. Dedicated migrator/worker login roles are absent. Its historical ledger is **empty**.

Default ACLs on NEW: for objects **created in schema `public` by `neondb_owner` in the future**, `iam_app_runtime_login` automatically receives SELECT/INSERT/UPDATE/DELETE on tables and SELECT/USAGE on sequences. These six future grants are not present on the legacy source and are contrary to the desired least-privilege model. These are not direct grants on existing IAM tables. A role's mere INHERIT attribute is not itself proof of an RBAC exploit, and copying NOINHERIT can break the runtime.

## Proposed remediation, only after explicit operator/release gate

1. Inventory the six default ACL entries and the runtime usage of `public`, including migration/application owners, privileges and any extensions. Snapshot a fresh source+destination manifest. Confirm a direct **non-pooled** administrative connection and recovery checkpoint.
2. Test the change on a NEW disposable branch, including signed tenant context A/B, grant/revoke, no-context deny, direct LOGIN, migration roles, rollback and repeated preflight.
3. The minimal PostgreSQL command shape, to be applied **only** as the exact owning role of these defaults in a separately reviewed migration transaction:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM iam_app_runtime_login;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  REVOKE SELECT, USAGE ON SEQUENCES FROM iam_app_runtime_login;
```

This *does not* revoke existing table access, alter RLS, copy historical ledger rows or modify membership. Do not run as a runtime role or blind copy/paste into Production. Preflight should assert exactly the six expected ACL entries and postflight should assert none, while respecting other grantees.

4. Do **not** automatically `ALTER ROLE iam_app_runtime_login NOINHERIT` or add migrator/worker LOGIN roles: these differ from legacy for potentially intentional reasons; require an independently reviewed authorization graph and credential/ownership design.
5. Ledger: `source=1`, `NEW=0` is **BLOCKED** regardless of schema object count parity. Baseline marker cannot masquerade as a historical migration. Require immutable source artifact, approved baseline, checksum chain, transactional runner, and fail-closed mismatch handling.
6. Backup/restore: PostgreSQL18 CI restores a **versioned repository schema dump**, not an export freshly taken from legacy Neon. It does not establish production data restore, Neon PITR or RTO/RPO. Run the rehearsal with isolated branch and direct connection only after backup design/reviewer authorization.
7. Cutover: separate manual go/no-go after baseline+ledger, privilege security tests, actual Neon restore/PITR and precise release-SHA Auth0 E2E. Never auto-merge these proposals to `main` if doing so can trigger Production.

## Tested evidence

`database/tests/default-acl-runtime-hardening-fixture.sql` reproduces six default grants in an ephemeral PostgreSQL 18 transaction, applies the minimal revokes, creates future table and sequence probes, tests all six privileges denied, and **ROLLBACK** removes everything. The fixture refuses any database other than `iam_schema_test` or a session not authenticated as `postgres`. It also ensures `rolinherit` remains unchanged. This test does **not** approve persistent Neon changes.

PEOS gate: **CI fixture may PASS independently**, while Production/Neon default-ACL remediation, historical ledger, restore/PITR, and cutover stay BLOCKED until their distinct gates pass.
