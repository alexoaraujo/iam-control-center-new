# Proposed baseline 0001 — review record

- Repository: alexoaraujo83/iam-control-center
- Work branch: proposal/initial-iam-schema
- Dependency/base: Draft PR #27, branch audit/neon-tenant-isolation-2026-10-26
- State: **PROPOSAL — NOT APPROVED FOR SHARED DATABASES**
- SQL: database/proposals/0001-initial-iam-schema.sql
- Intended test engine: disposable PostgreSQL 18 service in GitHub Actions
- Production and shared Development/Preview: **not touched by this proposal**

## 1. Evidence and approved contracts used

| Area | Contract used | Source/status |
|---|---|---|
| External identity | Exact validated OIDC pair (issuer, subject); email is mutable and not a key | Architecture overview; accepted ADR-0002 |
| Tenant membership | One membership per identity and tenant; status is explicit | ADR-0002 and read-only historical catalog report |
| RBAC | Membership → membership_roles → tenant-scoped roles → role_permissions → permissions | Accepted ADR-0002 |
| Tenant consistency | Composite FKs bind membership and role assignments to the same tenant | Historical read-only catalog report; enforced again in this proposal |
| Authorization | Deny by default at application layer; RLS is defense in depth | Accepted ADR-0002 |
| Runtime | No table ownership, BYPASSRLS, DDL, or migrator credential for the application runtime | Migration guide and security ADRs |
| Migration history | Source SQL for historical versions 0001/0002 was not recovered; stored ledger strings are not verified file checksums | Audit evidence; baseline is new proposed source, not a historical reconstruction |

The catalog report came from older Development/Preview database neondb; it is evidence for the documented relationship pattern only. Current target databases named iam_control_center were separately created and observed empty. This proposed baseline is for review against that clean target; it does not claim catalog equivalence between those databases.

## 2. Proposed schema boundary

Included in this review candidate:
- iam.tenants, iam.identities, iam.memberships
- iam.roles, iam.membership_roles, iam.permissions, iam.role_permissions
- audit.events
- iam.schema_migrations
- Tenant-scoped SELECT policies for memberships, roles, membership-role assignments, role-permission mappings, and tenant-scoped SELECT/INSERT for audit events.

Intentionally excluded:
- iam.invitations: token issuance, digest format, expiration, resend/revoke, invited-member visibility, and acceptance semantics are not approved.
- Runtime grants for iam.tenants, iam.identities, iam.permissions, and migration ledger: global discovery, OIDC login bootstrap, minimum identity-profile columns, and catalog exposure remain unresolved.
- Runtime INSERT/UPDATE/DELETE for membership, role, assignment, and permission relationships: no endpoint-level authorization contract exists yet.
- Seed data for global permissions or built-in roles: keys/semantics need product approval.
- Automatic updated_at triggers: policy/ownership and application expectations have not been agreed.
- Any alteration to existing Neon roles, credentials, grants, shared databases, Vercel variables, or deployments.

The proposal grants the runtime enough read access to exercise the tenant-scoped RBAC model and append audit events. It deliberately does **not** complete the login/bootstrap flow. That is a review blocker, not a feature claim.

## 3. Constraints and integrity decisions

1. UUID primary keys use PostgreSQL's built-in gen_random_uuid().
2. identities_issuer_subject_key is the only external identity uniqueness contract. Email is not unique.
3. A membership has a unique (tenant_id, identity_id) pair and a composite unique (id, tenant_id) key.
4. Roles are always tenant-scoped and have unique (id, tenant_id) and (tenant_id, role_key) keys.
5. membership_roles contains tenant_id and composite FKs to both membership and role, preventing assignment across tenants even if application code is faulty.
6. role_permissions does not duplicate tenant_id; scope is derived through its role. SELECT policy checks the referenced role tenant. This must be tested under the actual non-owner runtime login.
7. Statuses are constrained to the currently documented values: tenants active/suspended/deleted; memberships invited/active/suspended/revoked.
8. Audit events are append-only for the runtime: SELECT/INSERT only, with tenant-matched RLS and a composite actor-membership/tenant FK.
9. The migration ledger stores a SHA-256 checksum of the exact proposal file; the test runner records it only in a disposable database.

## 4. RLS limitations — explicit security gate

The candidate has been revised to use a **signed tenant capability prototype** instead of trusting app.tenant_id. The GUC app.tenant_context carries a short-lived, canonical payload bound to key id, tenant UUID, identity UUID, membership UUID, and expiry. A private SECURITY DEFINER verifier checks HMAC-SHA-256 using app_private.tenant_context_keys; runtime receives EXECUTE on the verifier but no SELECT on the key table. The verifier has an empty search_path and schema-qualified references.

The disposable CI suite now signs test contexts using a test-only key generated inside the temporary PostgreSQL service, then exercises HMAC tampering, expired and overlong tokens, tenant/identity/membership field changes, direct key-table denial, and an attempt to switch app.tenant_id while retaining a tenant A capability. The expected result is that the simple GUC is ignored and visibility remains tenant A.

This is a **prototype result only**. The application-side token issuer, secret bootstrap/rotation, signed identity capability for pre-tenant discovery, active-membership revocation behavior, and real Neon runtime-login path are not implemented or verified. The runtime key is not present in source control; the CI key is only a disposable fixture.

Before promotion, review the verifier owner/grants, HMAC key provisioning, TTL/revocation window, error handling, OIDC bootstrap, and all SECURITY DEFINER functions. A signed token prevents the SQL caller from changing its tenant fields without the key, but does not defend against compromise of the trusted backend or signing key.

## 5. Test plan and success semantics

The CI job uses a local ephemeral PostgreSQL 18 service only; it must refuse non-loopback hosts and requires IAM_ALLOW_DISPOSABLE_DB_TESTS=1.

| Scenario | Expected evidence |
|---|---|
| Apply from an empty database | All proposed objects are created in one transaction |
| Record checksum | SHA-256 is computed from exact SQL bytes and stored in the disposable ledger |
| Re-run unchanged proposal | Same checksum is detected and application is skipped; no duplicate objects |
| Concurrent duplicate apply | Session advisory lock serializes attempts; exactly one apply and one checksum-confirmed skip |
| Checksum drift | Existing ledger version with a different checksum is rejected |
| Injected failure after DDL | Transaction rolls back fully; no application schema objects or ledger row remain |
| Recovery after failure | Original unmodified proposal applies successfully to the same disposable database |
| Composite FK tenant mismatch | Assignment of tenant A membership to tenant B role raises FK violation |
| Tenant A/B row visibility | Runtime test login sees only current-context rows for ordinary tenant-scoped queries |
| No, empty, or malformed tenant context | Helper returns NULL and tenant-scoped queries return no rows |
| Append audit to current tenant | INSERT allowed for matching tenant |
| Append audit to another tenant | RLS rejects it |
| Runtime DDL / global table access | Denied |
| Caller changes app.tenant_id while retaining signed tenant A capability | Query remains scoped to A; changing the simple GUC does not change the verified tenant |

The CI success conclusion means **the candidate SQL and its transactional/contract tests passed on disposable PostgreSQL**. It does not mean the IAM application's login bootstrap, real Neon runtime login, secure context boundary, Auth0, Vercel, or shared-database integration passed.

## 6. Apply, rollback, and recovery boundaries

- No file in database/proposals/ is an approved migration or belongs to a migration runner.
- The test-only harness applies the proposal only after verifying a loopback PostgreSQL host and an explicit opt-in flag.
- The entire candidate schema plus its ledger entry is wrapped in one transaction. A failed apply should leave no candidate objects or ledger entry.
- Reapplying the exact candidate is skipped only after a version/checksum match. A changed checksum is a hard failure; never edit an applied migration in place.
- For an eventual production migration, use a separately reviewed versioned migration and a documented forward-correction procedure; do not assume destructive rollback is safe after data exists.
- The initial database baseline strategy requires explicit review because historic SQL sources 0001/0002 were not recovered.

## 7. Approval checklist

- [ ] Review table/column names and lifecycle constraints.
- [ ] Approve tenant discovery and OIDC login bootstrap contract.
- [ ] Approve global iam.identities and iam.permissions access strategy.
- [ ] Approve invitation schema separately or explicitly defer it.
- [ ] Approve audit event vocabulary, metadata retention, and actor semantics.
- [ ] Review the signed-capability verifier, HMAC secret bootstrap/rotation, token TTL and revocation window; keep the signed-identity bootstrap separate from tenant-scoped context.
- [ ] Validate effective privileges using a real non-owner Neon runtime login in an isolated branch.
- [ ] Compare proposed schema with the intended iam_control_center databases and record schema diff.
- [ ] Review migration runner and recovery plan.
- [ ] Approve a follow-up PR before any shared Development change; Production requires separate explicit approval.

**Current classification:** proposal artifacts only. The signed-capability prototype is covered by disposable PostgreSQL tests, but application signing/bootstrap, real Neon runtime authentication, key provisioning/rotation and security review remain pending. No shared database was changed. Migration readiness remains **BLOCKED** until the items above are reviewed and security assumptions are resolved.
