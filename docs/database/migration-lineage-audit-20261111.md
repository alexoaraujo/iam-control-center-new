# IAM Control Center NEW — Reconciliação canônica de migrations (preflight read-only)

**Audited git baseline:** `main@e95b938c889c3d2d45f056f946f2351df68b7823`.  
**Status:** **BLOCKED** for migration execution / Production cutover. This is evidence, not an approved baseline or migration runner.

## Evidence sources and boundaries

| Resource | Branch/project | Database | Verified schema | Migration ledger |
|---|---|---|---|---|
| Legacy provenance source | `twilight-fire-88497009 / br-little-fire-b6adup9f` | `iam_database` | 20 IAM tables, tenant context function search_path includes `public` | **1 historical entry** |
| NEW Development | `tiny-rice-70320263 / br-ancient-term-b6mmx5ol` | `iam_database` | 20 IAM schema tables, tenant context function already hardened (no `public`); 23 app/audit/control tables overall | **0 entries** |
| NEW disposable audit | `tiny-rice-70320263 / br-muddy-bar-b63ksdy7` | `iam_database` | same as NEW Development; synthetic tenants, no migration mutations persisted | **0 entries** |
| NEW Production | `tiny-rice-70320263 / br-muddy-snow-b63cepcv` | `iam_database` | **0 IAM tables** and no tenant context function | **NOT CONFIGURED** |

Observations were collected with SELECT against explicitly specified project, branch and database, not by interpreting the name `production`. The 20-table count is for schema `iam`; the broader 23-table count includes `audit` and `app_private`.

## Historical provenance

The legacy ledger row is `migration_id=0001_context_key_hardening`, checksum SHA-256 `2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab`, `source_sha=b80c98c51746e1d49039015eb649b9bdd735ef7f`. The original GitHub SQL file at that commit has been hash-verified previously. This entry is historical, **not** an instruction to insert it into NEW Development or Production, nor a substitute for an approved schema-only baseline.

### Candidate applicability matrix

| File | Target lineage | Observed preconditions | Decision |
|---|---|---|---|
| `0001_initial_iam_schema.sql` | Empty clean database, migrator principal and role bootstrap | NEW Development and disposable are **non-empty**; NEW Production is empty but lacks approved complete baseline / roles / recovery | **BLOCKED**; proposal is not the canonical bootstrap |
| `0002_sessions_touch_contract.sql` | Existing Development-derived schema whose `iam.sessions` has `last_seen_at`, no `updated_at`, `sessions_touch → iam.touch_updated_at()` | All three preconditions are true on NEW Development and disposable | **ELIGIBLE FOR FURTHER REVIEW ONLY**; no migrator/ledger/restore authorization, not executed |
| `0003_set_tenant_context_search_path.sql` | Existing canonical schema with SECURITY DEFINER function and approved original or hardened search_path | Legacy source still has `pg_catalog, app_private, iam, public`; NEW Development/disposable already have `pg_catalog, app_private, iam` | **BLOCKED** pending source lineage and approved migrator; avoid pointless reapplication to already hardened NEW |
| `0001_context_key_hardening.sql` (historic at `b80c98c`) | Existing legacy source; proof of previous execution | Legacy ledger confirms exact historical checksum; NEW ledgers do not | **HISTORICAL ONLY**; preserve without renaming/replaying/fabricating ledger |

`scripts/check-migration-lineage.mjs` now produces SHA-256 inventory of the exact three SQL candidate files and rejects missing, unexpected, duplicate lineage or accidentally executable status. Its manifest `database/migrations/lineage-policy.json` explicitly refuses to authorize migration execution. CI tests verify that policy fails closed. **It is an inventory and preflight, not a migration runner.**

### Missing evidence required for a canonical chain

1. Approved authenticated schema-only export from the source using the dedicated least-privileged export reader, plus immutable SHA-256 and complete object manifest (relations/ACL/owners/functions/bodies/policies/triggers/etc.).
2. Restore onto a fresh disposable PostgreSQL 18/Neon environment, comparing object definitions, not merely table/policy counts, and proving runtime RLS/RBAC and TLS connectivity.
3. Ledger adoption marker for the baseline itself, distinct from historical migration rows. Reconcile the historical source ledger separately.
4. Reviewed, immutable **new IDs** for applicable incremental migrations, dependencies/predecessors, exact file checksum, before/after contracts and reversibility. Do not infer order from the old `0001/0002/0003` filenames.
5. Dedicated non-BYPASSRLS migrator via direct TLS endpoint, transaction-scoped advisory lock, atomic DDL + checksum ledger, independent session concurrency, failure injection and end-to-end restore proof.
6. Independent reviewer and explicit authorized Development rollout before considering staging or NEW Production.

**No DDL, migration replay, ledger changes, role grants, credential change, merge or Production deployment were performed as part of this lineage reconciliation.**
