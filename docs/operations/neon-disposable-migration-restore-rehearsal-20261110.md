# IAM Control Center NEW — Ensaio controlado: RBAC, migrations e recuperação

**Reference GitHub baseline:** `main@e95b938c889c3d2d45f056f946f2351df68b7823` (baseline at test setup; record the PR SHA separately for each CI run).  
**Scope:** ONLY disposable Neon branches and PostgreSQL 18 GitHub Actions ephemeral databases. **No Production mutation, merge, secret change, snapshot of root/Production, cutover or data deletion is authorized.**

## Environment ledger and guardrails

| Resource | ID / identity | Purpose | Status |
|---|---|---|---|
| NEW Neon project | `tiny-rice-70320263` | Scoped Neon account | READ ONLY metadata |
| NEW Neon Development | `br-ancient-term-b6mmx5ol` | Reference schema lineage; no mutation | PRESERVE |
| Neon original disposable | `br-muddy-bar-b63ksdy7` (`validation/iam-cutover-audit-20261110`) | Signed tenant A/B, RBAC and synthetic ledger tests | PASS partial |
| Neon recovery clone | `br-shy-scene-b67zm2v7` (`validation/iam-recovery-clone-20261110`) | Copy-on-write recovery/branch parity | PASS; **TTL 2026-11-12T23:00:00Z** |
| NEW Neon Production | `br-muddy-snow-b63cepcv` | Deployment candidate only, **zero IAM tables** | **NOT CONFIGURED** |
| PostgreSQL 18 disposable CI | GitHub Actions `database-schema-tests` | Restore schema-only, runtime login, RBAC, migration lock tests | Check exact PR run SHA |

Neon source and Development are *not* interchangeable with the new Production branch. The temporary branches are expected to preserve only synthetic IAM records. Do not print HMAC keys/signatures, secrets, connection strings, JWTs, customer records or authentication cookies.

## 1. Live relational RBAC validation completed

Neon `br-muddy-bar-b63ksdy7` already holds two synthetic active tenant/membership/identity fixtures, and an A-tenant `validation_reader` role mapped to `iam.tenant.read`. A transactionally rolled-back PL/pgSQL `DO` proved:
- **PASS**: no assignment means deny by default;
- **PASS**: assigning A's role to A's member grants exactly `iam.tenant.read`; B remains denied and `iam.tenant.update` stays denied;
- **PASS**: assignment of A's role to B is rejected by the composite `(tenant_id,role_id)` FK;
- **PASS**: revoking A's assignment immediately removes the effective relation-based permission;
- **PASS**: reassigning then suspending A's membership removes its effective permission in the tested active-status query;
- **PASS**: authenticated runtime `iam_app_runtime_login` cannot INSERT into `iam.membership_roles` to self-grant, due to SQL privilege rejection;
- **PASS**: all mutations in owner test were undone with an expected subtransaction rollback.

Post-test: A/B memberships remain active; `iam.membership_roles=0`, `iam.roles=1`, `iam.role_permissions=1`, `iam.organizations=0`, `iam.schema_migrations=0`; schema diff vs Development `""`. **This is a relational authorization model contract, not application API enforcement, UI RBAC or Auth0 E2E.**

The regression is versioned as `database/tests/rbac-grant-revoke-rollback.sql`; the PostgreSQL 18 source-restore CI job invokes this script to prevent future model regressions. [database-schema-tests #42948555110](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/42948555110) on Git HEAD `2653725c246e04ed2ce7d51227b505596dd57ef8` **PASS** in all three jobs. [PostgreSQL 18 source-restore job #130287186592](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/42948555110/job/130287186592) logs `PASS: disposable PostgreSQL 18 RBAC grant/revoke/deny/suspend/cross-tenant FK and full fixture rollback` and `PASS: independent PostgreSQL 18 sessions serialize migration lock; release after commit; ledger unchanged`. The first CI attempt failed because a schema-only restore has no seeded permission catalog; the regression fixture was corrected to seed `iam.tenant.read` transactionally and verify its rollback before this PASS.

## 2. Recovery experiment: copy-on-write branch, not snapshot/PITR

A Neon `create_snapshot` attempt on the disposable child branch `br-muddy-bar-b63ksdy7` returned **HTTP 400 `not allowed to snapshot non-root branch`**. No snapshot was created; no Production or root snapshot was attempted.

An initial `create_branch` request with a custom suspend interval failed with HTTP 412 (not permitted on this account), without creating a branch. Retrying with default suspend interval and minimal compute (`0.25 CU`) created **child `br-shy-scene-b67zm2v7`** of disposable `br-muddy-bar-b63ksdy7`. Expiration was explicitly set and confirmed to `2026-11-12T23:00:00Z` to avoid retaining test infrastructure indefinitely.

Verified on clone:
- **PASS** Neon schema diff against source disposable `diff: ""`;
- **PASS** 2 tenants, 2 identities, 2 memberships, 1 role, 1 role permission, 0 membership-role assignments, 0 organizations, 0 migration-ledger records and 41 policies;
- **PASS** live `iam_app_runtime_login` is non-BYPASSRLS and sees zero tenants/memberships without signed context.

**Limit:** clone consistency/parity is **not** evidence of restoring a prior point in time, full disaster recovery, PITR or recovery time objective. That gate remains **BLOCKED**.

A synthetic recovery failure was also injected **on the recovery clone itself**: acquire the transaction advisory lock, CREATE a probe table, INSERT one synthetic row, write a synthetic ledger entry, then throw and catch a controlled sentinel exception. After rollback: probe table absent, ledger still 0 rows, 2 tenants / 2 memberships preserved and branch-to-parent schema diff still empty. **PASS** transactional rollback on clone; still **BLOCKED** true snapshot/PITR restore.

## 3. Migration readiness and rehearsal checklist

### Baseline and lineage — fail closed
1. Verify GitHub SHA + unchanged target branch/project/database and authenticated role; confirm target is disposable, never `br-muddy-snow-b63cepcv` or legacy Production.
2. Freeze an approved schema-only baseline manifest that accounts for schemas, tables/columns, constraints, indexes, triggers, functions including `SECURITY DEFINER` `search_path`, grants, ACLs, RLS policies, extensions and role membership.
3. Historical legacy `0001_context_key_hardening` file in Git commit `b80c98c51746e1d49039015eb649b9bdd735ef7f` has verified SHA-256 `2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab`; preserve this provenance, do not synthesize ledger rows in the target.
4. Do **not** treat `0001_initial_iam_schema.sql`, `0002_sessions_touch_contract.sql`, and `0003_set_tenant_context_search_path.sql` as one universal ordered upgrade: they target different schema lineages and have different preconditions. The full approved canonical baseline plus incremental migration graph is not yet frozen.
5. Build a reviewed migrator runner accepting an explicit manifest with ID, file SHA-256, source commit SHA and target branch, requiring authenticated dedicated migrator, direct TLS endpoint, preflight hash/ledger match, advisory lock and DDL + ledger write in **one transaction**; exact repeated version+hash is a no-op, different hash is hard failure.
6. Reject any schema drift, partial migration, missing predecessor or unapproved migration ID before execution. Maintain before/after schema manifest + ledger row counts and redacted evidence.

### Tests that can safely pass today
- **PASS Neon disposable**: synthetic `iam.record_migration()` repeated same version/checksum -> 1 row inside the test; mismatch, malformed ID/hash rejected; synthetic DDL/DML and ledger then undone by exception subtransaction; ledger stays zero, probe table absent.
- **PASS PostgreSQL 18 CI**: `database/tests/test-migration-lock-concurrency.sh` starts **two separate `psql` processes**; lock holder acquires `iam.acquire_migration_lock()`; second backend must receive `lock_timeout`; third acquires after commit; ledger stays empty. Confirm job's log at the exact SHA.
- **PASS PostgreSQL 18 CI**: canonical source schema-only restore, structural manifest and default-deny runtime login assertions in existing `database-schema-tests`.
- **PASS Neon disposable**: signed HMAC tenant A/B context with genuine runtime LOGIN, cross-tenant SELECT/INSERT/UPDATE denial, same-tenant synthetic mutation and rollback.

### Remaining blockers before a full migration run
- **BLOCKED**: canonical baseline artifact cryptographically tied to the approved legacy source, a reviewed lineage/manifest DAG and a universal migration runner. Do not execute proposed migrations on the synthetic Development-derived schema until exact preconditions and approval exist.
- **BLOCKED**: two simultaneous **external** TLS Neon connections to prove lock contention inside actual Neon (the Neon connector calls did not show independent contention).
- **BLOCKED**: validated backup/restore or PITR of a prior timestamp; snapshot API cannot snapshot non-root branch in this plan.
- **BLOCKED**: independent authorization of Production cutover and verified rollback/restore runbooks, RTO/RPO, observable functional health and Auth0/RBAC application E2E.

## 4. Recovery acceptance runbook for future authorized execution

**Prepare:** capture source SHA/branch ID, DB role attributes, catalog manifest, ledger and row counts before any injected failure. Pre-provision distinct source/destination test branches with TTL and no customer data. Confirm explicit cost-free quota and data isolation.

**Inject and verify:** simulate an *uncommitted* migration writing a synthetic object and synthetic ledger version within the same transaction; raise a controlled exception; assert original manifest/ledger and synthetic row counts unchanged. This was exercised with a PL/pgSQL exception subtransaction, not a backup restore.

**Restore from actual recovery point:** use a provider-supported snapshot or PITR of a dedicated test/root environment only after approval; restore onto **another new branch**, never overwrite the source or Production, then compare schema manifests including owners/ACL, rows/constraints, RLS and runtime-role denies and audit timing. The current child-branch snapshot API rejects snapshots, so this step cannot currently pass. Do not automatically snapshot the project's Production root to work around the limitation.

**Promote only after:** signed evidence of SHA, branch, SQL driver, TLS, authenticated migrator/runtime, independent reviews, playbook for rollback (including DB credential and Vercel alias) and explicit Production authorization. No merge of this audit PR is authorized to trigger Vercel Production.

## 5. Evidence links and decisions

- [PR #40](https://github.com/alexoaraujo/iam-control-center-new/pull/40): updated report, tests and CI checks.
- [Issue #15](https://github.com/alexoaraujo/iam-control-center-new/issues/15): migration/ledger/recovery tracking.
- [Issue #16](https://github.com/alexoaraujo/iam-control-center-new/issues/16): RLS and role isolation.
- [Issue #24](https://github.com/alexoaraujo/iam-control-center-new/issues/24): application RBAC gate.
- [Issue #5](https://github.com/alexoaraujo/iam-control-center-new/issues/5): Production cutover **BLOCKED**.

**Final decision:** Neon RBAC relation testing and clone parity can PASS within their defined scopes; full application RBAC, full lineage migration rehearsal, historical restore/PITR and cutover remain BLOCKED. Production IAM schema remains NOT CONFIGURED.
