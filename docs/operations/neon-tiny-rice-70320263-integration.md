# IAM Control Center NEW — Neon tiny-rice integration contract (2026-11-10)

## Canonical targets and observed state

| Component | New canonical target |
| --- | --- |
| GitHub | `alexoaraujo/iam-control-center-new`, `main` |
| Vercel | team `aoa4`, project `prj_OnuwD1iarOsXh6FFGkSpK4A5mj80` |
| Neon project | `tiny-rice-70320263`, `aws-sa-east-1`, PostgreSQL 18, Free |
| Production branch | `production`, `br-muddy-snow-b63cepcv` (default) |
| Development branch | `development`, `br-ancient-term-b6mmx5ol` (child of production) |
| Database | `iam_database` |
| Web runtime role | `iam_app_runtime_login`, LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE |

**This is a staged re-point, not an approved data or schema cutover.** New Neon was empty at discovery. `iam_database` and a database-scoped role have been created on the new production branch, then copied into development via Neon branching. The application schemas `iam`, `audit`, `app_private`, policies and migration ledger have NOT been restored to the new project. No application rows were copied. `SELECT 1` and role-attribute checks succeed in development; that does not prove application data parity or tenant isolation.

## Vercel environment boundaries

- Existing **Production** `DATABASE_URL` remains on the previous Neon project `twilight-fire-88497009`. Do not replace it or deploy Production until schema, roles, rows, migrations, RLS, authorized login, and rollback have been verified.
- The **Preview** `DATABASE_URL` for Git branch `chore/sync-neon-tiny-rice-70320263` is a Vercel **Secret**, pointing to the new project's development branch, `iam_database`, runtime role `iam_app_runtime_login`. This setting is branch-scoped and must not be promoted or copied into Production.
- **Preview** `DATABASE_RUNTIME_ROLE=iam_app_runtime_login` is scoped to that same integration branch.
- The existing Auth0 callback alias `iam-control-center-new-preview.vercel.app` is still bound to the old, merged `fix/vercel-deployment-readiness` branch. Do not claim the new integration branch has Auth0 E2E coverage or bind it to that callback host without an exact-SHA URL/branch/callback reconciliation and explicit Auth0 allowlist check.
- `DATABASE_MIGRATION_URL` must never be placed into public-facing Vercel application environments. Migration credentials belong in an independently protected migration execution environment.

## GitHub workflow activation

The versioned `.github/workflows/neon-pr-branch-lifecycle.yml` now validates the **new project** and its default `production` -> `development` lineage, rather than the old project with default `main`. It remains **manual workflow_dispatch only**, with a required `Neon-PR-Lifecycle` protected Actions environment and GitHub metadata validation. It refuses forks, closed PRs on reconcile, unapproved repository names, incorrect branch ancestry, and unannotated branch reuse.

An administrator must configure and verify these GitHub settings before any privileged dispatch:
1. GitHub Actions environment `Neon-PR-Lifecycle`: required trusted reviewers; deployment branch allowlist `main`.
2. Environment secret `NEON_API_KEY`: an appropriately scoped API key for the **new** Neon organization/project (the former organization's key must not be reused without proving it can access the new project). Never expose this key to untrusted PR code.
3. Repository variable `IAM_INTEGRATION_REPOSITORY=alexoaraujo/iam-control-center-new`.
4. Main branch protection/ruleset and required CI checks. On inspection, GitHub's `main` currently reports `protected=false`; changes require repository administrative configuration not exposed to this connector.

Do not run the lifecycle until those protections are verified. It creates a temporary PR branch under `development`, with a validated 14-day expiry, and never automatically deletes a branch without verifiable ownership. Review branch count against Neon Free limit (10).

## PostgreSQL migration and cutover gates

The legacy Neon source is `twilight-fire-88497009` (a **different Neon organization**) and contains a much larger authoritative operational schema. The checked-in `database/migrations/0001_initial_iam_schema.sql` is explicitly labeled `REVIEW PROPOSAL` and has only default-deny objects; it **does not** reproduce the old source's operational objects, functions, privileges and RLS policies. `database/migrations/0002_sessions_touch_contract.sql` requires a development-derived schema lineage and cannot run on an empty database.

Before any new Production `DATABASE_URL` cutover:
1. Extract and reconcile a canonical schema-only, roles/grants and checksummed migration manifest from the legacy source using a reviewed, read-only export mechanism; exclude credentials and application rows from CI artifacts.
2. Restore and test the reviewed schema and approved roles on a **temporary new Neon branch**. Verify schema object inventory, dependencies, ledger checksums, RLS FORCE flags, and tenant A/B isolation using a non-BYPASSRLS runtime login. Confirm no anonymous or cross-tenant writes.
3. Validate necessary data migration explicitly; back up both systems, devise rollback/consistency and traffic freeze or CDC strategy. Do not substitute schema sync for data transfer.
4. Deploy a branch-bound Vercel Preview; verify /api/health, /api/health/database, /api/ready; prove Auth0 login/callback/session/logout with allowlisted origins and protected OIDC access.
5. Only with green CI, RBAC and tenant isolation, operator-approved migration and rollback evidence may a separate production release change replace Production's secret `DATABASE_URL` and redeploy; require smoke tests before release promotion.

## Free tier limitation

Neon returned HTTP 422 `maximum number of protected branches for your current plan` when protecting the default `production` branch; an attempt to set a custom suspension timeout for development returned HTTP 412 `modifying the suspend interval is not permitted on this account`. No paid upgrade was requested. Preserve separation by permissions, deploy gates, branch naming, and restricted runtime credentials; these controls are not equivalent to native protected branches.

## Evidence

- New Neon owner and role attributes inspected directly with Neon; Development login returned `current_user=iam_app_runtime_login` and `rolbypassrls=false`.
- New `iam_database` exists on both the production and development branches, with no IAM application tables yet.
- Vercel Preview credentials stored as a Secret, not in Git.
- This change deliberately does not modify existing Production connection, Auth0 settings, or the legacy source schema export.
