# Source-applied migration archive

This directory preserves SQL artifacts that were already applied to the operational Neon source and are represented in the approved schema-only baseline.

## 0001_context_key_hardening

- Historical migration ID: `0001_context_key_hardening`
- SHA-256 recorded in the source ledger: `2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab`
- Source Git SHA recorded in the source ledger: `b80c98c51746e1d49039015eb649b9bdd735ef7f`
- Execution principal: `iam_migrator_login`
- Source ledger applied_at: `2026-11-05T04:16:49.492Z` (UTC)

## Operational rule

This is an **archive**, not a directory of pending migrations. The source schema dump already contains the effects of this migration. Do not replay this file against the restored source baseline, do not renumber its historical ledger ID, and do not infer that it is the predecessor of `0001_initial_iam_schema.sql`.

The file is executed by CI only against a disposable PostgreSQL 18 fixture to test the historical SQL's fail-closed preflight, DDL, ledger, idempotency, and rollback behavior. It must never be run against persistent Neon or Production as part of this archive workflow.

The clean-database bootstrap proposal and the already-applied operational source history are distinct baseline tracks. Any future unification requires a separately reviewed migration-lineage decision.
