# Neon database security audit — 2026-10-26

## Status

**Audit only; no database changes applied.** This report records read-only catalog observations for the Neon project `iam-control-center`. It is not a migration approval and does not establish production readiness.

## Scope and branch map

Project: `floral-surf-85783683` (AWS São Paulo, PostgreSQL 18.6).

| Environment | Branch | Branch ID | Database inspected | State |
|---|---|---|---|---|
| Production | `production` | `br-super-flower-b6k7w8wp` | `iam_control_center` | Ready; application tables not present |
| Development | `development` | `br-mute-pine-b6lc6bip` | `neondb` | Ready |
| Preview | `preview` | `br-lucky-fog-b6vv08bq` | `neondb` | Ready |

The branch hierarchy is Production → Development → Preview. The fixed Preview branch is not a substitute for per-PR ephemeral branches.

## Evidence summary

### Production

- The `iam_control_center` database contains the `app_private`, `audit`, `iam`, and `public` schemas but has zero tables.
- `iam.schema_migrations` and `app_private.current_tenant_id()` do not exist in this database.
- The NOLOGIN role groups `iam_app_runtime` and `iam_migrator`, and login principals `iam_app_runtime_login` and `iam_migrator_login`, exist.
- Runtime principal has no USAGE on `app_private`, no CREATE on application schemas, and no CREATEDB/CREATEROLE/BYPASSRLS attributes.
- Migrator principal has USAGE and CREATE on `iam`, `audit`, and `app_private`. This is catalog evidence only; a real connection using the login credentials was not tested.
- No application tables means table grants, RLS policies, default privileges, and migration history for this production database cannot yet be validated.

### Development and Preview

Both branches were queried independently. Each has 10 application tables and migration records `0001:initial_iam_schema` and `0002:corrective_constraints_rls_and_audit_privileges`. Counts of tenants, identities, memberships, roles, and role-permission rows were all zero in both branches.

RLS catalog results are identical:

| Table | RLS | FORCE RLS | Notes |
|---|---:|---:|---|
| `audit.events` | enabled | enabled | Tenant-filtered SELECT and INSERT policies |
| `iam.invitations` | enabled | enabled | Tenant-filtered ALL policy |
| `iam.memberships` | enabled | enabled | Tenant-filtered ALL policy |
| `iam.membership_roles` | enabled | enabled | Tenant-filtered ALL policy |
| `iam.roles` | disabled | disabled | Has a non-null `tenant_id`; tenant boundary not enforced by RLS |
| `iam.role_permissions` | disabled | disabled | References role by `role_id`; no own `tenant_id` column |
| `iam.identities` | disabled | disabled | Contract must determine whether global identity storage is intentional |
| `iam.permissions` | disabled | disabled | Likely global permission catalog; confirm contract |
| `iam.tenants` | disabled | disabled | Tenant discovery/read policy needs explicit contract |
| `iam.schema_migrations` | disabled | disabled | Keep administrative; not runtime-readable |

The four tenant policies call `app_private.current_tenant_id()`, implemented as a stable SQL function that casts `current_setting('app.tenant_id', true)` to UUID. With no setting, the function returns NULL. A malformed non-empty setting would fail the UUID cast. The application must set tenant context transaction-locally only after validating membership; this behavior still requires tests using the actual runtime role and real transactions.

### Effective privileges, ownership, and defaults

- In Development and Preview, application tables and `app_private.current_tenant_id()` are owned by `Administrador`, not by a dedicated non-login schema owner.
- The `iam_app_runtime` role has SELECT on `iam.roles` and `iam.role_permissions`; these are the two principal tenant-isolation gaps to address first.
- Runtime grants observed on tenant tables are limited to SELECT/INSERT/UPDATE on identities, invitations, membership_roles, and memberships, SELECT on tenants/roles/permissions/role_permissions, and SELECT/INSERT on audit events. No runtime DELETE grants were observed in the queried table ACLs.
- The `iam_migrator` role has DML rights on application tables but lacks CREATE on `iam`, `audit`, and `app_private` in Development and Preview. This is inconsistent with a migration role expected to create/alter schema objects.
- No explicit `pg_default_acl` entries were found in the queried application schemas. Therefore new objects must not be assumed to receive runtime grants automatically; migration tests should assert grants on every created object.
- The Neon connector connection is pinned to `Administrador`; an attempt to run as `iam_app_runtime` was rejected by the connector. Effective runtime-role behavior and real login authentication remain unverified. No credentials were retrieved or included.

## Required design decisions before a migration

1. Define identity as a global principal keyed by validated OIDC `(issuer, subject)`, while tenant membership remains tenant-scoped.
2. Confirm whether tenant-scoped roles are the only role type. Current `iam.roles.tenant_id` is NOT NULL, indicating tenant-scoped roles.
3. Protect `iam.roles` with RLS using `tenant_id = app_private.current_tenant_id()` and FORCE RLS, after reviewing all owner/migrator workflows.
4. Protect reads of `iam.role_permissions` by proving the referenced role belongs to the active tenant. Prefer a tenant-aware relational constraint/design if needed; do not add a redundant `tenant_id` column without deciding how to enforce consistency.
5. Confirm intended read/create/update/delete behavior for `iam.tenants`, global `iam.identities`, and global `iam.permissions`.
6. Establish the schema owner and grant strategy for new tables, sequences, and functions; separate runtime DML from migration DDL.
7. Verify `current_tenant_id()` behavior for correct tenant, other tenant, missing setting, empty setting, malformed UUID, and connection-pool reuse.
8. Run negative cross-tenant tests with the actual runtime login (not `Administrador`) and confirm that the runtime cannot SET ROLE into privileged principals.
9. Reconcile the production database: decide whether migrations should target `iam_control_center` and reproduce the reviewed Development schema there. Do not apply schema changes until the migration is reviewed and approved.
10. Keep Production deployment blocked until CI and Preview evidence are tied to the exact reviewed commit SHA.

## Release gate

**BLOCKED / NOT CONFIGURED** for production readiness. This audit did not apply migrations, change RLS, alter role memberships, create credentials, change Vercel or GitHub secrets, or deploy the application. The repository README and migration guide also state that the scaffold has no implemented application persistence or applied migrations.

## Evidence limitations

- All SQL evidence was read-only and executed through the Neon connector.
- The connector did not permit changing the pinned database role, so effective privileges under the real application login were not proven.
- Development/Preview catalog state was queried; no real Auth0 login, TLS connection test from the application, cross-tenant DML test, or production deployment was performed.
