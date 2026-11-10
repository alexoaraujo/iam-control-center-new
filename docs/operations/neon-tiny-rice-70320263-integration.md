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

**This is a staged re-point, not an approved Production cutover.** The new Neon project's default `production` branch still has no IAM schemas/tables. On 2026-11-10, after a successful isolated validation restore and real runtime tenant-isolation tests, the full checked-in IAM schema was restored into the **new `development` branch only**. It now has 23 base tables, 41 policies and 16 approved permission-catalog rows, but deliberately has **0 migration-ledger rows** pending a provenance strategy. No customer/tenant/session data was transferred. Vercel Production still uses the previous Neon project; no Production database credentials were changed.

## Verified Development restore and runtime tests (2026-11-10)

| Item | Legacy source `twilight-fire-88497009/main` | NEW `tiny-rice-70320263/development` |
| --- | ---: | ---: |
| Base tables | 23 | 23 |
| Views | 1 | 1 |
| RLS policies | 41 | 41 |
| FORCE RLS tables | 20 | 20 |
| Functions / triggers | 9 / 12 | 9 / 12 |
| ENUM types / indexes / sequences | 7 / 63 / 3 | 7 / 63 / 3 |
| Permission-catalog rows | 16 | 16 (exact contents/timestamps) |
| Migration-ledger rows | 1 | **0 — deliberately not copied** |
| Tenant / session rows | 0 / 0 | 0 / 0 |

- New disposable schema validation branch: `validation/iam-schema-20261110`, ID `br-nameless-hat-b6j2p4m4`, parent `development`. The GitHub-versioned `iam_database_schema.sql` was restored there with **346 SQL statements in one transaction**. The versioned `0003_set_tenant_context_search_path.sql` hardening migration passed on this branch and then on NEW Development; the legacy production function still includes `public` in its function-local search_path.
- Normalized PostgreSQL catalog comparisons matched the source on **185 columns, 244 constraints, 24 ENUM values, 63 indexes, 12 triggers, 23 RLS flags, 8 unchanged functions**, and all **41 RLS policies**. Policy fingerprint based on role *names* (rather than environment-specific role OIDs): `43322a1a16b3e8da16e0e11acef961ea`.
- The 16 non-personal permissions were imported from legacy to **NEW Development only**, preserving microsecond timestamps; full field+timestamp fingerprint matches `c1ce8f2a9304273b2b2d699bbaad74e1`. The empty migration ledger means this environment is **not yet migration-ledger-compliant**; do not fabricate or copy legacy execution history without checksum/provenance verification.
- Runtime isolation was tested on a **separate synthetic fixture branch** `validation/tenant-rls-20261110`, ID `br-flat-grass-b6v3ntck`, child of the schema-validation branch. Tested via **actual `iam_app_runtime_login` PostgreSQL login, not SET ROLE**: absent tenant context, signed tenants A/B, tampered/expired/excessive-lifetime tokens, cross-tenant INSERT, allowed A UPDATE, denied B UPDATE and denied missing-context UPDATE. All passed. Fixture branch expires `2026-11-24T19:31:00Z`; the parent branch cannot expire while a child exists, so schedule separate parent cleanup after expiry.
- Security privilege correction applied to **all four NEW Neon branches only**: `REVOKE TEMPORARY ON DATABASE iam_database FROM PUBLIC`. Verified the actual runtime login has `CONNECT=true`, `CREATE=false`, `TEMP=false`, `BYPASSRLS=false`. The old Neon source was not modified.
- On NEW Development, real runtime login sees the 16 permissions but **0 tenants without a signed context**; a no-context INSERT is rejected with SQLSTATE `42501`. Vercel's PR #6 Preview and existing Production `/api/health/database` returned HTTP `200`, but those endpoints do not replace authenticated Auth0/RBAC E2E.
- Reproducible deployment-side read/deny contract: `database/tests/new-neon-runtime-readiness.sql`. Run with `psql` as **`iam_app_runtime_login`** against the **verified direct** NEW Development endpoint, not as the Neon database owner; do not print the connection URI or inject secrets into CI logs.

**Not completed:** source-ledger checksum and migrations provenance, native protection of NEW Production on Neon Free, GitHub `main` protection (still `protected=false` on inspection), Auth0 callback/login/session/logout E2E, RBAC admin flows, backups and Production cutover. Never treat Development parity as permission to change Vercel Production `DATABASE_URL`. Full evidence: https://github.com/alexoaraujo/iam-control-center-new/issues/5#issuecomment-6777602546

## Vercel environment boundaries

- Existing **Production** `DATABASE_URL` remains on the previous Neon project `twilight-fire-88497009`. Do not replace it or deploy Production until schema, roles, rows, migrations, RLS, authorized login, and rollback have been verified.
- The **Preview** `DATABASE_URL` for Git branch `chore/sync-neon-tiny-rice-70320263` is a Vercel **Secret**, pointing to the new project's development branch, `iam_database`, runtime role `iam_app_runtime_login`. This setting is branch-scoped and must not be promoted or copied into Production.
- **Preview** `DATABASE_RUNTIME_ROLE=iam_app_runtime_login` is scoped to that same integration branch.
- **Preview** `APP_BASE_URL=https://iam-control-center-new-git-chore-sync-neon-tiny-ric-4e647f-aoa4.vercel.app` is scoped to that branch, matching the branch alias returned by Vercel for PR #4. This is an application base URL alignment, **not** proof that Auth0 allows this callback host. Any changed environment variables require a fresh Preview deployment to take effect.
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
- NEW Production `iam_database` still has zero IAM application tables. NEW Development now has 23 tables and the source-matching permission catalog, with migration ledger awaiting provenance review.
- Vercel Preview credentials stored as a Secret, not in Git.
- This change deliberately does not modify existing Production connection, Auth0 settings, or the legacy source schema export.
