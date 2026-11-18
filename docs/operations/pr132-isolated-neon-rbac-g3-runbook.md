# PEOS G3 — PR #132 isolated Neon RBAC HTTP execution gate

**This draft is source preparation, not authorization to operate the owner role or bypass safeguards.**

- GitHub PR: `#132`, branch `integration/peos-g1-g2-canonical-bun-20261118`.
- Neon project: `tiny-rice-70320263`, parent `br-muddy-bar-b63ksdy7`.
- Isolated Neon branch: `br-crimson-mouse-b6ltdbyx` (`validation/pr-132-rbac-http-isolated-20261118`).
- Direct Neon compute: `ep-nameless-breeze-b6mdjzqe.c-2.sa-east-1.aws.neon.tech`.
- Lease expiry: `2026-11-20T17:03:52Z`. 15-minute minimum remaining is enforced offline before credential access.
- Exact active key ID: `pr132-20261118` (key material never committed).

## Verified preflight

- Runtime Neon `iam_app_runtime_login`: NOBYPASSRLS and nonsuperuser. A read without signed tenant context returned zero tenant, identity, and membership rows.
- Clone matches its parent schema and selected catalog privileges; 23 tables and 41 policies.
- Neon runtime role metadata was updated on 18 November 2026, but the clone's `neondb_owner` rotation is **not attested**.
- The HMAC key exists and is active on the clone. Vercel branch-specific `DATABASE_URL`, `DATABASE_RUNTIME_ROLE`, and `AUTHZ_CONTEXT_SIGNING_KEY_HEX` are present but their sensitive values were not readable through the connected Vercel API. Exact URL/key parity **NOT ATTESTED**.

## Operational conditions before integrating into PR #132

1. Read back the GitHub `Preview` Environment protection rules: restrict sensitive-job execution to the exact PR #132 trusted ref, retain zero review requirement for solo maintainer without bypassing technical gates. If the shared Preview environment cannot isolate credentials, do **not** add a privileged owner URL there; redesign with a dedicated protected Environment instead.
2. Securely rotate `neondb_owner` **only on `br-crimson-mouse-b6ltdbyx`**, and provision its new full URI into GitHub Environment secret `NEON_RBAC_PR132_TEST_OWNER_DATABASE_URL`; never reuse PR41 owner secret. Require direct TLS `sslmode=verify-full&sslrootcert=system`.
3. Revalidate runtime `DATABASE_URL` role and host, HMAC against active key, Auth0 Allowed Callback and Vercel OIDC Trusted Sources. Redeploy PR132 Preview after environment changes.
4. After code integration, record the **new exact PR132 head SHA** in GitHub protected Environment variable `IAM_PR132_RBAC_APPROVED_SHA`. Document solo maintainer operational authorization with UTC window, SHA, fixture ID, private backup ID, rollback responsibilities and no competing lease.
5. Execute real Auth0 test: grant tenant A HTTP 200; deny tenant B, different identity and ungranted permission with HTTP 403; revoke A HTTP 403 in the *same* Auth0 session; zero-residue cleanup even on failures.
6. Independently verify zero fixture residue, role/ACL/ledger parity and backup/restore/rollback before completing G3. No Production or main cutover.

## Fail closed

- The PR132 Playwright config refuses login-only PASS when the PR132 branch is bound but the new positive RBAC suite is disabled.
- GitHub injects the PR132 privileged owner secret only when PR number, head branch, and protected approved-SHA value match the actual PR head SHA.
- `auth0-rbac-pr132.spec.cjs` also requires exact GitHub PR ref, branch, SHA, Neon branch/compute, active HMAC key ID and correct TLS mode before reading the owner secret or writing a synthetic fixture.
- The PR41 fixture, secret and E2E path remain unchanged.

**Status: SOURCE_PREPARED, OWNER_SECRET_NOT_ATTESTED, REAL_RBAC_NOT_RUN, G3_OPERATIONAL_BLOCKED, MERGE_BLOCKED.**
