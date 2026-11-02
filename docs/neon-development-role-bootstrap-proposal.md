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
- Runtime receives no database CREATE/TEMPORARY, schema CREATE, migration-ledger, or DDL grants from this proposal.
- All five roles are non-superuser, non-CREATEROLE, non-CREATEDB, non-replication, and NOBYPASSRLS.

The only database-level grant in this bootstrap is `CREATE` on `Iam-control-center` to `iam_owner`. No passwords or credentials are created.

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
5. Prove the runtime login cannot assume owner/migrator roles, cannot create in public or migration schemas, cannot create temporary tables, and cannot read/write the migration ledger.
6. Test SQLSTATE `42501` for expected permission denials; distinguish authorization failures from unrelated SQL errors.
7. Confirm that future application tables are owned by `iam_owner`, never the runtime role, and that tenant tables use `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY`.
8. Review the resulting Git diff and CI evidence at the exact head SHA.

Important test limitation: the existing PostgreSQL 18 harness uses `SET SESSION AUTHORIZATION` to emulate login identity. That is useful for role-chain checks but is not a proof of password authentication or an actual Neon login. Add a non-superuser bootstrap-admin fixture before treating the Neon-specific preflight as validated.

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
