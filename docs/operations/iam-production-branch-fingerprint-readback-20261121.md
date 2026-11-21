# PEOS — authenticated Production branch fingerprint readback (21 Nov 2026)

## Incident

Production `GET /api/ready` returned `{"ready":false,"reason":"production_branch_mismatch"}` after exact SHA `36ac11a172e8456816435e4a859e86a84f4a2daf` was promoted. The configured candidate `IAM_PRODUCTION_EXPECTED_NEON_BRANCH_ID=br-muddy-snow-b63cepcv` is not the actual connection branch as observed by the runtime SQL guard. This is a **valid security block**. Do not update the expected branch by guessing, reassign `DATABASE_URL`, or reuse synthetic G3 HMAC material to make readiness pass.

Vercel Production `DATABASE_URL` is `sensitive`; administrative Vercel API per-ID and listing readbacks did not produce plaintext. Neon PostgreSQL logs are not enabled in this region (`telemetry_not_enabled`). A reliable diagnostic must attest the actual live runtime without disclosing connection credentials.

## Readback contract

- The current `/api/ready` endpoint requires a genuine Auth0 session, makes a read-only bounded/uncached query under `iam_app_runtime_login`, and fails if the principal is superuser or BYPASSRLS.
- This change adds a **disabled-by-default, time-limited** optional fingerprint only in Production when `IAM_PRODUCTION_BRANCH_FINGERPRINT_ENABLED=true` and the actual value matches the canonical `br-...` branch ID format. It returns no branch ID, URL, connection string, secret, role credentials or tenant data.
- The fingerprint is the first 24 lower-hex digits of `SHA256("iam-prod-branch-attestation:v1:" + branchId)`. It is a correlation identifier, not encrypted data, not a secret and not itself proof of authorization. Anyone with the list of candidate branch IDs could compute it, so disable the diagnostic immediately after the attestation.
- A mismatch result will take the shape `{"ready":false,"reason":"production_branch_mismatch","branchFingerprint":"<24 hex>"}`. If the actual Neon branch setting is empty or malformed, the response remains the original mismatch reason without a fingerprint.
- The feature flag is **Production only**; Preview and Development cannot emit fingerprints, and RBAC remains fail-closed regardless of the flag. Existing `GET /api/ready` Cache-Control is no-store.
- Compare candidate fingerprints **locally** against Neon project `tiny-rice-70320263` and separately against legacy project `twilight-fire-88497009`. Do not arbitrarily choose the first match; corroborate exact project ID, endpoint ID, database, role, schema, ledger and backup before changing any Production configuration. Do not disclose hostnames or credentials.

## Release prerequisites

1. Preserve GitHub PR head SHA and run `quality`, PostgreSQL 18, exact-branch Preview, live Auth0 E2E and `security-gate` to SUCCESS; do not accept skipped jobs as passed.
2. Restrict the Vercel flag `IAM_PRODUCTION_BRANCH_FINGERPRINT_ENABLED=true` to the **Production** target; it must be set before the reviewed new SHA is built so the deployment sees it.
3. Merge by merge commit only after passing checks, verify `main` checks and promote the exact immutable Production deployment with alias verification.
4. Have an already authenticated operator call the live Production `/api/ready`; record only JSON and timestamp (no session cookie).
5. Compare the 24-hex fingerprint against known candidate IDs offline. If no matching candidate, investigate the unlisted Neon project/branch or null branch identity; never guess.
6. After readback, **remove** the temporary Vercel diagnostic flag and redeploy a reviewed build, or pin the next rollout with it false and verify no fingerprint remains.

## Gating and key custody

The deployment remains **NOT READY** until its expected branch matches the real branch, and **Production tenant RBAC** remains DENY without a valid, distinct approved Production HMAC key in the approved canonical database and in the Production-only Vercel Environment. Do not reuse `synthetic-release-validation` or execute migrations, tenant grants, or Production database cutovers as part of this diagnostic. Any schema/ownership reconciliation requires a verified backup and rollback first.

## Unique Preview branch after failed PR149 reuse

The initial diagnostic draft PR #149 accidentally reused a previously merged branch name. The CI correctly rejected the stale Preview PR identity with `Missing or wrong PR number on Preview origin`; do not weaken this check. This new PR uses unique branch `security/peos-prod-branch-fingerprint-20261121` and branch-only, verified Vercel alias `iam-control-center-new-branch-fingerprint-ci.vercel.app`. Its Auth0 application must explicitly allow callback `https://iam-control-center-new-branch-fingerprint-ci.vercel.app/auth/callback` and logout origin `https://iam-control-center-new-branch-fingerprint-ci.vercel.app` without wildcards. The old PR149 remains a separate, unmerged audit record. No Production key or schema changes are authorized by this operational adjustment.

## PR150 actual Preview identity root cause — authoritative timestamps

The initial PR150 Preview deployment `dpl_DQW1S5zHmHS8XxoCumUcraVRy2sQ` was created **2026-11-21T15:23:26.755Z**, before GitHub PR150 was created **2026-11-21T15:23:51Z**. The strict `verify-preview-alias.mjs` error `Missing or wrong PR number on Preview origin 1` identifies `evidence[0].pullRequestId` (the first Preview origin), **not** PR number 1. The Vercel build's `VERCEL_GIT_PULL_REQUEST_ID` was therefore absent or stale when the exact-SHA deployment was built. Reusing a previously merged branch in draft PR149 was a suspected contributing issue, but no evidence establishes it as the root cause; do not state that as certain. The hard identity check is correct. This documentation-only commit after the PR exists forces a **new exact-SHA Preview build** with valid PR context, without lowering the check, changing the Auth0 callback, or touching Production.
