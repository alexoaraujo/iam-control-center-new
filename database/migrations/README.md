# Database migrations

Migrations are versioned in this directory and must be reviewed before use.

## Connection contract
- Application runtime uses `DATABASE_URL` with the Neon pooled hostname (`-pooler`) and the least-privileged runtime login.
- Migration execution uses `DATABASE_MIGRATION_URL` with a direct Neon hostname (no `-pooler`) and a dedicated migration identity.
- The migration URL must exist only in a protected migration runner/environment. Never expose it to the web application runtime.
- Do not execute schema migrations through the transaction pooler.
- The repository currently has no implemented PostgreSQL runtime client or migration runner. These variable names document the intended boundary; they are not evidence of working connectivity or execution.
- See [Neon connection pooling](../../docs/architecture/neon-connection-pooling.md).

## Required sequence
1. Review `docs/architecture/iam-contracts.md`.
2. Apply the proposed initial schema only to a clean isolated branch/database.
3. Verify table definitions, composite tenant foreign keys, RLS enabled and forced, and effective runtime grants; runtime must not write tenants, roles, membership-role assignments, role-permission mappings, or the permission catalog directly.
4. Run positive and negative tenant-isolation tests using the actual runtime login/role, not only the owner.
5. Record SHA, migration checksum, SQL test output, and CI evidence in the PR. The Neon connector may be pinned to an administrative role; if it cannot execute as the effective runtime login, mark runtime/RLS verification BLOCKED and do not substitute owner-session results.
6. Apply to Development only after review; then validate Preview. Production requires explicit approval and a recovery plan.

## Important RLS limitation
Migration 0001 uses `app.tenant_id` as the initial policy context. A normal PostgreSQL custom setting is writable by a SQL session; it is not a cryptographically trusted tenant identity. Treat these policies as defense in depth only until the application/database trust boundary is independently validated. Do not claim strong isolation from the GUC alone.

## Recovery
The initial migration is intended for a clean database and is not a destructive reset script. Do not use it against the prototype branch or any database with existing IAM objects. For any non-empty target, author a separate, data-aware corrective migration with explicit preconditions and a reviewed forward-recovery plan.
