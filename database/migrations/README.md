# Database migrations

Migrations are versioned, checksum-verified proposals. This PR replaces the unsafe prototype proposal; it is not authorization to execute.

## Connection contract

- Application runtime uses `DATABASE_URL` with TLS and the least-privileged runtime login.
- Canonical Neon Production, Development and Preview currently report `pooler_enabled=false`; do not use a `-pooler` hostname until Neon confirms pooling is enabled and a real connection test passes.
- While pooler remains disabled, use the verified direct endpoint for Development runtime testing only. The runtime identity and connection are still BLOCKED until a real credential and `SELECT 1` test exist.
- Migration execution uses `DATABASE_MIGRATION_URL` with a direct endpoint and a dedicated migrator identity; never expose it to the web runtime.
- The repository has no implemented migration runner. These variable names define a boundary, not proof of connectivity or execution.
- See [Neon connection pooling](../../docs/architecture/neon-connection-pooling.md).

## Required review sequence

1. Review `docs/architecture/iam-decisions.md` and `docs/architecture/tenant-context-rfc.md`.
2. Confirm the target is a clean isolated PostgreSQL database.
3. Confirm `iam_owner`, `iam_migrator`, `iam_app_runtime` exist and are NOLOGIN/NOBYPASSRLS. Migration 0001 requires effective `current_user = iam_owner`; it creates/changes no roles.
4. Separately approve and prove how the migrator login can assume `iam_owner`. Current Neon role-membership evidence does not establish that path; until then execution is BLOCKED.
5. Review ownership, grants, RLS flags, composite tenant FKs and absence of runtime access.
6. Run PostgreSQL 18 disposable CI tests. They validate schema constraints and default-deny only, not Neon runtime or a trusted tenant context.
7. Record PR head SHA, SHA-256 migration checksum, SQL output and CI run URL.
8. Only after human review, separately authorize Development execution. Preview follows. Production requires independent explicit approval and recovery plan.

## Security posture

- PostgreSQL 18; no extension installed or required.
- No role changes, seed data, policies or runtime grants.
- `slug` is optional and unique when present.
- Identity key is exact `(issuer, subject)`; email is not an authorization key.
- Tenant-scoped relations use composite foreign keys.
- RLS is enabled and forced on business and audit tables. The migration ledger `iam.schema_migrations` is excluded from RLS as privileged control metadata and receives no runtime or PUBLIC grants.
- **No RLS policies and no runtime grants are created.** This is deliberate default-deny until trusted context and policy/grant model are approved.
- No source IP/User-Agent is collected in this initial audit proposal.
- Clean database only; never apply over prototype objects or data.

## Corrective migration 0002 — sessions touch contract

- `0002_sessions_touch_contract.sql` is a separate corrective migration for the existing Development-derived schema, where `iam.sessions` already exists and has `last_seen_at` but no `updated_at`.
- It preserves migration 0001 unchanged and does not modify the shared `iam.touch_updated_at()` function used by nine other tables.
- It introduces `iam.touch_session_last_seen_at()`, rebinds only `iam.sessions_touch`, and fails closed unless the existing trigger points to `iam.touch_updated_at()` and the expected columns are present.
- This is not a clean-database migration and must not be appended to the 0001 clean-install pipeline. Apply only after schema-lineage review on an isolated Development-derived branch.
- Contract test: `database/tests/0002_sessions_touch_contract.sql`. Run after migration 0002 using the authenticated migrator login with the `iam_migrator_login -> iam_migrator -> iam_owner` SET chain. The test rolls back its temporary probe objects.
- The repository still has no general migration runner. Do not infer automatic migration discovery or checksum-ledger registration.

## Migration integrity

The future runner must SHA-256 the exact file bytes, serialize execution with a database advisory lock, and compare version/checksum in the ledger before applying. Same version+checksum is a no-op; same version with different checksum is a hard failure. `IF NOT EXISTS` is not migration idempotency. DDL and ledger write must be atomic.

## Runtime/RLS evidence

Owner/superuser tests are not runtime isolation evidence. Neon connector currently uses `Administrador`; if it cannot assume the effective runtime login, mark verification BLOCKED. Never substitute owner-session results.

## Recovery

Do not run against a non-empty database, existing IAM objects, or a branch containing prototype data. A corrective migration requires explicit preconditions and reviewed forward-recovery plan.

## Migration 0003 — SECURITY DEFINER search_path hardening

- `0003_set_tenant_context_search_path.sql` is a targeted **review-only** corrective migration for the canonical IAM source schema. It removes `public` from `iam.set_tenant_context(uuid, uuid, bigint, text, text)`'s function-local `search_path`, retaining `pg_catalog, app_private, iam`. It does **not** change the function body, grants, ownership, or tenant context algorithm.
- Preflight requires effective `current_user=iam_owner`, the exact function signature, a secure original `SECURITY DEFINER` contract, and an expected prior `search_path`. Unexpected schema lineages fail closed; do not apply to the empty Neon NEW database or replace the canonical source dump blindly.
- Disposable PostgreSQL 18 schema-restore jobs exercise the migration under `SET ROLE iam_owner`, run `database/tests/0003_set_tenant_context_search_path_contract.sql`, and then run the existing tenant-context/RLS restore tests. The contract fails if *any* IAM `SECURITY DEFINER` function has a `public` search-path component or lacks a local configuration.
- A passing disposable test proves only the DDL can be corrected on a fixture; it is **not** evidence that migration 0003 was applied to legacy Neon Production, new Neon Development, or new Neon Production.
- Before real execution, an approved migration runner must verify a direct non-pooled migration connection, role-assumption graph, privileges, checksum/ledger, backup/rollback, and operator authorization, recording the before/after effective configuration. Avoid schema changes on Production until approved.

## Disposable CI real runtime login gate

The `postgres-18-source-schema-restore` and `postgres-18-source-schema-restore-manifest` GitHub jobs additionally run `database/tests/run-ci-runtime-login.sh` **after** the canonical schema restore and signed-context synthetic fixtures rollback.

This test is deliberately restricted to `postgresql://postgres@localhost:5432/iam_source_restore_test` on PostgreSQL 18+. It creates a **new PostgreSQL LOGIN principal** `iam_app_runtime_login` in the disposable service, gives it only `iam_app_runtime` inheritance (not `iam_owner` or `iam_migrator`), revokes `TEMP` from `PUBLIC`, and opens an **independent authenticated network connection** as that login. The ephemeral service password is imported from the existing `PGPASSWORD` environment in memory via psql `\\getenv`; no new persistent credential or Neon connection is used.

`database/tests/ci-runtime-login-gate.sql` fails closed if the direct login can bypass RLS, create schema/temp objects, inherit owner privileges, view tenant data without signed context, or insert an unscoped organization. It also checks the 23-table/41-policy/20-FORCE-RLS baseline. No successful data writes or real tenant records are created by this gate.

This new CI test complements rather than replaces the existing `runtime-rls-contract.sql` signed tenant A/B tests (run using `SET ROLE`) and the verified direct runtime-login tests on the **NEW Neon Development** and isolated fixture branches. Passing CI is not evidence of Auth0 E2E, RBAC administration, or Production migration.

## Migration 0004 — Auth0 identity sync capability (PR #42, isolated only)

- The repository already has `0003_set_tenant_context_search_path.sql`; the new Auth0 writer is **0004**. A regression test in `scripts/migration-identifiers.test.mjs` prevents duplicate numeric migration identifiers.
- `0004_auth0_identity_sync_capability.sql` defines `iam.sync_auth0_identity(...)` as a restricted `SECURITY DEFINER` function. Caller `iam_app_runtime_login` keeps **no** direct identity `INSERT` or `UPDATE`; issuer and argument shape are validated; tenant memberships and roles are never granted by this function.
- The clean-install `0001` schema intentionally has no owner policy; CI uses a clearly named `iam_owner_access` policy **fixture** while testing 0004, and does not imply that this fixture belongs in the initial migration. The actual Neon Development-derived schema already has that owner policy.
- All PostgreSQL 18 tests and the actual Auth0 authenticated Preview E2E run on disposable clones. **Do not run 0004 on permanent Development/Production without a separate migration review, ledger reconciliation, recovery plan, and explicit approval.**
- The actual Neon NEW Development `iam.schema_migrations` schema uses `migration_id, checksum_sha256, source_sha, applied_at, execution_role`; its ledger and that of the PR42 validation clone were empty when inspected. In contrast, the clean-install 0001 ledger uses `version, name, checksum, applied_at, applied_by`. Do not backfill the ledger from an assumed filename or claim schema-version parity without reconciling that structural difference.
