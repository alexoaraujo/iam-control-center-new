# ADR 0002: Tenant-scoped role-based access control

- Status: **Accepted**
- Date: 2026-10-26
- Decision owner: project owner authorization recorded in the project conversation
- Scope: application authorization contract only; no database migration or runtime endpoint implementation

## Context

The live Development/Preview schema models authorization as `iam.memberships` → `iam.membership_roles` → `iam.roles` → `iam.role_permissions` → `iam.permissions`. The earlier proposed TypeScript contract modeled direct membership-permission grants, which conflicts with that schema. Historical SQL for ledger versions `0001` and `0002` has not been recovered and their stored checksums are not verified source hashes.

## Decision

Adopt **tenant-scoped RBAC** as the single authoritative application authorization model. Do not introduce or use a parallel `membership_permissions` grant table in the application contract.

1. An external identity is resolved from validated OIDC claims using the pair `(issuer, subject)`; email is not an identity key.
2. A local identity may have memberships in multiple tenants.
3. A membership is evaluated only when active and scoped to the requested tenant.
4. Roles are tenant-scoped. A membership-role assignment is valid only when the membership and role belong to the same tenant.
5. Effective permissions are the union of permission keys granted to the roles assigned to that active membership.
6. Client-supplied tenant IDs, role names, and permission claims are untrusted. Server-side membership resolution is authoritative.
7. PostgreSQL RLS is defense in depth, not a replacement for application authorization.
8. Deny by default: missing identity, tenant, active membership, role assignment, or permission yields denial.
9. Global identity and permission-catalog access, tenant discovery, invitation flows, and audit-event behavior require explicit endpoint/data-access rules before implementation.
10. Runtime database credentials must not own application objects or have `BYPASSRLS`; migration privileges remain separate.

## Domain mapping

| Contract concept | Current database mapping |
|---|---|
| External identity / local identity record | `iam.identities(issuer, subject, ...)` |
| Tenant | `iam.tenants` |
| Tenant membership | `iam.memberships(identity_id, tenant_id, ...)` |
| Membership-to-role assignment | `iam.membership_roles` |
| Tenant-scoped role | `iam.roles(tenant_id, ...)` |
| Role-to-permission mapping | `iam.role_permissions` |
| Permission catalog key | `iam.permissions` |

This mapping is a contract mapping, not a claim that all columns, constraints, grants, or policies have been independently verified. In particular, Development/Preview currently lack RLS on `iam.roles` and `iam.role_permissions`, and tenant-discovery policy is unresolved.

## Consequences

- TypeScript types and pure domain tests must represent role-based grants rather than direct membership-permission grants.
- Database migration design must preserve tenant consistency across membership-role and role-permission relationships.
- Authorization must be tested for tenant A/B isolation, inactive membership, absent roles, unknown permission, and missing tenant context.
- No executable migration may be authored/applied until SQL history is reconciled or a baseline is explicitly approved, RLS policy design is reviewed, and real runtime credentials are tested.

## Out of scope

This ADR does not implement OIDC login, session validation, database queries, RLS policies, migrations, deployment configuration, or Production changes. The RLS prototype results in the evidence report are not proof that shared environments are secure.
