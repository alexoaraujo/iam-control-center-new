# PEOS G3 PR128 — trusted executor and activation prerequisites

Status: **TRUSTED_EXECUTOR_PR_OPEN / G3_WRITE_HOLD**. This change adds a trusted executor to be merged into `main`; it does not change GitHub Environment policy, Vercel Trusted Sources, credentials, Neon data, or PR128.

## Exact scope

- Repository: `alexoaraujo/iam-control-center-new`
- PR under test: `#128`
- Expected head branch: `integration/peos-single-maintainer-bun-20261117`
- Current approved PR head: `dcb7bf653a12d0a3e4d8495fe3fd30a359fd8e87`
- Dedicated GitHub Environment: `IAM-G3-PR128-Disposable-RBAC`
- Disposable Neon project/branch: `tiny-rice-70320263 / br-super-sound-b63gtz88`
- Neon database/role: `iam_database / neondb_owner`
- Exact Preview alias: `iam-control-center-new-pr128-ci.vercel.app`
- Fixture lease expiry: `2026-11-21T22:00:00Z`

## Trusted execution boundary

The workflow `.github/workflows/iam-g3-pr128-trusted-executor.yml` is intentionally separate from the ordinary `pull_request` CI:

1. It is loaded from the default branch and runs only for PR128 metadata events or the exact owner comment command `/peos-g3-pr128-run`.
2. Its preflight requires PR128 OPEN/non-draft, same-repository head, exact branch/base, and a successful exact-SHA Vercel Preview check plus `quality`, `security-gate`, `auth0-e2e`, `preview-deployment`, and `sync-auth0-preview`.
3. The privileged job checks out `github.sha` (the trusted main/base commit), never `pull_request.head.sha`. It does not fetch, checkout, import, source, or execute PR-head files.
4. The owner URL is referenced only in the dedicated G3 job. It is validated without printing its value and must be direct-host, `iam_database`, `neondb_owner`, `sslmode=verify-full`, `sslrootcert=system`. The suite uses pinned Postgres.js `4.1.1` over the PostgreSQL wire protocol/direct TCP; successful connection requires the client driver to verify the certificate chain and hostname against the system CA store. It does not use Neon's HTTP SQL proxy or infer client TLS from backend session telemetry.
5. The OIDC token must carry the immutable repository identity, the exact G3 Environment subject, `refs/heads/main`, and the exact trusted workflow ref. The token is sent only to the approved Preview host.
6. Before owner credentials are bound, `scripts/verify-preview-alias.mjs` calls `/api/health/deployment` on both the approved Preview alias and callback alias with the G3 OIDC token. It requires the live deployment metadata to match the exact PR128 SHA, branch, repository, PR number, and Preview environment, and proves both aliases resolve to the same immutable Vercel deployment. The historical check-run summary alone is not accepted as current deployment identity.
7. After the Vercel anonymous negative and trusted positive protection controls, the workflow clears `VERCEL_TRUSTED_OIDC_TOKEN` from `GITHUB_ENV` before binding the owner database URL or Auth0 test credentials. The short-lived bearer token is not propagated into the credential-preflight or privileged suite steps.
8. The trusted Playwright suite performs real Auth0 login, checks Preview database health and runtime NOBYPASSRLS readiness, inserts a synthetic tenant-scoped grant under `SET LOCAL ROLE iam_owner`, proves HTTP 200, cross-tenant/cross-identity/ungranted-permission HTTP 403, revokes and proves HTTP 403 in the same session, tests transaction rollback, and verifies zero fixture residue.

## Required administrative configuration before execution

### GitHub Environment

Live administrative UI readback confirmed the secret **name** `NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL` and variable `IAM_RBAC_PR128_APPROVED_SHA`; the variable was shown equal to the current PR128 head SHA. No secret value was read.

The GitHub Actions readback in run [44852826735](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44852826735) at 01:54 UTC reported one allowed ref (`refs/pull/128/merge`). A later live GitHub UI readback at approximately 03:53–04:03 UTC supersedes that snapshot: the Environment currently uses selected branch/tag rules with FOUR PR-only refs — `refs/pull/128/merge`, `refs/pull/129/merge`, `refs/pull/130/merge`, and `refs/pull/145/merge`. `refs/heads/main` is absent. The page also returned “You can’t perform that action at this time”; no policy write was made. These four refs are not appropriate for the trusted main-only workflow.

Change the existing Environment `IAM-G3-PR128-Disposable-RBAC` deployment branch allowlist to **only** `refs/heads/main`. Preserve:
- admin bypass disabled;
- custom branch policies enabled;
- no required reviewer and no wait timer (the repository uses the single-maintainer policy);
- existing owner secret name and value unchanged;
- `IAM_RBAC_PR128_APPROVED_SHA` equal to the exact current PR128 head.

Do not allow both `refs/heads/main` and `refs/pull/128/merge`. Do not copy the owner URL into `Preview`.

The G3 workflow also requires `AUTH0_E2E_USERNAME` and `AUTH0_E2E_PASSWORD` to be available to the G3 job. If these are repository-level secrets they resolve without duplication; if they exist only in the shared `Preview` Environment, add the same Auth0 test credentials as secrets to G3 through the GitHub UI. Never put credential values in code or comments.

### Vercel Trusted Sources

In Vercel team `aoa4`, project `iam-control-center-new`, add a Trusted Source with no wildcard:

- Issuer: `https://token.actions.githubusercontent.com`
- Audience: `https://github.com/alexoaraujo`
- Subject: `repo:alexoaraujo@325264809/iam-control-center-new@1451861889:environment:IAM-G3-PR128-Disposable-RBAC`

The workflow independently verifies `sub`, `iss`, `aud`, `ref`, `environment`, repository IDs, and `workflow_ref`, then requires the anonymous negative and trusted positive Preview controls to pass.

## Activation

After this executor PR is merged to `main`, the GitHub Environment allowlist and Vercel Trusted Source are configured and read back, and the required Auth0 test credentials are available, post this exact comment on PR128 as `alexoaraujo`:

```text
/peos-g3-pr128-run
```

The workflow will re-fetch the live PR and exact-SHA checks before binding G3 secrets. If the PR head SHA changes, the approved-SHA variable must be deliberately updated and the Preview checks rerun. If the Neon lease expires or is within 15 minutes of expiry, do not execute; provision a new disposable child and rebind its host, branch ID, lease, runtime Preview URL and approved SHA.

No Production or Development credential is used. A successful suite still requires a separate final readback of zero residues and suspension of the Neon endpoint before PR128 can be considered for merge.

## Current operational hold — 2026-11-21 04:05 UTC

- PR145 executor HEAD: `0038917802bae4ced89d0131246142c288e1fd28`. Latest Codex re-review of this exact SHA reported no major issues. The TLS transport correction uses pinned Postgres.js 4.1.1 over direct PostgreSQL TCP with `sslmode=verify-full` and `sslrootcert=system`; official Postgres.js connection documentation describes `verify-full` and `sslrootcert=system` as certificate-verifying modes. The G3 positive suite has not connected to Neon or executed DML.
- PR145 quality and PostgreSQL 18 signed-RLS checks are SUCCESS. Preview deployment is FAILURE because the Vercel Hobby project status target is `upgradeToPro=build-rate-limit`; no exact-SHA deployment exists for PR145 HEAD. The CI `security-gate` correctly fails closed with `PREVIEW_NOT_SUCCESS`. Do not bypass, override, or merge.
- PR128 remains OPEN at `dcb7bf653a12d0a3e4d8495fe3fd30a359fd8e87`; its exact-SHA quality, security-gate, Auth0 E2E, Auth0 Preview sync and Vercel Preview checks remain SUCCESS.
- Neon disposable branch `br-super-sound-b63gtz88` is READY; endpoint `ep-red-sunset-b6ozp5b2` is IDLE. Lease expiry remains `2026-11-21T22:00:00Z`. No compute activation or SQL/DML is authorized before all G3 administrative gates pass.
