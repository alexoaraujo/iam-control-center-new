# Identity, Tenant, Membership, and Permission Contracts (v1)

Status: Proposed; review required before endpoint implementation.

This document defines application-owned contracts. It does not implement authentication, authorization, database access, or HTTP endpoints. Auth0 authenticates an external identity; the application remains authoritative for tenant membership and permissions.

## 1. Identity contract

### External identity key
- Canonical external key: the exact validated OIDC pair `(iss, sub)`.
- `iss` must equal the configured issuer after strict issuer validation; do not normalize arbitrary issuer URLs.
- `sub` is opaque, case-sensitive, non-empty, and taken only from a successfully validated token/session.
- A local principal has an immutable internal identifier (`principal_id`) independent of provider and profile attributes.
- Unique constraint: `UNIQUE (issuer, subject)` on the external-identity mapping.
- Email, email_verified, name, nickname, picture, and provider metadata are profile attributes only. Never use them as primary keys, tenant grants, or proof of membership.
- A principal may have more than one external identity in a future account-linking flow; linking must require explicit proof of control of both identities and is out of scope for v1.

### Minimum logical shape
- `Principal`: `id`, `status`, `created_at`, `updated_at`.
- `ExternalIdentity`: `principal_id`, `issuer`, `subject`, `created_at`, `last_seen_at?`.
- `Principal.status`: `active | suspended | deleted`; only `active` principals can authorize requests.
- Do not persist raw ID/access/refresh tokens in application tables or audit events.

## 2. Tenant contract

- A tenant is an application-owned security boundary, not an Auth0 Organization claim and not a client-supplied label.
- Minimum logical shape: `Tenant`: `id`, `slug`, `display_name`, `status`, `created_at`, `updated_at`.
- `id` is an opaque internal ID; `slug` is a human-facing locator and must not be treated as an authorization grant.
- `Tenant.status`: `active | suspended | deleted`; only `active` tenants can authorize requests.
- Tenant IDs from route parameters, headers, request bodies, or UI state are untrusted selectors. The server must independently resolve the tenant and prove the caller's active membership.
- A request must have exactly one effective tenant context unless a future, separately reviewed contract explicitly supports cross-tenant administration.

## 3. Membership contract

- Membership joins one local principal to one tenant.
- Minimum logical shape: `Membership`: `id`, `tenant_id`, `principal_id`, `status`, `created_at`, `updated_at`, `revoked_at?`.
- Unique constraint: `UNIQUE (tenant_id, principal_id)` for a single current membership record; reactivation updates the record or uses an explicit history model, never creates ambiguous active duplicates.
- `Membership.status`: `invited | active | suspended | revoked`.
- Authorization requires `Principal.status = active`, `Tenant.status = active`, and `Membership.status = active` for the same principal and requested tenant.
- Membership is not inferred from email, Auth0 user/app metadata, token role claims, or possession of a tenant ID.
- No implicit tenant, membership, role, or permission is created during first login. Provisioning is a separate, audited administrative workflow.

## 4. Permission contract

- Permissions are application-defined, namespaced, stable identifiers, for example `tenant.read`, `tenant.members.read`, `tenant.members.manage`, and `iam.control_center.read`.
- Roles, if introduced, are application-owned bundles of permissions. A role name alone never authorizes an action; authorization evaluates the effective permission grant for the active membership and tenant.
- Minimum logical grant shape: `MembershipPermission`: `tenant_id`, `membership_id`, `permission_key`, `granted_at`, `granted_by_principal_id?`, `revoked_at?`.
- A permission grant is valid only for the same tenant and active membership. Do not accept client-provided permission lists as authoritative.
- Default is deny. Unknown permissions, missing grants, inactive membership, suspended principal/tenant, and mismatched tenant scope all deny access.
- No wildcard or implicit administrator permission in v1. Any platform-level operator path requires a separately documented contract and explicit audit.

## 5. Authorization decision contract

The server-side authorization boundary receives a validated principal identity, requested tenant selector, required permission, and resource scope. It must:
1. Validate session/token authenticity, issuer, audience, signature, allowed algorithm, expiry, and relevant time claims.
2. Resolve the local principal from the validated `(iss, sub)` mapping.
3. Confirm principal, tenant, and membership are active and mutually consistent.
4. Resolve effective permission grants from application-owned data.
5. Verify the target resource belongs to the same tenant; do not rely only on route tenant IDs.
6. Enforce database row isolation as defense in depth.
7. Emit a structured security audit event for allow/deny and administrative changes, without credentials or raw tokens.

Conceptual result:
- `allow`: principal, tenant, active membership, required permission, and resource scope all match.
- `deny`: any required fact is missing, inactive, invalid, or inconsistent.
- `unauthenticated`: no valid authenticated session.
- `forbidden`: authenticated caller lacks active membership, permission, or tenant/resource scope.
- `not_found`: may be used for tenant-scoped resources to avoid cross-tenant existence disclosure; the policy must be consistent per endpoint.

Do not implement endpoints until the contracts and status/error semantics have been reviewed.

## 6. Persistence and isolation constraints

- PostgreSQL is the source of truth for local principals, tenants, memberships, and application permissions.
- Use foreign keys and tenant-aware uniqueness constraints. Tenant-owned rows must carry `tenant_id` and have indexes aligned with access paths.
- Any RLS policy must fail closed when tenant context is absent or invalid. Set tenant context transaction-locally; never reuse pooled connection context across requests.
- The runtime DB role must not be owner, superuser, or have `BYPASSRLS`, `CREATEDB`, or `CREATEROLE`.
- Test effective privileges and RLS with the actual runtime role, including attempts to read/write another tenant's rows and requests without tenant context.
- Migrations require isolated PostgreSQL tests, apply/reapply or concurrency checks where applicable, and a rollback or forward-recovery plan before merge.

## 7. Audit event contract

Minimum fields: `event_id`, `occurred_at_utc`, `event_type`, `outcome`, `principal_id?`, `tenant_id?`, `membership_id?`, `permission_key?`, `resource_type?`, `resource_id?`, `request_id?`, and a redacted reason code.

- Append-only application semantics; ordinary runtime requests must not update/delete historical audit events.
- Never record tokens, client secrets, database URLs, authorization headers, or unnecessary identity profile data.
- Denials should be auditable without disclosing cross-tenant resource existence to the caller.

## 8. Versioning and compatibility

- These contracts are proposed v1 and must be reviewed before implementation.
- Breaking changes to identifiers, status semantics, tenant scoping, permission names, or error behavior require a versioned decision and updated tests.
- Provider-specific claims must be translated at the authentication boundary; application modules consume provider-independent local contracts.
- Endpoints, migrations, and Auth0 integration are intentionally not included in this change.

## 9. Acceptance criteria for the next implementation stage

- [ ] Review and approve the identity, tenant, membership, permission, and authorization contracts.
- [ ] Add compile-time domain types and focused unit tests before endpoint code.
- [ ] Add migration design and constraint review without applying to shared environments.
- [ ] Test allow and deny cases, including suspended entities, missing membership/grant, cross-tenant requests, and unknown permissions.
- [ ] Test RLS and effective privileges using a non-owner runtime role.
- [ ] Record CI and test evidence against the exact PR head and tested integration SHA.
