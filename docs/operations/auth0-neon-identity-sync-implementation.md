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
