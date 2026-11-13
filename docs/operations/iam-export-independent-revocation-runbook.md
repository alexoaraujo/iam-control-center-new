# IAM — independent emergency revocation of export MAINTAIN lease

**Status 2026-11-13: reviewed proposal, NOT operationally configured.** The independent revoker is a *separate* manually dispatched GitHub Actions workflow and a REVOKE-only utility. It does not grant, issue, extend, or schedule a MAINTAIN lease. Without verified external approval and an independent recovery SLA, no persistent grant is allowed in Development.

## Scope, identity, and controls

- Repository: `alexoaraujo/iam-control-center-new`, only default branch `main`; workflow `.github/workflows/iam-export-emergency-revoke.yml`.
- Neon project **`tiny-rice-70320263`**; target branch **`development / br-ancient-term-b6mmx5ol`**; database **`iam_database`**.
- Pinned, direct endpoint: `ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech:5432`. No other project, clone or Production branch is eligible. `sslmode=verify-full&sslrootcert=system`, official PostgreSQL 18 client, CA verification. The script also requires the exact declared project and branch IDs, but **these string inputs do not replace Neon control-plane attestation**. Before using it, independently query the Neon branch endpoint and verify this host belongs to exactly that branch.
- Administrative principal: `neondb_owner` ONLY for remediation; never pass these credentials to the application or export workflow. The exporter remains `iam_schema_export_reader` and does not receive any membership in owner/migrator.
- Protected GitHub environment to create and review separately: **`IAM-Canonical-Revocation`**. Configure exactly the authorized `main` deployment branch, independent reviewer `alexoaraujo83`, prevent-self-review and bypass restrictions supported by repository/plan. Check these settings via GitHub API **before adding a secret**. The workflow's reference to an environment is not proof those controls exist; GitHub may create an environment with no protection automatically.
- Environment secret `IAM_EXPORT_REVOKER_URL`: direct PostgreSQL URI with administrator credential, never in chat, issue comments, git files or logs. It must encode username `neondb_owner`, host/database/port as above, exactly the two TLS query parameters. Never use source reader credentials.
- Environment secret `IAM_EXPORT_REVOKER_APPROVAL`: literal `REVOKE_ONLY_IAM_DEV_EXPORT_READER` after protection verification. Environment variables `IAM_EXPORT_REVOKER_PROJECT_ID=tiny-rice-70320263` and `IAM_EXPORT_REVOKER_BRANCH_ID=br-ancient-term-b6mmx5ol`. Environment secret values and reviewer configuration have **not** been verified through the connected GitHub tool.

## Exact operations

[Workflow — manual emergency revoke](https://github.com/alexoaraujo/iam-control-center-new/actions/workflows/iam-export-emergency-revoke.yml).

- `preflight` + confirmation `NO_DDL` is the default. It only checks the table/reader privilege inventory over PostgreSQL system catalog. It does not grant, revoke, read application data, or prove a cleanup took place.
- `revoke` + exact confirmation `REVOKE_ONLY_IAM_DEV_EXPORT_READER` requires the protected approval secret and is a **destructive change in Development**, intended only as a separately authorized emergency recovery action if a MAINTAIN lease had actually been issued.
- The REVOKE-only script validates the administrative connection hostname/database/TLS, then opens a transaction, checks `current_user=session_user=neondb_owner`, PostgreSQL 18, the three IAM schemas and the bounded relation inventory. It enumerates only regular/partitioned tables in `iam`, `audit` and `app_private`; executes **REVOKE MAINTAIN** per table and **REVOKE USAGE** on those three schemas for `iam_schema_export_reader`; then COMMITs and opens a **separate database connection** for verification. It does **not** revoke other users' privileges, alter membership, change RLS, delete data, modify ledger, or run `pg_dump`.
- If MAINTAIN or USAGE remains, if the reader gained privileges to read data, if a membership exists or if the role's security attributes were weakened, it reports **REVOCATION_INCOMPLETE** and requires manual incident escalation. There is **no false success** when the SQL fails or the external connection is unavailable.
- A failed psql invocation must not log raw stdout/stderr; only allowlisted status strings are printed. The URL/password is not on the psql command line; the workflow's Docker PostgreSQL 18 wrapper passes credential environment variable *names*, not secret values, to the container process.
- The operation is intended to be **idempotent**. When the prior lease was already revoked, a re-run checks the same zero-privilege end-state.

## Threat model and limitations

1. **MAINTAIN is broad**, allowing nontrivial maintenance commands and stronger locks. This procedure does not make MAINTAIN safe to leave in place even temporarily; it only provides emergency revocation of the narrow expected table/schema grants. Prefer a design that avoids persistent elevated rights when possible.
2. GitHub Actions `workflow_dispatch` is **manual, not a hard realtime watchdog**. An approval gate, GitHub outage, quota, queued workflow, or blocked credentials can delay revocation. **Do not mark an independently timed kill-switch PASS** based on this workflow alone. Before granting MAINTAIN persistently in Development, require an independently managed emergency channel, duty operator, reviewed maximum lease duration, response timing, and a successfully rehearsed post-commit revocation against a disposable Neon clone.
3. REVOKE does not immediately terminate active PostgreSQL sessions or remove locks already acquired; separately inspect activity/locks as appropriate, with role-specific termination requiring distinct explicit approval and guards.
4. Role memberships, default ACLs, and owner powers are intentionally outside this script. If an unexpected membership, SELECT/UPDATE/DELETE, BYPASSRLS or new table appears, halt subsequent exports and coordinate a separately approved security incident plan. Do not silently extend the SQL to revoke unrelated access.
5. The Neon project and branch IDs are operator-declared context; pinning the direct verified TLS hostname is necessary but independent API control-plane attestation is still required before use.
6. `IAM-Canonical-Revocation` must not share secrets with an export issuer; release of the revoke workflow cannot be used to authorize an export. No scheduled workflow, branch target replacement or bypass of environment reviewers is part of this PR.

## Evidence and gates

The pre-existing Neon clone `br-spring-grass-b6gap6kp` (expires `2026-11-16T12:00Z`) already proved a **SAVEPOINT-only** MAINTAIN/USAGE grant and rollback, a real `ACCESS SHARE` lock without SELECT, and role graph transaction rollback. See `docs/operations/iam-export-lease-neon-isolated-rehearsal-20261113.md` and [Issue #15](https://github.com/alexoaraujo/iam-control-center-new/issues/15).

This PR must pass offline tests for malicious/wrong URLs, preflight-only, insufficient approval, no GRANT/DML, committed REVOKE, independent fresh-session verification, incomplete revocation, idempotency and password redaction. Tests must run without secrets through the existing canonical offline CI gate. Passing these **mocks** does not mean a live emergency REVOKE was executed or an environment was configured.

**Next operational gate** (requires separate explicit approval and independent review): configure the environment protections and secret, validate an actual committed GRANT/REVOKE with two independent admin sessions on the **disposable clone only** and verify the originating branch remains unchanged. Only then evaluate a narrowly time-boxed lease issuance protocol with external rescue controls, then resolve source/target role graph, run authenticated `readiness_only` on exact `main` SHA, and consider `export_only`. `restore_isolated`, ledger reconciliation, data backup/PITR, Auth0/RBAC/RLS and cutover remain BLOCKED.

No mandatory paid service or new Python dependency is required.
