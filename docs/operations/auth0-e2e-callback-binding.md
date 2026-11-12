# Auth0 E2E callback binding — verified Vercel Preview

The only approved E2E callback host is `iam-control-center-new-ci-preview.vercel.app`.
Do not set a hardcoded `E2E_CALLBACK_BRANCH` fallback: it becomes stale as soon as
the Vercel project domain is attached to another branch.

## Execution

`.github/workflows/quality.yml` invokes `scripts/bind-e2e-preview.mjs` after
the exact-SHA Preview deployment check. The script queries Vercel using a
**read-only** API token stored in protected GitHub Actions environment `Preview`:

- `VERCEL_API_TOKEN`: protected GitHub Actions secret with Vercel project read access.
- Project: `prj_OnuwD1iarOsXh6FFGkSpK4A5mj80`; team slug `aoa4`.
- Auth0 must have callback `https://iam-control-center-new-ci-preview.vercel.app/auth/callback`,
  plus the correct logout and allowed web origin entries.
- Vercel project domain `iam-control-center-new-ci-preview.vercel.app` must be
  explicitly linked to the **same** PR head branch as the Preview being validated.

The script validates domain `gitBranch`, alias deployment ID and exact Git SHA.
It updates `E2E_CALLBACK_HOST`, `E2E_CALLBACK_BRANCH`, `E2E_BASE_URL`
and `E2E_DEPLOYMENT_URL` in the **current job's GITHUB_ENV**, never shared
repository variables, because concurrent PRs must not overwrite one another.

## Operational boundary

Vercel currently reports the shared CI alias attached to
`feat/iam-api-rbac-lineage-20261110`. A PR using another branch must not
silently reuse or move that alias; this would run E2E on the wrong release.
If the branch differs, the job fails closed with the true Vercel state.
An operator must first rebind the alias to the intended PR branch and verify
a READY deployment for that PR SHA. Rebinding a shared alias can affect another
PR; coordinate it rather than automatically changing shared Vercel routing.

Without the protected `VERCEL_API_TOKEN`, the binding cannot be independently
proven and E2E must remain blocked. This is deliberate and does not grant
permission to bypass Deployment Protection or weaken Auth0 callbacks.

No Production settings or Auth0 tenant settings are changed by this PR.
