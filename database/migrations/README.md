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

## Migration integrity

The future runner must SHA-256 the exact file bytes, serialize execution with a database advisory lock, and compare version/checksum in the ledger before applying. Same version+checksum is a no-op; same version with different checksum is a hard failure. `IF NOT EXISTS` is not migration idempotency. DDL and ledger write must be atomic.

## Runtime/RLS evidence

Owner/superuser tests are not runtime isolation evidence. Neon connector currently uses `Administrador`; if it cannot assume the effective runtime login, mark verification BLOCKED. Never substitute owner-session results.

## Recovery

Do not run against a non-empty database, existing IAM objects, or a branch containing prototype data. A corrective migration requires explicit preconditions and reviewed forward-recovery plan.
