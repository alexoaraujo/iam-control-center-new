# GitHub Actions — authenticated source export and isolated canonical restore

> **ACTIVE SOURCE-SCOPE CORRECTION — 2026-11-13.** The operator uses Neon organization `alexoaraujo` (org `org-billowing-mouse-09498904`) and project `tiny-rice-70320263`. The authorized **source candidate** is `development` (`br-ancient-term-b6mmx5ol`), database `iam_database`, direct host `ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech`. The isolated **target** is still `br-sweet-union-b6j80a7j`, database `iam_canonical_validation`. **All older instructions below naming `twilight-fire-88497009`, the other organization's `main`, or its `ep-twilight-shadow` endpoint are historical only and MUST NOT be executed.** The dedicated source login `iam_schema_export_reader` does **not exist** on authorized Development as inspected; no secret or privileged owner account may substitute. Do not invoke authenticated `auth_only`, `readiness_only`, `export_only`, or `restore_isolated` until the source export identity and approved credential contract exist. `neon-schema-export.yml` is quarantined. Only offline `preflight_only` or passwordless `tls_probe_only` may be used after revised workflow merges; keep Production untouched.

**Purpose:** operationally allow the previously approved DDL **only** in Neon NEW's disposable database `iam_canonical_validation`. This is **not** approval for any role creation/alteration (Neon roles are branch-wide), ledger manipulation, existing database mutation, Production connection or cutover.

## Run workflow

Workflow filename: `.github/workflows/iam-canonical-isolated-restore.yml`.

When merged into the protected default branch (after SHA-specific independent review and CI), open:

https://github.com/alexoaraujo/iam-control-center-new/actions/workflows/iam-canonical-isolated-restore.yml

Select **Run workflow**, branch **main**, then one operation:

| Operation | Confirmation | Effect |
|---|---|---|
| `preflight_only` (default) | `NO_DDL` | Offline security unit tests, no secrets or database connections |
| `export_only` | `NO_DDL` | Protected environment approval, verified external TLS, PG18 schema-only dump hashed in disposable runner, **no persisted DB DDL** |
| `restore_isolated` | `RESTORE_BR_SWEET_UNION_ONLY` | Protected environment approval, authenticated schema-only export from legacy and attempted PG18 restore **only** into `iam_canonical_validation`, with fail-closed pre/postconditions |

The workflow **does not export or restore application rows**. The custom-format archive stays in the ephemeral Actions runner; SHA-256 is printed, never the SQL dump, passwords, login data, keys or plaintext PII. `pg_restore` uses a transaction and aborts on an error. If pgcrypto is missing, `CREATE EXTENSION` can persist even when restore fails; do not classify this as a completed rollback.

## Configure and verify all three environment secrets (secure local CLI)

The GitHub ChatGPT connector has **no GitHub Environment/Actions Secret write operations**, and the GitHub REST read adapter excludes administration and secrets endpoints. Accordingly an agent cannot truthfully report these three secrets as set through that connector.

On your *own authenticated administrator workstation*, install/authenticate GitHub CLI and run the reviewed non-logging configurator from this PR:

```bash
gh auth status
git fetch origin test/canonical-restore-guard-20261113
git switch test/canonical-restore-guard-20261113
python3 .github/scripts/configure-iam-canonical-environment.py
```

The script configures the environment through GitHub REST **only after validating** the repository, independent reviewer \`alexoaraujo83\`, public visibility and branch \`main\`. It then prompts privately for the **direct** source and target PostgreSQL connection URLs, runs the same deny-by-default URL allowlist, encrypts each value locally using \`gh secret set --env IAM-Canonical-Isolated-Restore\` with **stdin only**, and verifies three environment-secret **names** via metadata (never reads back values). It configures \`IAM_CANONICAL_OPERATOR_APPROVAL\` as the static execution latch after the environment protections pass.

**The static latch string is not a security authorization**: the GitHub Environment required-reviewers gate with prevent-self-review, explicit manual \`restore_isolated\` confirmation and production separation are authoritative. On an existing environment with extra deployment branch policies the configurator refuses to write secrets rather than silently bypass other branch restrictions.

To obtain the two URLs without exposing them in chat or files: open Neon Console → the exact project and branch listed below → **Connection Details**. Choose **direct** (non-pooled), select the exact role and database, and ensure URI query params are exactly \`sslmode=verify-full&sslrootcert=system\`. Never use \`sslmode=require\` as a substitute or place the password in the shell command line. The source is \`iam_schema_export_reader\` on legacy \`main\`; the target is \`neondb_owner\` for \`iam_canonical_validation\`.

This interactive script requires authenticated \`gh\` with repository Administration write access. The connected GitHub tool cannot operate these endpoints, and no secret has been added just by merging the script.


## Create / protect the GitHub environment (administrator)

Environment: **`IAM-Canonical-Isolated-Restore`**.

Configure at https://github.com/alexoaraujo/iam-control-center-new/settings/environments.

On a **public** repository, GitHub Free supports environment reviewers and branch restrictions. Required safeguards:

1. **Required reviewers:** `alexoaraujo83` or a qualified independent reviewer, with **Prevent self-review** and **no bypass** of protection. Verify the approver's distinct identity.
2. **Deployment branches and tags:** only `main`. Do not permit all branches or unreviewed workflow edits.
3. **Environment secrets** (configure directly in GitHub, never place in a repo, PR, issue or chat):
   - `IAM_CANONICAL_SOURCE_URL`: direct URL, username `iam_schema_export_reader`, host `ep-twilight-shadow-b618ef5h.c-2.sa-east-1.aws.neon.tech`, database `iam_database`, options exactly `sslmode=verify-full&sslrootcert=system`.
   - `IAM_CANONICAL_TARGET_URL`: direct URL, username `neondb_owner`, host `ep-crimson-smoke-b6jxg2v5.c-2.sa-east-1.aws.neon.tech`, **only** `iam_canonical_validation`, same TLS options.
   - `IAM_CANONICAL_OPERATOR_APPROVAL`: the literal `APPROVED_BR_SWEET_UNION_ONLY`, **only after independent approval of isolated DDL**. Without it, `restore_isolated` fails before connecting.
4. Ensure all credentials are active, scoped minimally and rotated after the approved rehearsal. Environment secrets must not be repository-wide secrets.

A GitHub workflow referencing a nonexistent environment may automatically create an unprotected environment. **Do not interpret a successful `preflight_only` as proof that environment reviewers or secrets are configured.** Confirm Settings independently before `export_only` or `restore_isolated`.

## Neon control-plane permit list

- Legacy source project `twilight-fire-88497009`, branch `br-little-fire-b6adup9f` (`main`), database `iam_database`. Dedicated export reader is non-BYPASSRLS, no table-data/ledger SELECT.
- NEW isolated target project `tiny-rice-70320263`, branch `br-sweet-union-b6j80a7j` (`validation/iam-canonical-restore-20261113`), database `iam_canonical_validation`. TTL **2026-11-20T09:12:00Z**, compute 0.25 CU. This branch is a child of Development; all its other databases (including inherited `iam_database`) are **out of scope**.
- External SSL must be verified in the runner with `sslmode=verify-full` and `sslrootcert=system`. Internal Neon connector `pg_stat_ssl=false` is not a TLS test.
- **ACL principal remediation — PASS (2026-11-13, independently verified):** with explicit operator authorization, created **only on disposable branch** `br-sweet-union-b6j80a7j` the role `iam_schema_export_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. Neon SQL and API verify the role, zero memberships, and no IAM tables or migration ledger in `iam_canonical_validation`. Source ACL grantees `iam_app_runtime`, `iam_migrator`, `iam_owner`, `iam_schema_export_reader`, `iam_worker` now all exist on this target branch. This change is **branch-wide**; do not recreate it on Development/Production. The NOLOGIN target placeholder is intentional and must never be substituted for the source login credentials. Do not use `--no-acl` to conceal grants. The old six-grant ACL remediator for NEW Development is **not applicable** to this empty database.
- **Remaining runtime-role parity blocker — BLOCKED_ROLE_ATTRIBUTES:** source login roles `iam_app_runtime_login`, `iam_migrator_login` and `iam_worker_login` are LOGIN/NOINHERIT; target has only `iam_app_runtime_login` with LOGIN/INHERIT, and both other login roles are absent. These are Neon branch-wide attributes. Do **not** create the two login roles, alter `iam_app_runtime_login`, grant membership or copy passwords automatically: separate explicit authorization, independent review, branch rollback strategy and tests are prerequisites. The restore preflight intentionally fails before first DDL on this mismatch.
- **Secrets and external export — not independently verified:** operator reports `IAM_CANONICAL_TARGET_URL` and `IAM_CANONICAL_OPERATOR_APPROVAL` configured, but the connected GitHub API cannot read environment secret metadata. `IAM_CANONICAL_SOURCE_URL` remains unconfirmed. Obtain the legacy `iam_schema_export_reader` **direct** URL privately in Neon console with TLS verify-full; do not paste credentials into issues, chat, commits or PRs. Neither a successful Neon internal SQL query nor a pooled `sslmode=require` URI proves external TLS. Do not invoke `export_only`/`restore_isolated` before protected-environment verification.
- The source has **1 historical ledger row**, the new destination is **schema-only/0 ledger rows**. Do **not** insert a fake legacy marker or claim lineage complete.

## Remaining required acceptance after running

- Read the actual export source logs, artifact fingerprint and restore outcome. Review differences in functions/owners/default ACLs, migration IDs/bytes and test restore against original source SHA; counts alone are insufficient.
- Prove *independent* recovery/rollback and data strategy. A successful `pg_restore` of schema-only content proves neither data backup nor real PITR.
- Run signed-context RLS A/B, HTTP grant 200/revoke 403, cross-tenant denies, cleanup on restored database and exact-sha Auth0 Preview E2E.
- Validate GitHub `main` ruleset, CODEOWNERS, independent reviewer and formal release approval before any application or Production change.

**Stop conditions:** missing reviewer/environment/secrets; incorrect host, username, target database, TLS version, required roles or empty-target proof; expired branch; failed pg_dump/pg_restore; unknown owner/ACL or ledger divergence; user-requested change to Production. Do not suppress failures or auto-clean a partially restored target without separate review.

**Zero mandatory paid dependencies:** Linux runner + official PostgreSQL 18 image, existing GitHub Free/Neon Free. No paid snapshot scheduling or Vercel changes required to run preflight/export/isolated restore.
