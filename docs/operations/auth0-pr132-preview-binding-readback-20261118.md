# PEOS G3 — Live readback Auth0 Preview, PR #132 (18 November 2026)

**This is a non-secret readback and CI retest trigger, not an operational lease approval.**

## Read-only sources (authenticated, UTC)

- GitHub PR #132 source branch: `integration/peos-g1-g2-canonical-bun-20261118`; previously tested SHA `dce66ba0ba8e9ea962a67576d99b380cb7847fbb`.
- The earlier CI run [44343929623](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44343929623) had `quality=SUCCESS`, `sync-auth0-preview=SUCCESS` (scope not authorized), `auth0-e2e=SKIPPED`, `security-gate=FAILURE`.
- Vercel project `prj_OnuwD1iarOsXh6FFGkSpK4A5mj80`: three nonsecret Preview variables now exist for this branch only: `APP_BASE_URL`, `E2E_CALLBACK_HOST`, `E2E_CALLBACK_BRANCH`; readback 3/3 match.
- `iam-control-center-new-ci-preview.vercel.app` and `iam-control-center-new-preview.vercel.app`: project-domain `gitBranch=integration/peos-g1-g2-canonical-bun-20261118`; both VERIFIED.
- Both Preview aliases resolved to `dpl_DwnF3fKrCs8CyoanBP5YP11YrFtN` (READY; exact previously tested SHA), created **after** the Preview variables.
- The Vercel Production alias `iam-control-center-new.vercel.app` remained at `dpl_4sd7DPf8nnr5WuzieAkn2CZcbSq1`. No Production deployment/promotion was requested.
- The previous shared Preview binding was `approval/iam-pr121-auth0-preview-callback-lease-20261117` at `dpl_3AE28BoVmRnTbX5e2axf49F7rbSA` / SHA `52f783628377442ab4bc8ed61d69af0594b71954`. This is an historical snapshot only; revalidate live state before rollback.

## Fail-closed retest requirements

1. A new PR commit invalidates all prior CI SHA evidence. Re-read current GitHub PR HEAD and Vercel deployment branch/SHA; require new `quality`, `pg18-security-contracts` and PostgreSQL 18 schema contracts.
2. Verify Vercel callback domain and alias point to the **new HEAD's** READY deployment and that `APP_BASE_URL` and `E2E_CALLBACK_BRANCH` match it; never treat successful `sync-auth0-preview` with `auth0_ready=false` as a pass.
3. Confirm Auth0 Allowed Callback/Logout/Web Origins, GitHub Preview Environment and Trusted Sources OIDC from authenticated configuration, without exposing credentials. A green build is insufficient.
4. The current workflow enables `E2E_RBAC_HTTP_ENABLED` only on branch `feat/iam-api-rbac-lineage-20261110`. Even if browser Auth0 succeeds on PR #132, it does **not** prove live RBAC grant→200/revoke→403 or tenant A/B isolation. Preserve that separate gate; do not silently force the flag on.
5. The prior Neon fixture `br-quiet-night-b6cfeq4j` expires `2026-11-20T01:30:00Z`; no lease or source/target credentials were granted by this readback. Do not re-use another branch's secrets without explicit authorization and rollback.
6. The review on historical PR #122 had an empty approval body and does not authorize a new exact-SHA lease. Merging, production promotion, canonical ledger insertion, Neon DDL and secret rotation remain forbidden pending verifiable gates.

**Status:** `PREVIEW_VERCEL_BRANCH_AND_ALIASES=VERIFIED_AT_SNAPSHOT`; `AUTH0_E2E=NOT_YET_RETESTED`; `RBAC_HTTP=NOT_ATTESTED`; `G3=BLOCKED`; `MERGE=BLOCKED`.

This document contains no secret/token values, passwords, connection URLs or application data.
