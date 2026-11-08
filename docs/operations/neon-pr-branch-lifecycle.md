# Neon PR branch lifecycle

## Canonical Neon target

This repository uses the following Neon project for IAM database delivery:

| Setting | Canonical value |
|---|---|
| Project | `iam-database-delivery` |
| Project ID | `twilight-fire-88497009` |
| Permanent branch | `main` |
| Branch ID | `br-little-fire-b6adup9f` |
| Endpoint | `ep-twilight-shadow-b618ef5h` |
| Database | `iam_database` |
| Migration login | `iam_migrator_login` |
| TLS mode | `sslmode=require` |

The workflow pins the project and main-branch identifiers in its trusted default-branch definition. It does not depend on a mutable `NEON_PROJECT_ID` Actions variable. The only required GitHub Actions secret is `NEON_API_KEY`; its value must never be printed, copied into logs, or committed.

For migration clients, use the direct (non-pooled) endpoint host:

```text
postgresql://iam_migrator_login:<PASSWORD>@ep-twilight-shadow-b618ef5h.c-2.sa-east-1.aws.neon.tech/iam_database?sslmode=require
```

Supply the password through the CI secret store, never in source control. Do not use the `-pooler` hostname for schema migrations. Application runtime connections must use their separately provisioned least-privilege login, not the migration login.

## Verified Neon inventory

Read-only Neon API inspection confirmed:

- Project `twilight-fire-88497009` exists in `aws-sa-east-1`, PostgreSQL 18.
- `main` is the unique default branch, ID `br-little-fire-b6adup9f`, state `ready`.
- Endpoint `ep-twilight-shadow-b618ef5h` is the read-write endpoint attached to that branch. It was idle/suspended at inspection time; the first connection may incur a cold start.
- Database `iam_database` exists and is owned by `iam_database_owner`.
- Login `iam_migrator_login` exists.
- A read-only session using that login confirmed `current_user = iam_migrator_login`, database `iam_database`, CONNECT and public schema USAGE, and no CREATE on schema `public`.
- The role has LOGIN, and does not have SUPERUSER, BYPASSRLS, CREATEDB, or CREATEROLE.
- The Neon project currently has 8 branches against the Free-plan limit of 10. The workflow fails closed when the project already has 10 branches; it never deletes permanent or existing branches to make room.

The MCP SQL session is not proof of TLS on the application's network path. The actual CI migration connection must use `sslmode=require` and its TLS behavior must be verified from the runner before a migration is considered validated.

## Purpose and lifecycle

Create one short-lived Neon branch for each same-repository pull request, validating the permanent `main` → `development` lineage and using `development` as the temporary branch parent. The workflow:

- Runs on `opened`, `reopened`, `synchronize`, and `closed` events through `pull_request_target`.
- Ignores fork PRs.
- Uses the unique default branch only if its name and ID exactly match the canonical `main` branch above and its state is `ready`.
- Validates that `development` is a READY direct child of the canonical READY `main` branch.\n- Creates or reuses `preview/pr-<number>` as a child of `development`.
- Requires an exact ownership annotation before reusing a branch or refreshing its TTL.
- Sets and verifies a 14-day expiration.
- Does not provision a compute endpoint, export a connection string, run a migration, seed data, or modify Vercel environments.
- Does not delete a branch automatically on PR close. The TTL is the fallback; manual cleanup requires independent ownership and dependency verification.

## Security model

The workflow is privileged because it uses the Neon Management API key. It therefore:

1. Uses the workflow definition from the repository default branch.
2. Does not check out, download, build, or execute PR content.
3. Has no `GITHUB_TOKEN` permissions (`permissions: {}`).
4. Accepts only a numeric PR number from the event and constructs the branch name internally.
5. Ignores fork PRs.
6. Validates the canonical project ID, canonical default main-branch ID, and `ready` state before creating a branch.
7. Serializes trusted PR lifecycle events for this repository.
8. Fails closed on unexpected branch parent, missing ownership annotation, quota exhaustion, or API errors.
9. Never logs the API key, passwords, or connection strings.

Do not add checkout, scripts, artifacts, package installation, or commands sourced from PR content to this privileged workflow.

## Operational acceptance

This workflow is not active until it is merged into the repository default branch. Keep the PR Draft until independent review is complete. Before treating the lifecycle as operationally accepted, run a controlled same-repository PR and verify:

- the permanent `development` branch is validated as a direct child of canonical `main`;\n- the PR branch is created from `development`, not directly from `main` or another branch;
- no compute endpoint is provisioned;
- retry/synchronize reuses only the exact owned branch;
- the expiration matches 14 days;
- fork PRs do not create branches;
- closing a PR does not delete a branch;
- missing configuration, unexpected main-branch identity, quota exhaustion, and API failures fail closed.

A successful GitHub workflow run proves only the Management API operation for that event. It does not prove database runtime connectivity, TLS, migration correctness, tenant isolation, RLS, or application integration. Those require separate evidence on the exact commit and target environment.

## Explicit operational boundaries

- No migration was run by this configuration update.
- No Neon branch was created, modified, or deleted.
- No Neon role, password, database, endpoint, or permanent branch was changed.
- No Vercel environment, Production deployment, or Auth0 configuration was changed.
