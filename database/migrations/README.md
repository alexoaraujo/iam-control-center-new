# Database migrations

Migrations are versioned in this directory and must be reviewed before use.

## Required sequence
1. Review `docs/architecture/iam-contracts.md`.
2. Apply the proposed initial schema only to a clean isolated branch/database.
3. Verify table definitions, composite tenant foreign keys, RLS enabled and forced, and effective runtime grants.
4. Run positive and negative tenant-isolation tests using the actual runtime login/role, not only the owner.
5. Record SHA, migration checksum, SQL test output, and CI evidence in the PR.
6. Apply to Development only after review; then validate Preview. Production requires explicit approval and a recovery plan.

## Important RLS limitation
Migration 0001 uses `app.tenant_id` as the initial policy context. A normal PostgreSQL custom setting is writable by a SQL session; it is not a cryptographically trusted tenant identity. Treat these policies as defense in depth only until the application/database trust boundary is independently validated. Do not claim strong isolation from the GUC alone.

## Recovery
The initial migration is intended for a clean database and is not a destructive reset script. Do not use it against the prototype branch or any database with existing IAM objects. For any non-empty target, author a separate, data-aware corrective migration with explicit preconditions and a reviewed forward-recovery plan.
