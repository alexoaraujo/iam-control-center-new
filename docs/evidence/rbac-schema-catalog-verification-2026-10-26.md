# RBAC schema catalog verification — Development and Preview

- Date: 2026-10-26
- Repository: `alexoaraujo83/iam-control-center`
- PR: [#27](https://github.com/alexoaraujo83/iam-control-center/pull/27)
- Audited branch: `audit/neon-tenant-isolation-2026-10-26`
- Neon project: `floral-surf-85783683`
- Scope: read-only catalog inspection of Development (`br-mute-pine-b6lc6bip`) and Preview (`br-lucky-fog-b6vv08bq`), database `neondb`.
- Safety: SELECT-only catalog queries. No DDL, DML, migration, role change, or Production access in this step.

## Findings confirmed in both branches

### Identity and membership contracts

- `iam.identities` has `id`, `issuer`, `subject`, profile fields, and timestamps.
- Unique constraint `identities_issuer_subject_key` enforces uniqueness of `(issuer, subject)`.
- `iam.memberships` uses `identity_id`, `tenant_id`, and `status`; allowed status values are `invited`, `active`, `suspended`, and `revoked`.
- Unique constraint `memberships_tenant_id_identity_id_key` enforces one membership per identity and tenant.
- `iam.membership_roles` includes `tenant_id`; composite foreign keys bind `(membership_id, tenant_id)` to `iam.memberships(id, tenant_id)` and `(role_id, tenant_id)` to `iam.roles(id, tenant_id)`. This is important database-level tenant-consistency evidence.
- `iam.roles` includes `tenant_id` and a unique `(id, tenant_id)` key.
- `iam.role_permissions` has `role_id` and `permission_key`, with foreign keys to `iam.roles(id)` and `iam.permissions(key)`. It has no `tenant_id`; tenant authorization must be derived through its referenced role unless the schema is deliberately changed.
- `iam.permissions` uses `key` as its primary key.
- `iam.tenants` has a status constraint allowing `active`, `suspended`, and `deleted`.

## RLS state observed

The following state was returned for both Development and Preview:

| Table | RLS enabled | FORCE RLS | Policy observed |
|---|---:|---:|---|
| `audit.events` | Yes | Yes | Tenant read and insert |
| `iam.invitations` | Yes | Yes | Tenant isolation |
| `iam.memberships` | Yes | Yes | Tenant isolation |
| `iam.membership_roles` | Yes | Yes | Tenant isolation |
| `iam.roles` | No | No | None |
| `iam.role_permissions` | No | No | None |
| `iam.tenants` | No | No | None |
| `iam.identities` | No | No | None |
| `iam.permissions` | No | No | None |
| `iam.schema_migrations` | No | No | None |

Runtime grants observed in both branches include SELECT on `iam.tenants`, `iam.roles`, `iam.role_permissions`, and `iam.permissions`; SELECT/INSERT/UPDATE on identities, invitations, membership_roles, and memberships; and SELECT/INSERT on audit events. The catalog query reports grants to the `iam_app_runtime` role, not proof that a real application login authenticated successfully.

## Interpretation and required follow-up

1. The schema supports the accepted tenant-scoped RBAC model and contains composite foreign keys for tenant consistency in membership-role assignments.
2. `iam.roles` and `iam.role_permissions` are currently not protected by RLS in either shared branch. This is an unresolved tenant-isolation gap; do not treat the isolated prototype as proof of shared-branch protection.
3. Tenant discovery and global identity/permission catalog visibility remain policy decisions. Do not enable broad RLS or change policies without reviewing the required bootstrap/login and invitation flows.
4. The `role_permissions` policy must constrain access through the associated role's tenant and handle both row visibility and writes.
5. Runtime-login validation remains outstanding. Catalog grants do not establish that a real non-owner runtime credential works or is safe.
6. The SQL source for ledger versions `0001` and `0002` remains unrecovered; this catalog report does not reconstruct or replace migration history.

## Next safe sequence

1. Review the proposed RLS design for `iam.roles` and `iam.role_permissions`, including read/write predicates and tenant-context bootstrap.
2. Specify tenant discovery plus global identity and permission-catalog access.
3. Validate privileges and behavior using actual non-owner runtime credentials on an isolated Neon branch.
4. Reconcile original migration SQL or approve a documented baseline strategy.
5. Only then propose a versioned migration for review. No migration is authorized or applied by this report.

## Evidence limitations

This is a catalog snapshot of Development and Preview at the time of inspection. It does not prove Production schema equivalence, OIDC correctness, real runtime authentication, end-to-end application authorization, or successful deployment of a database change.
