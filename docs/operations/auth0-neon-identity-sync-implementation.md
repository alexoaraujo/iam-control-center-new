# Auth0 -> Neon identity synchronization (development proposal)

## Scope

- Reuses `iam.identities` and its unique key `(issuer, subject)`; does not create a parallel user table.
- Auth0 owns login; tenant membership, RBAC and RLS remain separately controlled by IAM.
- `POST /api/identity/sync` reads *only* verified Auth0 SDK session claims, never client-supplied identity.
- Disabled by default; `AUTH0_NEON_SYNC_ENABLED=true` requires explicit development rollout approval.
- `syncExistingUsers()` accepts a trusted async iterator for existing users; no tenant/user export or credentials are stored.
- Do not enable this endpoint against Production, and do not set the flag before runtime RLS and least-privilege tests.

## Critical schema-lineage caveat

The checked-in clean-install `0001_initial_iam_schema.sql` differs from the source `iam_database_schema.sql`.
Both include `iam.identities` and `(issuer, subject)`, but column sets, default status, and policies differ.
The SQL deliberately touches only common columns, but the actual runtime role may have no INSERT/UPDATE rights
and FORCE RLS may reject writes. In that state, synchronization correctly returns 503; **do not bypass RLS**.
Review a dedicated owner-controlled capability, narrow grants and real runtime tests on a disposable Neon branch
before enabling. Do not execute a migration merely to make this test pass.

## Existing users

A privileged, **server-side** migration operator can obtain a paginated Auth0 Management API export
(or user export job for large tenants), parse records into `{sub: user_id, email, email_verified, name}`,
and feed the records to `syncExistingUsers(sql, issuer, users)`.
The import must be tied to the same verified issuer, run only against isolated Development, and
record aggregate counts/error codes without printing PII. Retry after interruption is safe because
`(issuer, subject)` is unique; profile updates do not alter memberships or roles.
No automatic Management API credential provisioning, bulk export, or database mutation is performed in this PR.

## Required gates

1. Unit tests for normalization, upsert parameters, import replay and 401/503 handling.
2. SQL schema lineage and permission audit for IAM identities; verify no role/membership grant.
3. Disposable PostgreSQL 18 integration test, including duplicate import and two different subjects.
4. Authenticated Neon Development runtime login without BYPASSRLS, signed context and deny-by-default tests.
5. Verify exact SHA Preview callback/login, import dry-run counts and audit evidence.
6. Separate Production approval, backup/restore and rollback evidence.

Until the gates pass: `AUTH0_NEON_SYNC_ENABLED` must be absent or false.

## PR #42 — isolated Preview rollout and verified evidence (2026-11-11)

- Vercel project `iam-control-center-new` (`aoa4`): `AUTH0_NEON_SYNC_ENABLED=true` **only** for Preview branch `feat/auth0-neon-identity-sync-20261111`; Development has `false`; Production environment was **not modified**.
- Preview-only `DATABASE_URL` secret points to Neon project `tiny-rice-70320263`, database `iam_database`, disposable child branch `br-floral-lab-b63xaw3z`, runtime role `iam_app_runtime_login`, SSL required. Connection password is never committed or logged. Expiry: `2026-11-13T00:00:00Z`.
- Reviewed PostgreSQL 18 function migration `0004_auth0_identity_sync_capability.sql` is installed on the disposable Neon child only. It is `SECURITY DEFINER`, owned by `iam_owner`, restricted to the configured Auth0 issuer, callable by `iam_app_runtime`. No direct identity INSERT/UPDATE grants to runtime; no memberships or roles created.
- Live Neon child runtime tests: role is LOGIN, NOBYPASSRLS, NOSUPERUSER; direct INSERT and UPDATE denied; zero tenant-context SELECT; two synthetic identities, import replay idempotent; wrong issuer denied; rollback confirmed zero fixtures and zero memberships. A real Auth0 browser E2E is separately required.
- PostgreSQL 18 CI: [database-schema-tests run #70](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43125660391) — all three jobs passed, including the new migration and fixture contract.
- Post-rollout E2E job tests authenticated POST `/api/identity/sync` twice and requires the same UUID; this is **not** proof of a real login until its latest exact-SHA run passes.
- Rollback: set the branch-specific Preview flag to `false`, trigger a new Preview deployment, and stop all writes; let the disposable Neon child expire. Do not reuse its credentials or promote this function or policy to Production without separate approval.
- Existing-user Auth0 bulk import and canonical ledger reconciliation remain blocked until independent authorization and evidence; no external users exported or imported by this change.

## Migration identity/ledger reconciliation — PR #42

- The canonical repository already reserves version **0003** for `0003_set_tenant_context_search_path.sql`; the new Auth0 capability has been renamed to **0004** to prevent duplicate migration IDs. The clean-install 0001/0002 lineage and restored canonical 0003 remain independent, and this rename does not approve a migration on an existing database.
- Neon Development (`tiny-rice-70320263` / `iam_database`) has ledger columns `(migration_id, checksum_sha256, source_sha, applied_at, execution_role)`; both Development and the isolated PR42 child returned **zero rows** in `iam.schema_migrations` at inspection. The clean-install repository migration defines different ledger columns `(version, name, checksum, applied_at, applied_by)`.
- No automatic migration runner exists. Until source lineage and the actual checksum-backed ledger are reconciled, apply **no changes** to Development/Production and do not mark the historic migrations applied retroactively.
- Existing-user import: keep Management API dry-run and synthetic fixtures separate from a real backfill; aggregate counts only and require an independently reviewed operator gate before real mutations.

## Existing Auth0 users — operator-only dry-run / backfill contract (PR #42)

The repository now includes:

- `apps/web/src/lib/auth0-management-token.ts`: server-only M2M token request with the **read:users** scope, for the configured Auth0 Management API audience. The tenant must explicitly authorize that scope.
- `apps/web/src/lib/auth0-existing-users.ts`: paginated reader that requests **only** `user_id,email,email_verified,name` and fails closed on provider errors.
- `apps/web/src/lib/auth0-existing-users-import.ts`: coordinator with **dry-run as the default**, duplicate detection, a 999-user maximum, an SHA-256 fingerprint of the fully normalized source snapshot, and a separate reviewed apply gate tied to the expected disposable branch ID.
- `apps/web/src/lib/auth0-existing-users-import.test.ts` and `auth0-management-token.test.ts`: synthetic-only contract tests for dry-run, approval, idempotent function parameters, changed source population/profile, duplicate IDs, wrong issuer, M2M token scope, token failures and write failure handling.

**No public HTTP endpoint and no unattended job runs this import.** These are reusable operator-side building blocks, not proof of a deployed backfill service. `AUTH0_NEON_SYNC_ENABLED` controls the authenticated login sync endpoint **only**; it is not a substitute for the independent existing-user import approval.

A reviewed operator workflow must first obtain an M2M token using tenant-scoped credentials, run the pure **dry-run** (no SQL writer), review the aggregate count and opaque snapshot fingerprint without exporting PII to logs, then re-read the source using **apply** with a separate authorization, verified isolated Neon branch ID, exact expected count and fingerprint, and the runtime function contract. The entire dataset is checked before any write. Auth0 `read:users` access and an operator environment must be separately provisioned; **no actual tenant users were exported or bulk-imported as part of this PR**.

The list-users Management API only supports offset retrieval up to 1,000 users. The current in-memory operator contract is limited to **999 users** and fails closed otherwise. For larger populations, use a reviewed Auth0 user-export job and a separately designed importer. An interrupted approved import might have partial writes; replay is idempotent on `(issuer,subject)`, but a formal reconciliation of counts, audit evidence, and isolation is still mandatory.

Both Neon Development and PR42 disposable ledgers were empty at inspection; the actual Neon columns are `migration_id, checksum_sha256, source_sha, applied_at, execution_role`, which differ from the clean-install schema's ledger. Never infer historic migration application from a matching schema; wait for a checksum-based, reviewed lineage baseline.

**Outstanding gates:** audited source count from the actual Auth0 tenant; explicit M2M credential and operator approval; real dry-run and apply only on a fresh disposable branch; baseline/ledger reconciliation, secure runner with atomic checksum registration, backup/restore rehearsal, and independent Development/Production authorization.
