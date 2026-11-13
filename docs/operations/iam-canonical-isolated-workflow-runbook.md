# GitHub Actions — authenticated source export and isolated canonical restore

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
- The old six-grant ACL remediator for NEW Development is **not applicable** to the new database (0 future grants to runtime).
- The source has **1 historical ledger row**, the new destination is **schema-only/0 ledger rows**. Do **not** insert a fake legacy marker or claim lineage complete.

## Remaining required acceptance after running

- Read the actual export source logs, artifact fingerprint and restore outcome. Review differences in functions/owners/default ACLs, migration IDs/bytes and test restore against original source SHA; counts alone are insufficient.
- Prove *independent* recovery/rollback and data strategy. A successful `pg_restore` of schema-only content proves neither data backup nor real PITR.
- Run signed-context RLS A/B, HTTP grant 200/revoke 403, cross-tenant denies, cleanup on restored database and exact-sha Auth0 Preview E2E.
- Validate GitHub `main` ruleset, CODEOWNERS, independent reviewer and formal release approval before any application or Production change.

**Stop conditions:** missing reviewer/environment/secrets; incorrect host, username, target database, TLS version, required roles or empty-target proof; expired branch; failed pg_dump/pg_restore; unknown owner/ACL or ledger divergence; user-requested change to Production. Do not suppress failures or auto-clean a partially restored target without separate review.

**Zero mandatory paid dependencies:** Linux runner + official PostgreSQL 18 image, existing GitHub Free/Neon Free. No paid snapshot scheduling or Vercel changes required to run preflight/export/isolated restore.
