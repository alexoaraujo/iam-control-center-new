# PostgreSQL Schema and Migration Design (v1)

Status: Design proposal only. No SQL migration has been applied or created by this document.

## 1. Goals and non-goals

Goals:
- Persist local principals and their validated external OIDC identities.
- Persist tenants, memberships, application-owned permission grants, and append-only audit events.
- Make tenant scope explicit in keys, constraints, query contracts, and RLS policies.
- Run all validation against an isolated disposable PostgreSQL database before any shared environment is changed.

Non-goals:
- No production data, production credentials, or shared database changes.
- No implicit tenant or membership provisioning on first login.
- No use of email, profile metadata, or client-supplied role lists as authorization keys.
- No claim that RLS is effective until tested using the actual non-owner runtime role.

## 2. Proposed relational model

### principals
- `id`: UUID primary key, generated as UUIDv4 by the application (proposed v1 default; no PostgreSQL extension required).
- `status`: constrained to `active`, `suspended`, `deleted`.
- `created_at`, `updated_at`: `timestamptz NOT NULL`.
- No email-based uniqueness requirement for authorization.

### external_identities
- `principal_id`: FK to `principals(id)`, delete behavior reviewed explicitly.
- `issuer`: non-empty text, exact configured/validated issuer.
- `subject`: non-empty text, opaque and case-sensitive.
- `created_at`, optional `last_seen_at`: `timestamptz`.
- Primary key or unique constraint on `(issuer, subject)`; index `principal_id`.
- Do not persist raw OIDC tokens or client secrets.

### tenants
- `id`: UUID primary key.
- `slug`: unique human-facing locator, not an authorization grant.
- `display_name`: non-empty display value.
- `status`: constrained to `active`, `suspended`, `deleted`.
- `created_at`, `updated_at`: `timestamptz NOT NULL`.

### memberships
- `id`: UUID primary key.
- `tenant_id`, `principal_id`: non-null FKs.
- `status`: constrained to `invited`, `active`, `suspended`, `revoked`.
- `created_at`, `updated_at`, optional `revoked_at`: `timestamptz`.
- Proposed v1 default: one durable row per `(tenant_id, principal_id)`, enforced by `UNIQUE (tenant_id, principal_id)`; revocation and later reactivation update that row through explicit authorized transitions and append-only audit events.
- Tenant-scoped lookup index `(tenant_id, principal_id, status)`.
- This does not preserve each membership incarnation as a separate relational row. If product requirements need first-class historical membership periods, revisit this proposal before SQL is written.

### membership_permissions
- `tenant_id`, `membership_id`, `permission_key`: non-null.
- `granted_at`: `timestamptz NOT NULL`; optional `granted_by_principal_id` FK.
- Optional `revoked_at`.
- Prefer a composite FK ensuring the membership belongs to the same tenant, backed by a unique `(tenant_id, id)` on memberships.
- Proposed v1 default: `membership_permissions` stores current authorization state; enforce one active grant per `(tenant_id, membership_id, permission_key)` with a partial unique index where `revoked_at IS NULL`.
- Grant/revoke history belongs in append-only `audit_events`, not in duplicate current-state rows. Permission keys must be validated against the application permission registry; never accept client-supplied grants.

### audit_events
- `event_id`: UUID primary key.
- `occurred_at_utc`: `timestamptz NOT NULL`.
- `event_type`, `outcome`, `reason_code`: bounded, validated strings or enums.
- Optional `principal_id`, `tenant_id`, `membership_id`, `permission_key`, `resource_type`, `resource_id`, `request_id`.
- No tokens, authorization headers, passwords, client secrets, or database connection strings.
- Runtime role receives INSERT and necessary SELECT only; no UPDATE/DELETE/TRUNCATE on audit history. Ownership and retention operations use a separately controlled role.

## 3. Referential integrity and tenant scope

- Use explicit FK delete behavior; avoid cascading deletion of audit evidence.
- Tenant-owned entities include `tenant_id` directly or enforce equivalent tenant scope through composite foreign keys.
- Where a table references a tenant-owned parent, prefer composite FK constraints such as `(tenant_id, membership_id) REFERENCES memberships(tenant_id, id)`.
- Index FK columns and actual authorization query paths.
- Do not rely on application query filters alone for tenant isolation.
- Avoid overly broad grants and avoid making the application runtime role the schema/table owner.

## 4. Roles and least privilege

Proposed role separation (names are placeholders pending environment conventions):
- Migration owner: owns schema and applies reviewed migrations; not used by web runtime.
- Runtime role: LOGIN only if operationally required; no SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, or BYPASSRLS; not table owner.
- Test/administration role: isolated and scoped; never expose its credentials to Preview clients.
- Grant only required schema USAGE and table/sequence/function privileges.
- Enable and FORCE ROW LEVEL SECURITY where appropriate after verifying table ownership and operational implications.
- RLS policy must fail closed when tenant context is absent. Tenant context should be set transaction-locally, e.g. with `SET LOCAL` / `set_config(..., true)`, and reset automatically at transaction end.
- Never trust a session variable alone: application code must derive tenant context only after authentication and membership authorization.

## 5. Migration safety plan

1. Review this design and resolve the open decisions below.
2. Create SQL migrations in a separate implementation PR only after review.
3. Start a disposable PostgreSQL instance matching the managed service major version.
4. Apply migrations from an empty database; assert schema, constraints, indexes, roles, grants, RLS and policies.
5. Test re-running the migration command and concurrent deployment behavior; migrations themselves must not be blindly re-applied if the migration runner tracks them.
6. Test rollback or document a tested forward-recovery plan for non-reversible operations.
7. Test upgrade from the previous schema snapshot, not only from an empty database.
8. Run all authorization/RLS tests using the exact runtime role, not the owner or superuser.
9. Test two synthetic tenants: permitted same-tenant reads/writes, denied cross-tenant reads/writes, and denied access when tenant context is missing.
10. Inspect effective privileges from PostgreSQL catalogs and test actual operations; configuration intent alone is not evidence.
11. Record migration identifier, database engine/version, test command, UTC timestamp, branch, head SHA, CI run URL and result.
12. Only after review and isolated tests may a separately approved change target a shared non-production environment.

## 6. Required isolated tests

- Identity uniqueness for exact `(issuer, subject)`; same subject from different issuers remains distinct.
- Reject empty issuer/subject and invalid state values.
- Referential integrity for principal, tenant, membership and grant.
- Membership uniqueness and documented reactivation semantics.
- Grant constrained to the membership's tenant; revoked grants do not authorize.
- RLS same-tenant allow; cross-tenant deny; missing tenant context deny.
- Runtime role cannot bypass RLS, alter schema, grant privileges, or modify/delete audit events.
- Audit events do not cascade-delete when principal/tenant records are deactivated or archived.
- Transaction-local tenant context does not leak when pooled connections are reused.
- Migration failure does not leave the schema falsely marked as fully applied.

## 7. Proposed defaults to ratify before SQL is written

The companion decision record proposes the following v1 defaults. They are not yet approved for executable migrations:
- UUIDv4 generated in the application; no PostgreSQL extension required.
- One durable membership row per `(tenant_id, principal_id)`; revocation/reactivation updates the row and emits append-only audit events.
- `membership_permissions` is current authorization state; grant/revoke history is recorded in append-only `audit_events`.
- PostgreSQL 18 as the target major version, subject to confirmation in disposable CI and the managed environment.

## 8. Open blockers before SQL is written

- Audit retention, export/backup, access controls, partitioning threshold and controlled retention procedure.
- Migration runner and transaction/concurrency/retry/recovery policy, chosen after dependency inventory.
- Exact runtime and migration role names/grants, confirmed from the target environment without exposing credentials.

## 9. Acceptance criteria

- [ ] Contract document reviewed and approved.
- [ ] Proposed defaults in section 7 ratified and open blockers in section 8 resolved and recorded.
- [ ] SQL migrations reviewed before execution.
- [ ] Empty-database and upgrade tests pass on the supported PostgreSQL version.
- [ ] RLS and effective privileges verified with the non-owner runtime role.
- [ ] Cross-tenant and missing-context tests pass.
- [ ] Rollback or forward-recovery procedure tested.
- [ ] Evidence links to the exact code SHA and CI run.
- [ ] No shared database changed without separate approval.
