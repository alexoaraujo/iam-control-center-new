# PEOS IAM — Production database branch binding (21 Nov 2026)

**Scope:** read-only identity attestation before any Production RBAC migration, context-key issuance, or cutover. No secret is read, rotated, copied, or committed. The only Vercel Production change proposed is a *non-secret expected Neon branch identifier*, which must be independently verified before enabling live authorizations.

## Evidence and ambiguity

- GitHub reviewed main baseline: `01d03c0f811e635c210ac8a50485ab45b6b062bc`.
- Vercel Production domain `iam-control-center-new.vercel.app` points to READY `dpl_EuHzhWEARygt6bsfe9UStvngf5HC`, exact same main SHA.
- Vercel Production has sensitive `DATABASE_URL`, but administrative Vercel API (including per-ID read) did not expose its plaintext; the value **cannot be verified by assuming** it matches Neon default.
- Neon project `tiny-rice-70320263`, default `production`, branch `br-muddy-snow-b63cepcv`, database `iam_database`: PostgreSQL 18, no IAM/audit/app_private schemas, 0 IAM tables, 0 RLS policies, only nonadmin `iam_app_runtime_login`.
- Neon `development`, branch `br-ancient-term-b6mmx5ol`: 3 IAM schemas, 23 tables, 41 policies, canonical roles exist. Clone G3 `br-super-sound-b63gtz88` shares that test structure, but holds **synthetic-only** `synthetic-release-validation` signing key (must NEVER reach Production).
- An isolated *snapshot of the Neon default Production branch* was created as `br-snowy-rice-b6sgllzh`, name `validation/peos-production-rbac-reconcile-20261121`, expiration 2026-11-23 15:00 UTC; verified exactly 0 IAM tables and policies, without writing to the source branch.
- Existing `0001_initial_iam_schema.sql` is a review-only *clean install* proposal, **not** the 23-table/41-policy canonical Development baseline; `0002` depends on preexisting sessions, `0003` on an established canonical context function, `0004` is approved only for disposable fixtures. Do NOT run these unconditionally on Production.

## How the exact Production target is proven

1. Configure plain Vercel **Production only** `IAM_PRODUCTION_EXPECTED_NEON_BRANCH_ID=br-muddy-snow-b63cepcv` as a *candidate expected ID*, not proof that the deployed DB matches.
2. Review/merge this PR under existing required quality, Auth0 and signed PG18 gates; do not grant Preview code Production credentials.
3. Deploy the reviewed SHA through normal protected GitHub/Vercel flow and verify Production alias maps to the same Git SHA.
4. Visit `https://iam-control-center-new.vercel.app/api/ready` under an existing Auth0 session. `ready:true` means the actual Vercel Production database reports that exact Neon branch via `current_setting('neon.branch_id',true)`, with `current_user=iam_app_runtime_login`, `rolsuper=false`, `rolbypassrls=false`. `production_branch_mismatch` means the candidate was wrong and all tenant authorization fails closed. `production_branch_unconfigured` means the expected ID was not deployed. No branch ID, credentials, SQL query, or HMAC is returned to browsers.
5. Revalidate the immutable new main SHA and record UTC logs. Do not claim the older PR147 G3 run is a test of this newer SHA.

## Migration and context-key gate

- **HOLD** Production DDL and runtime key until exact branch attestation, full canonical restore/migration manifest, owners/grants/role membership evidence, verified backup and recovery, and explicit rollback scope.
- Production `AUTHZ_CONTEXT_SIGNING_KEY_HEX` must be a fresh 32-byte CSPRNG output, distinct from G3; restricted custody must bind its hex bytes only to the approved target `app_private.context_keys.secret` (bytea), with Production-only Vercel sensitive secret and no plaintext on GitHub logs or PR comments.
- Existing `app_private.context_keys` on Development/G3 does **not** authorize copying the synthetic key. No Production SQL mutation or secret creation is included in this PR.
- Production authorization now additionally denies unless the actual branch ID matches the expected Production branch, even if someone later configures a valid signing secret.

## Recovery

If readiness becomes `production_branch_mismatch`, do not update the expected value blindly. Inspect the actual target via authorized protected metadata and reconcile the discrepancy; revert the code via a reviewed PR if necessary. Preserve original Vercel deployments and Neon snapshot. Never lower RLS, skip `security-gate`, or make the Runtime role a database owner.

## Preview re-deployment binding check

Vercel project domain `iam-control-center-new-prod-rbac-ci.vercel.app` was created, verified, and bound **only** to `security/peos-prod-rbac-branch-attestation-20261121`. Branch-scoped Preview values `APP_BASE_URL`, `E2E_CALLBACK_HOST`, `E2E_CALLBACK_BRANCH` were created after the first Preview deployment. This new documented SHA deliberately retriggers deployment and Auth0 synchronization so the variables are effective at build time, without changing Production.
