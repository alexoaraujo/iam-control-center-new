# Integration refactor evidence — 2026-11-10

Repository: alexoaraujo/iam-control-center-new. PR: #1.
Base: 79d4953885fa141f8b7e4f6ce9dca9ab1de12441.

## Implemented

- Explicit repository activation for privileged Neon operations; original target
  allowlists retained pending independent verification.
- Configurable Auth0 domain, callback binding and OIDC identity; exact HTTPS
  origin binding between verified Preview and browser flow.
- PostgreSQL contracts on all PRs and main, separate clean/source schema lineages.
- Shared session guard, extracted dashboard presentation, authenticated readiness
  with a 3-second query timeout and expected-role/privilege checks.
- Uncached liveness/readiness responses; driver failures sanitized.

## Local validation

Node 24.22.1 and corepack pnpm 10.34.9; frozen-lockfile installation.
Lint with zero warnings, typecheck, 26 application tests and production build
passed. Build used inert CI Auth0 configuration, not service credentials.
17 Node script tests passed after the final validation-hardening edit.
pnpm audit returned no known vulnerabilities. All workflow YAML and shell blocks
parsed; git diff --check passed. No dependencies changed.

## Remote evidence for initial refactor commit

Commit: 893e83584c6b23e14c404d828236eded43eea314.
- Quality push CI: https://github.com/alexoaraujo/iam-control-center-new/actions/runs/42748141626 — success.
- Database contracts: https://github.com/alexoaraujo/iam-control-center-new/actions/runs/42748147757 — success.
- Context harness: https://github.com/alexoaraujo/iam-control-center-new/actions/runs/42748147361 — success.
- Role security: https://github.com/alexoaraujo/iam-control-center-new/actions/runs/42748147332 — success.
- Tenant POC: https://github.com/alexoaraujo/iam-control-center-new/actions/runs/42748147334 — success.

These runs apply only to that SHA. Subsequent commits require their own checks.
Disposable PostgreSQL tests do not establish Neon runtime credential validity.

## Remaining release blockers

Vercel team team_sJirgxAuTraeRDORvjCdgiPs returned zero projects when filtered by
repository ID 1451861889. The existing iam-control-center project is not evidence
of a new-repository integration. Preview, Auth0 callback/OIDC and real tenant
A/B runtime tests remain unverified. No database migration or production release
was performed. Main protection and environment reviewers require administrative
configuration; no administration mutation tool is exposed by the GitHub connector.

See docs/operations/repository-integration-setup.md for configuration and acceptance
criteria. No production-readiness or complete domain implementation is claimed.
