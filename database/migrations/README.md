# Database migrations

Migrations are versioned, checksum-verified proposals. This PR replaces the unsafe prototype proposal; it is not authorization to execute.

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
- RLS is enabled and forced on all IAM/audit tables.
- **No RLS policies and no runtime grants are created.** This is deliberate default-deny until trusted context and policy/grant model are approved.
- No source IP/User-Agent is collected in this initial audit proposal.
- Clean database only; never apply over prototype objects or data.

## Migration integrity

The future runner must SHA-256 the exact file bytes, serialize execution with a database advisory lock, and compare version/checksum in the ledger before applying. Same version+checksum is a no-op; same version with different checksum is a hard failure. `IF NOT EXISTS` is not migration idempotency. DDL and ledger write must be atomic.

## Runtime/RLS evidence

Owner/superuser tests are not runtime isolation evidence. Neon connector currently uses `Administrador`; if it cannot assume the effective runtime login, mark verification BLOCKED. Never substitute owner-session results.

## Recovery

Do not run against a non-empty database, existing IAM objects, or a branch containing prototype data. A corrective migration requires explicit preconditions and reviewed forward-recovery plan.
