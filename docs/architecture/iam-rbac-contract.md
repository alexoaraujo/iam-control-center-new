# IAM domain contract: tenant-scoped RBAC

Status: **Accepted contract; implementation remains incomplete**  
Decision: [ADR 0002 — Tenant-scoped RBAC](./decisions/0002-tenant-scoped-rbac.md)

## Trust and identity

- The server validates the Auth0/OIDC session before using identity claims.
- The stable external identity key is the validated `(issuer, subject)` pair. Email is profile data only.
- A browser-supplied tenant ID is a selector, not authorization evidence.
- The server resolves the local identity and an active membership for that identity and tenant before evaluating permissions.

## Authorization graph

```text
validated OIDC (issuer, subject)
  -> iam.identities
  -> active iam.memberships for requested tenant
  -> iam.membership_roles
  -> tenant-scoped iam.roles
  -> iam.role_permissions
  -> iam.permissions.key
```

The effective permission set is the distinct union of permission keys attached to all roles assigned to the active membership within the same tenant. Unknown permission keys and absent relationships grant nothing.

## Contract invariants

1. Tenant isolation is mandatory for membership and role assignments.
2. A membership may only be assigned a role from the same tenant.
3. A role's permissions are resolved through that role; permissions are not granted directly to a membership.
4. No membership or role from tenant B can satisfy an authorization check for tenant A.
5. Inactive, missing, or ambiguous membership resolution denies access.
6. An empty or absent database tenant context must not expose tenant-scoped rows.
7. Malformed tenant context is an error that must be handled safely; validate tenant IDs before setting PostgreSQL session context.
8. Runtime database access follows least privilege; runtime cannot perform DDL or bypass RLS.
9. Administrative migration history is not writable by the application runtime.
10. Audit records should capture security-relevant outcomes without storing secrets or raw tokens.

## Database mapping and unresolved schema decisions

| Concept | Table / field mapping | Required follow-up |
|---|---|---|
| External identity | `iam.identities.issuer`, `subject` | Confirm uniqueness and global directory-read policy |
| Membership | `iam.memberships.identity_id`, `tenant_id`, status | Confirm exact active-state field and unique constraints |
| Role assignment | `iam.membership_roles` | Verify composite FK guarantees same-tenant membership/role |
| Role | `iam.roles.tenant_id` | Add reviewed RLS/FORCE RLS design before migration |
| Role permission | `iam.role_permissions.role_id` → `iam.roles` | RLS must authorize through the referenced tenant-scoped role |
| Permission catalog | `iam.permissions` | Define whether runtime may read the full global catalog |
| Tenant discovery | `iam.tenants` | Define allowed discovery and metadata visibility |

Column names and status values above are descriptive where not explicitly shown; implementation must verify the actual catalog before writing SQL.

## Pure domain API

The TypeScript contract intentionally provides only pure, deterministic operations over already-resolved domain data:

- `IdentityKey`: validated issuer and subject.
- `ActiveMembershipContext`: identity, tenant, membership, and active state resolved by trusted server code.
- `RoleGrant`: tenant-scoped role assignment and its permission keys.
- `effectivePermissions(context, grants)`: returns distinct permission keys only for active membership grants matching the context's tenant and membership.
- `hasPermission(context, grants, permissionKey)`: exact-key permission check, deny by default.

These helpers do not validate Auth0 tokens, query PostgreSQL, establish tenant context, or replace RLS.

## Required negative tests before endpoint work

- Missing context denies.
- Inactive membership denies.
- Grant for another membership denies.
- Grant for another tenant denies.
- Unknown permission denies.
- Duplicate grants do not duplicate effective permission keys.
- No direct membership-permission grant model is introduced.
- RLS/effective privileges are later tested using the actual non-owner runtime login in an isolated database.
