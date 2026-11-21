# PEOS G3 — PR #128 isolated Auth0/RBAC HTTP suite (staged, not activated)

Status: **SOURCE_STAGED, LIVE_RLS_DENY_PASS, AUTH0_HTTP_200_403_NOT_RUN, OWNER_SECRET_NOT_PROVISIONED, NO_MERGE**.

## Verified source and lease, 20 November 2026 UTC

- Target PR: [#128](https://github.com/alexoaraujo/iam-control-center-new/pull/128), head branch `integration/peos-single-maintainer-bun-20261117` at the source baseline `d7ab0303306666ebff04a86aac4da46f33fb01bd`.
- Neon project `tiny-rice-70320263` (PostgreSQL 18); disposable branch `validation/pr-128-rbac-http-isolated-20261120`, ID `br-super-sound-b63gtz88`.
- Parent `br-muddy-bar-b63ksdy7` is a validation branch, **not the production or development branch**.
- Direct nonpooled endpoint `ep-red-sunset-b6ozp5b2.c-2.sa-east-1.aws.neon.tech`, minimum/maximum 0.25 CU.
- Lease expiry **2026-11-21T22:00:00Z**. `assertRbacFixtureLease` refuses access with under 15 minutes left. The lease is not a credential or operational authorization.
- Database `iam_database`, `current_setting('neon.branch_id')` matched the fixture ID, 20 IAM tables, 36 IAM RLS policies, 0 schema ledger rows and one active context key with ID `synthetic-release-validation`. Its **key material was not retrieved**.
- `iam_owner` is NOLOGIN/NOBYPASSRLS/NOSUPERUSER; `iam_app_runtime_login` is LOGIN/NOBYPASSRLS/NOSUPERUSER. The privileged `neondb_owner` must never act as application runtime.
- Database contains inherited data (2 physical tenants / 2 identities / 2 memberships). A real read-only session as `iam_app_runtime_login`, without signed tenant context, saw **0** rows in each of those three tables. This proves only the specified deny-by-default control, not end-to-end HTTP RBAC.
- Neon Free rejected a custom 60s suspend timeout with HTTP 412. The endpoint reports `suspend_timeout_seconds=0` as the account default; do not claim a custom auto-suspend setting.

## Source prepared without privilege injection

`.github/e2e/auth0-rbac-pr128.spec.cjs` is a separate source-only suite based on the established PR132 test structure. It pins the new branch ID, host, TTL, key ID, expected Auth0 subject hash, PR #128 head/ref, and `iam-control-center-new-pr128-ci.vercel.app`. It intends to check `grant -> HTTP 200`, tenant/identity/permission denials, `revoke -> HTTP 403` in the same browser session, and zero-residue cleanup.

`scripts/pr128-rbac-staged-contract.test.mjs` validates those safety properties without touching any environment or external service. **The current `.github/workflows/quality.yml` and `.github/e2e/playwright.config.cjs` deliberately do not enable this suite.** A green existing `auth0-e2e` job must not be presented as a PASS of this G3 suite.

## Required controls before enabling any positive write

1. Validate the fixture is still READY, unprotected, on the exact parent/compute, with enough remaining TTL. Require an exact SHA-scoped, audit-recorded operational authorization; the original PR128 SHA will change when this staged PR is integrated.
2. Provision a **separate, protected, branch-restricted GitHub Environment** for disposable PR128 RBAC writes, not the shared `Preview` environment. Confirm effective Environment protection and allowed refs through live API readback *before* attaching any credentials or executing untrusted code. Do not silently create an unprotected environment by referring to a new name in a workflow.
3. Rotate the fixture-only owner credential (never Production/Development), then populate `NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL` exclusively as a protected secret in the dedicated Environment. Require `sslmode=verify-full&sslrootcert=system`, direct host allowlist and exact session branch identity. No password, API key or signing material belongs in a PR or logs.
4. Attest exact app runtime `DATABASE_URL` host/role/branch and signing-key parity with the active clone context key; ensure Preview callback and OIDC Trusted Sources refer to the exact, current PR128 deployment and commit. The actual HMAC key equality has **not** been established.
5. Only in a reviewed, credential-isolated workflow, grant and revoke a disposable fixture, assert HTTP 200/403 and cross-tenant negatives, collect sanitized HTTP evidence, and prove zero residue and rollback. Fail closed on missing permissions, expired TTL, unavailable branch, or inconsistent hash.
6. Perform independent recovery and Production-boundary readback. Merging to `main` may trigger a Production-target build. Do not merge while release controls are unverified, even if every unit test is green.

**No SQL writes, secret retrieval, Auth0 callback mutation, Vercel domain promotion, or Production merge are performed by this staging PR.**

## Operational checkpoint — 21 November 2026, read-only verification

- The existing protected GitHub Environment `IAM-G3-PR128-Disposable-RBAC` passed the live administrative policy readback: `can_admins_bypass=false`, `custom_branch_policies=true`, one allowed branch `refs/pull/128/merge` ([GitHub Actions #44835270898](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44835270898), job `136669618805`).
- The exact PR128 SHA `26ab7ef917141531b7b9d496d07066ddfa3bb625` had 11/11 successful workflows, including ordinary real Auth0 login and `security-gate`; **this is not a positive G3 RBAC test**.
- The maintainer provided a masked `iam_app_runtime_login` URL; its host is the approved disposable Neon endpoint, but the runtime URL cannot be used as `NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL` and `sslmode=require` does not satisfy the owner-connection `verify-full` contract.
- **Next admin-only preflight**, in a locally authenticated checkout, without outputting secret values:

  ```bash
  python3 .github/scripts/iam-g3-owner-secret-metadata-readonly.py --mode plan
  python3 .github/scripts/iam-g3-owner-secret-metadata-readonly.py --mode verify
  ```

- The preflight checks the **existing** G3 environment's protection, exact PR branch/ref and head SHA, and only the **name** of the environment secret `NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL` plus the non-secret environment variable `IAM_RBAC_PR128_APPROVED_SHA`. Missing fields fail closed; this code does not read secret values, alter GitHub settings, connect to Neon or start Playwright.
- Passing that metadata check **does not authenticate the owner connection or establish trusted workflow provenance**. A protected, independently reviewed execution source and runtime branch/role/TLS proof remain required. The test suite intentionally stays excluded from `quality.yml` and `playwright.config.cjs`; DO NOT add an owner secret to shared `Preview`.
- All privileged writes, G3 positive HTTP 200/403, cleanup/rollback and any Production/main integration remain HOLD until separately proven.
