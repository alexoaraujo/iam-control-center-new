# Repository integration contract

Target: `alexoaraujo/iam-control-center-new`. Do not copy credentials or assume
that settings from `alexoaraujo83/iam-control-center` migrated with Git files.

## Repository governance

Require a PR, resolved conversations, no force pushes or deletions, and successful
`quality`, `postgres-18-schema-contract`, `postgres-18-source-schema-restore`, and
`postgres-18-source-schema-restore-manifest` checks on main (verify actual check names
in the new repository before configuring). The available GitHub connector has
no administration write tool; these settings must be applied by an administrator.
Also configure reviewers for the Preview and Neon privileged environments before
activating credential-bearing jobs. A committed policy is not branch protection.

## External configuration

| Variable | Contract |
| --- | --- |
| `IAM_INTEGRATION_REPOSITORY` | Explicit allowlist for privileged Neon workflows; set to `alexoaraujo/iam-control-center-new` only after confirming their existing project, branch, database and endpoint allowlists and environment protection. Leaving unset keeps those operations inactive. |
| `VERCEL_PROJECT_PATH` | Exact Vercel team/project path for both Preview deployment gates. Missing configuration fails immediately. |
| `AUTH0_E2E_ENABLED` | `true` activates Auth0 browser tests. Disabled/skipped is not release evidence. |
| `E2E_CALLBACK_HOST` | Preview hostname configured as APP_BASE_URL and allowed callback/logout origin in Auth0. Must equal the hostname from the successful exact-commit Vercel check. |
| `E2E_CALLBACK_BRANCH` | Branch to which that Preview alias is bound. Other branches fail closed. |
| `E2E_AUTH0_DOMAIN` | Exact Auth0 or custom login hostname, no scheme or path. |
| `E2E_OIDC_AUDIENCE` | HTTPS audience configured in Vercel Trusted Sources. |
| `E2E_OIDC_SUBJECT` | Exact configured GitHub OIDC subject ending in `:environment:Preview`; use the new repository identity. No wildcard trust. |
| `DATABASE_RUNTIME_ROLE` | Expected SQL LOGIN identity used by `/api/ready`; configure alongside DATABASE_URL in the application environment. |

Keep AUTH0_E2E_USERNAME/PASSWORD and Neon connection strings in their protected
secrets. Never place credentials in variables, reports or workflow files.
The E2E validator rejects forks, missing values, multiline values, mismatched
branches and a callback alias different from the exact-SHA deployment host.
Trusted OIDC headers are attached only to HTTPS requests for the allowlisted host.

The existing Neon endpoint/project allowlists are deliberately retained: changing
repository identity is not proof that a different database is the correct target.
Reconcile each endpoint before activation. No production migration is automatic.

## Controlled Neon PR lifecycle (December 2026 GitHub policy)

The `.github/workflows/neon-pr-branch-lifecycle.yml` workflow now uses
`workflow_dispatch` exclusively, **not** `pull_request_target`. No PR content
is checked out or executed. This is deliberately manual: opening, synchronizing
or closing a PR does not automatically run privileged Neon operations.

An administrator must create the GitHub Actions environment
`Neon-PR-Lifecycle`, restrict deployments to the protected `main` branch,
require trusted reviewers (and prevent self-review where supported), and place
`NEON_API_KEY` in that environment's secrets, not a PR-accessible context.
Set repository variable `IAM_INTEGRATION_REPOSITORY` to exactly
`alexoaraujo/iam-control-center-new` only after validating Neon project and
branch identities. Environment creation and policy enforcement cannot be
accomplished merely by committing this YAML.

After the updated workflow has been merged to `main`, a reviewer may run it
from **Actions → Neon PR branch lifecycle → Run workflow**, choosing branch
`main`, `pr_number` (numeric), and `operation=reconcile`. The job fetches
the PR from GitHub's API, requires a same-repository open PR targeting main,
checks the explicit repository allowlist, and then creates or reuses only its
owned `preview/pr-N` Neon branch with a verified 14-day expiry. A `closed`
operation is accepted only for a closed PR; it deliberately does **not**
delete branches without verifiable provenance. Expiration handles cleanup.

The workflow is fail-closed when the environment, secret, repository allowlist,
PR state, canonical Neon project or branch identity is missing or mismatched.
Do not use `workflow_dispatch` from an unreviewed branch, disable required
reviewers, or substitute `pull_request_target` to bypass a failed check.
A successful dispatch is evidence of branch lifecycle management, **not**
proof of Auth0 E2E or tenant authorization.

## Verification and release

1. Configure main protections and privileged environment reviewers.
2. Verify the Git integration actually points Vercel at the new repository.
3. Configure Preview and Auth0 exact callback origin and OIDC trust.
4. Run a PR through quality, PostgreSQL contracts, Preview and enabled Auth0 E2E.
5. Validate /api/ready with the expected runtime login, then perform real tenant
   A/B isolation tests separately. Role attributes alone do not prove RLS safety.
6. Record exact SHA, run links and limitations before production promotion.

The Vercel inspection during this refactor found project `iam-control-center`
(`prj_dlR0SjavgGlGfiW9gGSrYUSzGWOe`) in team `team_sJirgxAuTraeRDORvjCdgiPs`.
The returned metadata did not prove a Git link to the new repository. That
integration remains unverified; an existing READY deployment is not evidence for
this refactor's commit.

A team-scoped project query filtered by repository ID `1451861889` returned no
projects during this refactor. A Preview for this repository remains blocked
until its Vercel Git integration is configured and produces exact-SHA evidence.
