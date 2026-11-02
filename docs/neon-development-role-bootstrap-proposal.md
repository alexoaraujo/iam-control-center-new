# Neon Development role bootstrap — review proposal

## Status

**Draft proposal only. Not approved for execution.** This file is scoped to the canonical Neon Development branch and the exact database name below. It must not be applied to Preview or Production.

| Item | Expected value |
|---|---|
| Neon project | `wandering-wildflower-90908845` |
| Development branch | `br-nameless-wave-b49yqod7` |
| Database | `Iam-control-center` |
| Expected administrative session role | `Iam-control-center_owner` |
| SQL proposal | `database/bootstrap/neon-development-roles.proposal.sql` |

The identifiers above are environment-specific. If any identifier changes, stop and revise the proposal before execution.

## Intent

Create separate non-login ownership/migration/runtime group roles and dedicated login roles. Auth0 remains the identity provider. Neon Auth is not enabled, and no identity/session tables or application grants are created by this bootstrap.

| Role | LOGIN | INHERIT | BYPASSRLS | Purpose |
|---|---:|---:|---:|---|
| `iam_owner` | NO | NO | NO | Own future application objects |
| `iam_migrator` | NO | NO | NO | Explicit migration role |
| `iam_migrator_login` | YES | NO | NO | Dedicated migration connection |
| `iam_app_runtime` | NO | YES | NO | Runtime privilege group |
| `iam_app_runtime_login` | YES | YES | NO | Application connection |

Membership intent:
- `iam_migrator` may explicitly `SET ROLE iam_owner`; it does not inherit owner privileges implicitly.
- `iam_migrator_login` may explicitly `SET ROLE iam_migrator`; it does not inherit migration privileges implicitly.
- `iam_app_runtime_login` inherits `iam_app_runtime` privileges but cannot `SET ROLE` into it or into administrative roles.
- Runtime receives no explicit database CREATE, schema CREATE, migration-ledger, or DDL grants from this proposal. TEMPORARY is not yet secured: the existing PUBLIC grant remains until a separate ACL decision is approved.
- All five roles are non-superuser, non-CREATEROLE, non-CREATEDB, non-replication, and NOBYPASSRLS.

Database ACL strategy:
- PostgreSQL grants `TEMPORARY` on databases to `PUBLIC` by default. Since every role is effectively a member of PUBLIC, a per-role `REVOKE TEMP` cannot subtract this inherited privilege.
- This bootstrap deliberately does **not** revoke TEMPORARY from PUBLIC. The external-consumer inventory is incomplete, and changing the shared database ACL could break unrelated jobs, operators, or integrations.
- Consequently, the runtime login will continue to have effective TEMPORARY privilege through PUBLIC after this bootstrap. The runtime role must not be activated or placed in Vercel `DATABASE_URL` until a separate, reviewed ACL change removes or narrowly replaces that privilege.
- A follow-up ACL proposal must identify all consumers, document any legitimate TEMP requirement, test the exact privilege outcome on disposable PostgreSQL 18, and request separate execution approval. Do not apply it to Preview or Production without independent review.

The only database-level grant in this bootstrap is `CREATE` on `Iam-control-center` to `iam_owner`. No database ACL revocation, passwords, or credentials are created.


## Neon administrative principal exception — observed Development state

The current Neon Development administrative principal is a provider-managed bootstrap identity, not an application identity. Read-only inspection on 2026-11-02 observed:

| Attribute | Observed value |
|---|---|
| `session_user` / database owner | `Iam-control-center_owner` |
| Direct `rolsuper` | `false` |
| Direct `rolcreaterole` | `true` |
| Direct `rolcreatedb` | `true` |
| Direct `rolbypassrls` | `true` |
| Membership in `neon_superuser` | `true` |
| `SET` capability for `neon_superuser` | `true` |

This is an explicit environment exception to the simplified phrase “non-superuser administrator”: the principal is not a PostgreSQL superuser, but it has direct BYPASSRLS and elevated provider-managed membership. The bootstrap proposal intentionally requires this exact administrative login and must be run only by an authorized operator for the one-time Development bootstrap.

**Mandatory separation controls:**
- Never configure `Iam-control-center_owner` as `DATABASE_URL`, `DATABASE_MIGRATION_URL`, application runtime, CI runtime, or normal migration credentials.
- Never grant membership in `neon_superuser`, `iam_owner`, or `iam_migrator` to the application runtime login.
- Use the dedicated `iam_migrator_login` for subsequent schema migrations, with the explicit `iam_migrator -> iam_owner` SET ROLE chain only.
- Keep the owner principal out of application secrets and routine deployment workflows. Do not copy its provider-managed privilege attributes to any of the five IAM roles.
- The disposable PostgreSQL CI administrator intentionally does not reproduce Neon’s provider-managed `neon_superuser` membership or BYPASSRLS. CI validates the SQL role bootstrap mechanics, not the provider-managed Neon administrative boundary.

## TEMP dependency inventory — mandatory pre-execution gate

The observed Development database currently grants effective TEMP to its administrative session. The proposed `REVOKE TEMPORARY ... FROM PUBLIC` changes the shared database ACL.

A direct read-only query of `pg_roles` on 2026-11-02 returned the provider-managed roles `cloud_admin`, `neon_service`, `neon_superuser`, `Iam-control-center_owner`, PostgreSQL predefined roles, and `token_roles`. Among the observed provider roles, `cloud_admin` is LOGIN and SUPERUSER; `neon_service` is LOGIN with CREATEROLE, CREATEDB, and BYPASSRLS; `neon_superuser` is NOLOGIN with CREATEROLE, CREATEDB, and BYPASSRLS. The Neon role-list API had returned only the user-facing owner role, so it must not be treated as a complete `pg_roles` inventory.

The database ACL observed at the same time grants `CONNECT` and `TEMPORARY` to PUBLIC; `CONNECT`, `CREATE`, and `TEMPORARY` to `Iam-control-center_owner`; and `CONNECT`, `CREATE`, and `TEMPORARY` to `neon_superuser`. The owner and provider roles are platform-managed principals; their presence in the catalog is not evidence that they are application consumers. The current `pg_stat_activity` sample showed one active `pgbouncer` session as `Iam-control-center_owner`; this is only a point-in-time observation and cannot identify all possible consumers or scheduled workflows.

This catalog and ACL evidence still does **not** prove that no external process, future login, or operational workflow relies on temporary tables.

Before applying the proposal, the operator must complete and record this inventory for the exact Development database:

| Check | Required evidence | Status |
|---|---|---|
| Enumerate all PostgreSQL roles and login-capable roles | Timestamped `pg_roles` inventory | PENDING |
| Enumerate current database ACL, including PUBLIC TEMP | `pg_database.datacl` / `aclexplode` output | PENDING |
| Identify every application, job, script, integration, and human workflow connecting to this database | Owner-confirmed consumer inventory | PENDING |
| Ask each identified consumer whether it creates temporary tables or depends on TEMP implicitly | Explicit yes/no and owner for each consumer | PENDING |
| Confirm whether any non-runtime consumer requires TEMP after bootstrap | Approved exception list; otherwise explicit “none identified” | PENDING |
| Confirm runtime has no effective TEMP after the proposed ACL change | Disposable test plus post-bootstrap read-only query on Development | PENDING |

Do not infer “no TEMP dependency” merely because no application roles have been created yet. If a legitimate consumer requires TEMP, stop and revise the ACL design to grant TEMP narrowly to that principal after review; do not silently restore TEMP to PUBLIC. If no consumer is identified, record the inventory result and its scope before seeking separate execution approval.

The current evidence is insufficient to mark this gate PASS. This section is a review requirement, not authorization to execute the SQL.

## Fail-closed preflight

The SQL starts a transaction and aborts unless:
1. `current_database()` is exactly `Iam-control-center`;
2. `session_user` is exactly `Iam-control-center_owner`;
3. the session role is CREATEROLE and is not superuser;
4. the session role owns the target database and has CREATE;
5. none of the five target IAM roles already exists.

The script does not attempt to repair or adopt pre-existing roles. Any preflight failure is a stop condition. A failure before COMMIT rolls back the transaction.

## Required validation before execution

1. Confirm Neon PostgreSQL version and that the membership-option syntax (`ADMIN`, `INHERIT`, `SET`) is supported.
2. Test this exact SQL in disposable PostgreSQL 18 using a non-superuser database owner with CREATEROLE. The existing bootstrap CI must not rely solely on running as PostgreSQL superuser for this validation.
3. Assert the five role attributes and membership options from `pg_roles` / `pg_auth_members`.
4. Prove the migration chain can explicitly assume `iam_migrator` and then `iam_owner`.
5. Prove the runtime login cannot assume owner/migrator roles, cannot create in public or migration schemas, and cannot read/write the migration ledger. Confirm that the scoped PUBLIC TEMPORARY revocation leaves `has_database_privilege('iam_app_runtime_login', current_database(), 'TEMP') = false`; the test must emit an explicit BLOCKED result and exit non-zero if TEMP remains effective.
6. Test SQLSTATE `42501` for expected permission denials; distinguish authorization failures from unrelated SQL errors.
7. Confirm that future application tables are owned by `iam_owner`, never the runtime role, and that tenant tables use `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY`.
8. Review the resulting Git diff and CI evidence at the exact head SHA.

Important test limitation: the legacy PostgreSQL 18 harness uses `SET SESSION AUTHORIZATION` for earlier role-chain tests; that is not a proof of password authentication. The new proposal-specific test must connect as a real disposable LOGIN administrator with CREATEROLE and database ownership, then connect separately as the migrator and runtime LOGIN roles. Disposable TCP trust is limited to loopback inside the CI container and is not a production authentication pattern.

## Execution controls

- Do not execute this SQL from CI, a migration job, or an automated deployment.
- Do not execute it against Preview or Production.
- Do not store login passwords in Git, SQL, CI logs, PR comments, or ChatGPT.
- After separate approval, execute only against the named Development branch and database, with an explicit backup/recovery checkpoint and a reviewed operator procedure.
- After execution, independently query role attributes, memberships, database ACLs, and schema ACLs; capture the branch ID, database, UTC timestamp, SQL artifact SHA, and verification output.
- Do not mark PASS until evidence is tied to the exact Neon branch and execution result.

## Rollback / stop criteria

Before any role is used or owns objects, a rollback can be prepared to revoke the database grant and memberships, then drop the five roles in dependency-safe order. Do not execute rollback automatically. If any target role already exists, any object is owned by a target role, any password/login is configured, or any unexpected grant is observed, stop and perform a new dependency/ownership review instead of dropping roles.

## Evidence classification

- Current role/database inventory is read-only Neon evidence, not evidence that bootstrap has run.
- PostgreSQL 18 CI is disposable test evidence only.
- GitHub Preview success is deployment evidence only; it does not prove Neon connectivity, authentication, RLS isolation, or execution of this SQL.
- Production remains untouched and out of scope.
