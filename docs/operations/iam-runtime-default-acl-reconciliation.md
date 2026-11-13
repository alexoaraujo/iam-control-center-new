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

## Read-only live preflight — independently rechecked 2026-11-12

`database/scripts/neon-runtime-default-acl-preflight.sql` is a single **SELECT** suitable for read-only execution against a verified, explicitly selected Neon project/branch/database. It outputs only catalog metadata, role flags, counts and a fail-closed verdict; it never writes grants, opens a transaction or prints credentials. A SQL session alone **cannot prove** which Neon branch it targets, so verify project ID, branch ID, database name and current connection independently before drawing a conclusion.

- Legacy `twilight-fire-88497009` / `br-little-fire-b6adup9f`: `METADATA_ONLY_NO_FUTURE_DEFAULT_GRANTS`, total=0, runtime LOGIN=true, BYPASSRLS=false, INHERIT=false.
- NEW Development `tiny-rice-70320263` / `br-ancient-term-b6mmx5ol`: `BLOCKED_SIX_FUTURE_DEFAULT_GRANTS`, total=6, expected=6, unexpected=0, runtime LOGIN=true, BYPASSRLS=false, INHERIT=true.

`METADATA_ONLY` is **not** authorization to migrate, and all `BLOCKED_*` outcomes prevent promotion. The revised PostgreSQL18 fixture tests the actual `ALTER DEFAULT PRIVILEGES FOR ROLE <owner>` syntax, checks existing objects retain their already granted rights, confirms future objects are denied and verifies transactional cleanup. Existing object grants require separate inspection: future-default ACL revocation is **not retroactive**. As before, the fixture is not an approved Neon DDL rehearsal.

The complete [schema/role/ACL drift report on PR #44](https://github.com/alexoaraujo/iam-control-center-new/blob/test/canonical-manifest-diff-gate-20261112/docs/evidence/neon-canonical-drift-inventory-2026-11-12.md) is on PR #44; until that PR is integrated, use its branch path as the evidence location. No persistent Neon SQL, role change, ledger backfill or Production update was made by this preflight.

## SECURITY DEFINER access / search_path gate — 2026-11-12

New single-SELECT, read-only script: `database/scripts/neon-security-definer-preflight.sql`. It checks function ownership, `EXECUTE` granted to PUBLIC, `USAGE` granted to PUBLIC on the containing schema, runtime `EXECUTE`, and whether `search_path` includes `public`. It never executes these routines or prints their bodies. The preflight was executed on the legacy source, NEW Development and disposable NEW clone.

| Control | Legacy source | NEW Development | NEW clone |
| --- | ---: | ---: | ---: |
| SECURITY DEFINER routines | 6 | 6 | 6 |
| Routines with PUBLIC EXECUTE | 1 | 1 | 1 |
| PUBLIC EXECUTE **and** PUBLIC schema USAGE | 0 | 0 | 0 |
| Routines with `public` in `search_path` | 1 | 0 | 0 |

The one PUBLIC-executable function is `iam.clear_tenant_context()`. The schema `iam` does not grant PUBLIC USAGE in the three tested environments, so the two prerequisites for an unprivileged PUBLIC invocation are not currently both satisfied; this is **not** proof of no vulnerability under every role or future permission change. The origin `iam.set_tenant_context(...)` includes `public` in the SECURITY DEFINER search_path; the target removes it. Do **not** weaken the target to match the origin.

The result is **REVIEW**, not PASS: the policy must explicitly decide whether to revoke PUBLIC EXECUTE on `clear_tenant_context()`, keep schema USAGE restricted, and inspect effective EXECUTE grants and the reviewed function bodies. Changes to persistent ACLs or functions require separately authorized DDL with rollback and tests in a disposable Neon clone. No DDL was applied in this verification.
