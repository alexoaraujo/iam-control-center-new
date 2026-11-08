# GitHub Actions secrets and variables — IAM Control Center

**Status:** inventory and target design; not evidence that GitHub settings have been populated.
**Repository inspected:** `alexoaraujo83/iam-control-center`, default branch `main`, main SHA auditado em 2026-11-07: `64f96d84b33aff57d9c09bbe7ff54396e651552c`.

## 1. Current-state findings

- `.github/workflows/quality.yml` runs dependency audit, lint, typecheck, tests, and build. It declares `contents: read` and does not reference a GitHub deployment environment.
- The workflow pins Node.js 24 and pnpm 10.34.9 directly in YAML. It currently needs no custom GitHub Actions secret or configuration variable.
- `.env.example` describes application/runtime configuration. Its presence does not mean those values are consumed by the CI workflow.
- The GitHub repository API confirms visibility `private`, consistente com README. A API de rulesets retornou HTTP 403 nesta conexão; enforcement não foi revalidado independentemente.
- The repository ruleset expects deployments to environments named exactly `Development` and `Preview`. A successful `quality` job is not a deployment to either environment.

## 2. GitHub Actions configuration inventory

The tables below are the intended configuration. “Do not create yet” means no current workflow consumes the item; it does not mean the secret is already present.

### Repository secrets

| Name | Purpose | Decision |
|---|---|---|
| `NEON_API_KEY` | Create/manage Neon preview branches, if a trusted workflow implements that lifecycle | **Do not create yet** on the basis of the current `main` workflow alone. If needed, restrict use to trusted workflow paths/events; never expose it to untrusted fork code. |
| `VERCEL_API_TOKEN` | Vercel deployment via GitHub Actions, only if the deployment workflow explicitly requires a token | **Prefer native Git integration/OIDC**. Add only if an implemented workflow requires it. |
| `AUTH0_CLIENT_SECRET` | Auth0 application client secret | **Not a GitHub CI secret today**; configure in the application hosting runtime for each applicable environment. |
| `AUTH0_SECRET` | Auth0 SDK/session encryption secret | **Not a GitHub CI secret today**; configure in the application hosting runtime separately per environment. |
| `DATABASE_URL` | PostgreSQL connection string | **Not a GitHub CI secret today**; configure in the application hosting runtime per environment. Use least-privilege runtime roles. |
| `AUTH0_MGMT_CLIENT_SECRET` | Auth0 Management API client secret | **Do not create unless implemented server-side functionality needs it**. If needed, runtime-only and minimum scopes. |

**Current minimum required repository secrets: none.** Reassess this table when an actual workflow is added that consumes one of these values.

### Repository variables

| Name | Purpose | Decision |
|---|---|---|
| — | The current workflow already pins tool versions in YAML | **No custom repository variables required today.** Do not add unused `NODE_VERSION` or `PNPM_VERSION` duplicates unless the workflow is deliberately changed to consume `${{ vars.NAME }}`. |

### Environment: `Development`

| Name | Type if/when a deployment workflow consumes it | Intended use | Decision today |
|---|---|---|---|
| `APP_BASE_URL` | Variable | Development application base URL | Keep in the hosting provider's Development runtime configuration; no current GitHub Actions consumer. |
| `AUTH0_DOMAIN` | Variable | Development Auth0 tenant domain | Hosting runtime; not a GitHub Actions variable today. |
| `AUTH0_CLIENT_ID` | Variable | Development Auth0 application ID | Hosting runtime; not a GitHub Actions variable today. |
| `AUTH0_CLIENT_SECRET` | Secret | Development Auth0 client credential | Hosting runtime secret; not a GitHub Actions secret today. |
| `AUTH0_SECRET` | Secret | Development session encryption secret | Hosting runtime secret; generate independently from Preview. |
| `AUTH0_ISSUER_BASE_URL` | Variable | Development OIDC issuer URL | Hosting runtime; not a GitHub Actions variable today. |
| `AUTH0_AUDIENCE` | Variable | Development API audience | Hosting runtime; not a GitHub Actions variable today. |
| `DATABASE_URL` | Secret | Development database connection | Hosting runtime secret; use a non-production database and least-privilege role. |
| `AUTH0_MGMT_CLIENT_ID` | Variable | Optional server-side Management API client ID | Do not configure until feature implementation requires it. |
| `AUTH0_MGMT_CLIENT_SECRET` | Secret | Optional server-side Management API credential | Do not configure until feature implementation requires it; least scopes. |
| `NEON_API_KEY` | Secret | Neon branch lifecycle automation, if explicitly wired to this environment | Not required by the current main workflow. |
| `VERCEL_API_TOKEN` | Secret | Deployment token, only if explicitly required | Prefer integration/OIDC; not required by the current main workflow. |

**Current minimum required GitHub environment secrets/variables for Development: none** until a workflow references `environment: Development` and consumes them.

### Environment: `Preview`

| Name | Type if/when a deployment workflow consumes it | Intended use | Decision today |
|---|---|---|---|
| `APP_BASE_URL` | Variable | Preview deployment URL/base URL | Hosting runtime; do not copy the Development value blindly. |
| `AUTH0_DOMAIN` | Variable | Preview Auth0 tenant domain | Hosting runtime; use the intended test tenant/configuration. |
| `AUTH0_CLIENT_ID` | Variable | Preview Auth0 application ID | Hosting runtime; use Preview-specific config when separate. |
| `AUTH0_CLIENT_SECRET` | Secret | Preview Auth0 client credential | Hosting runtime secret; do not reuse Development unless explicitly approved. |
| `AUTH0_SECRET` | Secret | Preview session encryption secret | Hosting runtime secret; generate independently from Development. |
| `AUTH0_ISSUER_BASE_URL` | Variable | Preview OIDC issuer URL | Hosting runtime. |
| `AUTH0_AUDIENCE` | Variable | Preview API audience | Hosting runtime. |
| `DATABASE_URL` | Secret | Preview database connection | Hosting runtime secret; never point Preview at Production by default. |
| `AUTH0_MGMT_CLIENT_ID` | Variable | Optional server-side Management API client ID | Do not configure until required. |
| `AUTH0_MGMT_CLIENT_SECRET` | Secret | Optional server-side Management API credential | Do not configure until required; least scopes. |
| `NEON_API_KEY` | Secret | Neon branch lifecycle automation, if explicitly wired to this environment | Not required by the current main workflow. |
| `VERCEL_API_TOKEN` | Secret | Deployment token, only if explicitly required | Prefer integration/OIDC; not required by the current main workflow. |

**Current minimum required GitHub environment secrets/variables for Preview: none** until a workflow references `environment: Preview` and consumes them.

## 3. Application runtime variables from `.env.example`

These names are not automatically GitHub Actions settings. For the current scaffold, configure application values in the hosting provider's runtime environment (e.g. Vercel) only when the feature is implemented:

| Name | Classification | Runtime destination / handling |
|---|---|---|
| `APP_BASE_URL` | Non-secret | Development/Preview hosting runtime; environment-specific URL |
| `AUTH0_DOMAIN` | Non-secret | Hosting runtime; Auth0 tenant domain |
| `AUTH0_CLIENT_ID` | Non-secret identifier | Hosting runtime; application client ID |
| `AUTH0_CLIENT_SECRET` | Secret | Hosting runtime secret |
| `AUTH0_SECRET` | Secret | Hosting runtime secret; unique per environment |
| `AUTH0_ISSUER_BASE_URL` | Non-secret | Hosting runtime; issuer URL |
| `AUTH0_AUDIENCE` | Non-secret | Hosting runtime; API audience |
| `DATABASE_URL` | Secret | Hosting runtime secret; least-privilege database role |
| `AUTH0_MGMT_CLIENT_ID` | Sensitive operational configuration, not a password | Server-side runtime only; omit unless needed |
| `AUTH0_MGMT_CLIENT_SECRET` | Secret | Server-side runtime only; minimum scopes |
| `VERCEL_API_TOKEN` | Secret | GitHub Actions only if an implemented deployment workflow needs it; prefer native integration/OIDC |

Never commit real values to `.env.example`, workflow YAML, documentation, issues, or PR descriptions.

## 4. Required workflow design before environment secrets can be consumed

A future deployment job must explicitly reference its target environment, for example `environment: Development` or `environment: Preview`. Only then will that job receive the corresponding environment-scoped secrets and variables. Keep the existing quality job separate from deployment jobs. Do not make production deployment part of this change.

Before a real deployment is marked PASS, record the exact commit SHA, environment, deployment result, URL, and workflow run. CI success alone does not satisfy the deployment gate.

## 5. GitHub settings checklist

1. Open repository **Settings → Environments** and verify exact names `Development` and `Preview` (not `Previe`).
2. Keep Development and Preview credentials isolated; do not reuse secrets by copying the same value across environments unless that is a deliberate, documented design.
3. Open **Settings → Secrets and variables → Actions** and review Repository secrets and Repository variables. Do not add unused entries just to make the lists look populated.
4. For each environment, review its **Environment secrets** and **Environment variables** separately.
5. Reconcile repository visibility: the current GitHub API reports `public`, but README claims `private`.
6. Re-run CI and deployment verification against the exact SHA after any workflow change.

Official references:
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- https://docs.github.com/en/actions/concepts/security/secrets


## 6. Audit refresh — 2026-11-07

- `main` HEAD: `64f96d84b33aff57d9c09bbe7ff54396e651552c`.
- Repository visibility: `private` (GitHub repository metadata).
- Toolchain: Node 24, pnpm 10.34.9, Next.js 16.4.3.
- Exact-SHA `quality` on main: SUCCESS, run `42430949038`.
- `preview-deployment` and `auth0-e2e`: SKIPPED on this main run.
- Ruleset API inspection: NOT VERIFIED (HTTP 403 for the private-repository rulesets endpoint).
