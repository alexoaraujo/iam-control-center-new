# Neon PR branch lifecycle

## Purpose

Create one short-lived Neon branch for each same-repository pull request, using the permanent `development` branch as its parent. Keep `preview` and `production` untouched.

## Required GitHub configuration

| Name | GitHub location | Purpose |
|---|---|---|
| `NEON_API_KEY` | Repository Actions secret | Neon Management API authentication |
| `NEON_PROJECT_ID` | Repository Actions variable | Neon project selector |

The Neon GitHub integration previously installed these names. Confirm their presence in repository Settings before enabling the workflow. Never print, copy into logs, or commit secret values.

## Lifecycle

- Events: `opened`, `reopened`, `synchronize`, and `closed` through `pull_request_target`.
- Same-repository PRs only. Fork PRs are ignored and receive no Neon branch.
- Branch name: `preview/pr-<number>`.
- Parent: the unique branch named `development`, which must itself be a child of the unique default Production branch.
- Idempotency: an existing branch is reused only when its parent is the expected Development branch. It is never replaced automatically.
- Expiration: 14 days, refreshed on open/reopen/synchronize.
- Close: delete only the exact PR branch after verifying its parent and confirming it has no children; then verify that it is absent.
- Capacity: fail closed at 10 total project branches (current Free-plan limit). Permanent branches are never removed to make room.
- No migration, seed, compute endpoint, connection-string export, Vercel environment update, or Production operation is performed.

## Security model

The workflow is deliberately privileged because it uses the Neon Management API key. It therefore:

1. Uses `pull_request_target`, which takes the workflow from the repository's default branch.
2. Does not check out, download, build, or execute code from the pull request.
3. Has no `GITHUB_TOKEN` permissions (`permissions: {}`).
4. Accepts only a numeric PR number from the event and constructs the branch name internally.
5. Ignores fork PRs.
6. Checks the Production → Development ancestry and fails closed if it differs.
7. Deletes only the exact branch whose parent is the expected Development branch.
8. Never logs the API key or connection strings.

Do not add checkout, scripts, artifacts, package installation, or commands sourced from PR content to this workflow.

## Parent-branch data audit

Read-only audit of Development branch `br-bitter-rain-b6j4sexv`:

| Database | Finding | Interpretation |
|---|---|---|
| `iam_control_center` | No user tables, views, materialized views, or large objects | No application data objects found in this database |
| `postgres` | Platform schemas `neon` and `neon_migration`; `public.health_check` (1 row) and `public.lakebase_attributes` (0 rows), all inspected relations owned by `cloud_admin` | Appears to be Neon-managed metadata; row contents were not inspected |
| Neon Object Storage | API reports unavailable in `aws-sa-east-1` | Branchable Object Storage is not available in this project's region |

The application database has no user data objects in the inspected catalogs. However, the parent-data safety gate remains **NOT VERIFIED**: the health-check row was not inspected, role password reuse from the parent is inherent to Neon branching, and the audit does not prove the absence of sensitive data in every possible platform object. Do not use Development as a production-data clone. Keep it synthetic-only.

The Neon API inspection connected as `Administrador`; it does not prove the application's effective runtime login or its effective grants/RLS behavior.

## Capacity and cost

The workflow creates a branch without a compute endpoint. It does not automatically provide a per-PR `DATABASE_URL` to Vercel. That is a separate integration and must be designed with scoped credentials and explicit environment handling. The Free-plan ceiling is 10 branches per project; the workflow checks the current count before creation and Neon remains the authoritative quota enforcement if concurrent PR events race. A rejected create operation fails the job; no permanent branch is removed. API requests have bounded connection and total timeouts.

Development currently has an active read-write compute endpoint. The lifecycle workflow does not create additional endpoints for PR branches.

## Activation and acceptance

This workflow runs only after it is merged into the default branch. Keep its PR Draft until review. After merge, test with a controlled same-repository PR and verify:

- branch is created from Development, not Production;
- no compute endpoint is provisioned;
- retry/synchronize reuses the same branch;
- expiration is set to approximately 14 days;
- fork PR does not create a branch;
- close deletes only the matching child branch;
- missing configuration, wrong ancestry, quota exhaustion, and API failures fail closed.

A successful GitHub workflow run proves only the lifecycle API operation for that event. It does not prove database runtime connectivity, tenant isolation, RLS, or application integration.
