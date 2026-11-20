# Neon canonical drift inventory — 2026-11-12

**Status: BLOCKED / read-only.** This record is a catalog snapshot, **not** a migration, cutover authorization, data-copy validation, or independent approval.

## Verified environments
- **Origin:** project `twilight-fire-88497009`, branch `main` (`br-little-fire-b6adup9f`), database `iam_database`.
- **Target:** project `tiny-rice-70320263`, branch `development` (`br-ancient-term-b6mmx5ol`), database `iam_database`.
- PostgreSQL **18.6** in both; separate Neon organizations. Read-only pg_catalog queries on 2026-11-12.
- `tiny-rice-70320263/production` still has **no IAM schema**; it was **not modified**.
- Catalog collection used `database/scripts/schema-manifest.sql` as extended by PR #44 with SHA-256 of function definitions. No application rows, passwords, signing keys, or function bodies were stored in this evidence.

## Verified identical object counts (IAM, audit, app_private)
| Category | Origin | Target |
| --- | ---: | ---: |
| Tables | 23 | 23 |
| Views | 1 | 1 |
| RLS policies | 41 | 41 |
| FORCE RLS tables | 20 | 20 |
| Routines in application schemas | 9 | 9 |
| Non-internal triggers | 12 | 12 |
| ENUMs | 7 | 7 |
| Indexes | 63 | 63 |

**Count equality is not canonical parity.** Function-definition hashes, RLS policy definitions, index definitions, trigger definitions and structural relation signatures were also compared: **149 identities, one drift**. The drift is `iam.set_tenant_context(uuid, uuid, bigint, text, text)`: the origin SECURITY DEFINER function includes `public` in `search_path`; NEW Development intentionally excludes it. **Never downgrade the target security posture merely to force matching counts/hashes.**

## Full manifest section reconciliation
The full schema manifest also includes `public`, database ACLs, role metadata and PostgreSQL role memberships. Differences are object identities only; underlying bodies/expressions and checksums are not printed.

| Manifest section | Origin entries | Target entries | Drift entries |
| --- | ---: | ---: | ---: |
| schemas | 4 | 4 | 0 |
| relations | 27 | 27 | 0 |
| sequences | 3 | 3 | 0 |
| routines | 46 | 46 | **1** |
| aggregates | 0 | 0 | 0 |
| types | 7 | 7 | 0 |
| triggers | 12 | 12 | 0 |
| policies | 41 | 41 | 0 |
| extensions | 2 | 2 | **1** |
| expanded_object_acls | 386 | 384 | **4** |
| default_acls | 9 | 15 | **6** |
| database_acl | 9 | 8 | **17** |
| roles | 29 | 26 | **6** |
| role_memberships | 26 | 19 | **23** |

Total: **58 differences across seven sections**. `pgcrypto` is version `1.4` in both, but its **owner differs** (`iam_database_owner` vs `neondb_owner`). Some database and role-ownership differences are environmental, not necessarily issues to copy; each exception requires an explicit security review.

## Operational drift requiring gate decisions
- The origin has dedicated `iam_migrator_login`, `iam_worker_login`, `iam_schema_export_reader` and `iam_database_owner`. NEW Development lacks them, uses `neondb_owner`, and differs in membership grants and effective role assumptions.
- `iam_app_runtime_login` is `NOINHERIT` at the origin, `INHERIT` at NEW; both are **LOGIN**, **non-SUPERUSER**, **non-BYPASSRLS**. `SET ROLE` options differ.
- NEW Development has **six future default ACL grants** from `neondb_owner` in schema `public` to `iam_app_runtime_login`: table SELECT/INSERT/UPDATE/DELETE; sequence SELECT/USAGE. Origin has none.
- A separate schema ACL exposes `public` USAGE to runtime in NEW; three origin-only schema USAGE grants to the dedicated export reader are absent in NEW.
- The origin historical `iam.schema_migrations` ledger contains **one** `0001_context_key_hardening` entry; NEW Development ledger contains **zero** entries. Do **not** fabricate ledger rows or infer that schema count parity means a historical migration ran.

## Required next PEOS gates (no automatic promotion)
1. Review source/target object owners, actual effective grants, `SECURITY DEFINER` bodies and runtime RLS behavior; classify safe environmental exceptions explicitly.
2. Test minimally scoped default-ACL remediation on an **independently approved disposable Neon clone**, with a recorded preflight, rollback and runtime login tests. CI PostgreSQL18 rollback fixture is not equivalent to a Neon acceptance test.
3. Reconcile historical ledger with provenance and checksums, plus source DDL export, migration runner ordering/idempotence and recovery test.
4. Prove signed-context tenant A/B, grant/revoke, deny-by-default, Auth0 exact-SHA E2E and backup/restore/PITR before any release/cutover authorization.
5. Obtain independent review on the **latest** PR SHA; keep Draft and Production unchanged while any gate remains blocked.

Related: [PR #44](https://github.com/alexoaraujo/iam-control-center-new/pull/44), [PR #45](https://github.com/alexoaraujo/iam-control-center-new/pull/45), [issues #5](https://github.com/alexoaraujo/iam-control-center-new/issues/5), [#14](https://github.com/alexoaraujo/iam-control-center-new/issues/14), [#15](https://github.com/alexoaraujo/iam-control-center-new/issues/15).
