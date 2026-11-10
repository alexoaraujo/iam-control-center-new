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
| `VERCEL_PROJECT_PATH` | Exact Vercel team/project path for the documentation deployment gate. |
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
