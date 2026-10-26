# Neon migration reconciliation and isolated RLS prototype evidence

Date: 2026-10-26  
Repository: `alexoaraujo83/iam-control-center`  
Neon project: `floral-surf-85783683`  
Status: audit evidence and design findings only; no migration proposed or applied.

## 1. SQL history reconciliation

### Observed migration ledger

Both Neon branches `development` (`br-mute-pine-b6lc6bip`) and `preview` (`br-lucky-fog-b6vv08bq`) return the same two rows from `iam.schema_migrations`:

| Version | Name | Stored checksum | Applied at (UTC) |
|---|---|---|---|
| `0001` | `initial_iam_schema` | `sha256:bootstrap-v1-iamcc-20261025` | `2026-10-25T14:23:39.518Z` |
| `0002` | `corrective_constraints_rls_and_audit_privileges` | `manual:0002-corrective-constraints-rls-audit-privileges` | `2026-10-25T15:08:17.103Z` |

These are ledger values, not verified hashes of SQL files. The `manual:` value for 0002 is not a reproducible content checksum.

### Repository search result

- The main-branch `database/migrations/README.md` explicitly says no migration is applied by the scaffold and requires reviewed SQL source plus isolated tests.
- GitHub code searches for the exact migration identifiers and policy SQL returned no matches in the default-branch search scope.
- The inspected commit `46288be445803bdca09445a15b994d0cc46d71b5` adds `docs/database/postgresql-migration-design.md` and `docs/architecture/identity-tenant-contracts.md`, both design documents. Its diff contains no executable migration SQL.
- GitHub commit searches for the two exact migration identifiers returned no matches.

**Conclusion:** SQL source for versions 0001 and 0002 has not been recovered. This is not proof that no copy exists in any local workstation, deleted branch, or unsearched external location. Do not recreate the historical files from the live catalog and do not edit the ledger to imply recovered checksums. Preserve the existing schema and ledger while recovering the original source or recording a formally approved baseline/reconciliation decision.

## 2. Contract review — inconsistencies to resolve

The inspected proposed contract and TypeScript domain model do not fully match the live Neon schema:

| Concern | Proposed application contract | Live schema observed in Development/Preview | Required decision |
|---|---|---|---|
| Principal and external identity | `Principal` + `ExternalIdentity(issuer, subject)` | `iam.identities(issuer, subject, ...)`; no `iam.principals` table observed | Decide whether `identities` itself is the local principal or add a distinct principal entity. |
| Membership reference | `membership.principal_id` | `iam.memberships.identity_id` | Keep identity-based membership or introduce a principal mapping; do not silently rename the contract. |
| Permission grants | TypeScript `MembershipPermission(tenantId, membershipId, permissionKey)` and proposed `membership_permissions` | `iam.membership_roles` → `iam.roles` → `iam.role_permissions` → `iam.permissions` | Choose direct grants or role-based RBAC as the authoritative model. Current DB shape is role-based; application types currently model direct grants. |
| Tenant-scoped roles | Role belongs to one tenant | `iam.roles.tenant_id`, unique `(id, tenant_id)`, tenant/key uniqueness | Keep tenant ownership explicit and enable RLS. |
| Role-permission association | Proposed grant scoped to membership | `iam.role_permissions` has no `tenant_id`; it references a role | Scope visibility through the referenced role and its tenant; verify policy and constraints. |
| Tenant discovery | Tenant is a security boundary; client selector is untrusted | `iam.tenants` has no RLS in the observed branch | Define which tenant metadata can be discovered and under which server-side authorization flow. |
| Global identities/catalog | Global identity and permission catalog | `iam.identities` and `iam.permissions` have no RLS | Confirm global scope and restrict runtime access to prevent directory or unrelated metadata exposure. |

### Recommended direction for review (not yet approved)

Prefer one coherent role-based RBAC contract because the current database already models `membership_roles`, `roles`, and `role_permissions`. Under this option, effective permission evaluation is derived from the active membership's tenant-scoped roles and each role's permission keys. Update the TypeScript domain model and tests to match that graph before endpoint implementation. This is a recommendation, not an accepted architecture decision.

If the product instead requires direct membership-permission grants, the database design must be revised explicitly; do not maintain two competing authorization sources.

## 3. Isolated Neon test branch

A separate Neon branch was created from Development for prototype testing:

- Name: `rls-test-isolated-2026-10-26`
- Branch ID: `br-super-darkness-b6a0w5vc`
- Parent: `br-mute-pine-b6lc6bip` (`development`)
- Database: `neondb`
- PostgreSQL: `18.6`

No production branch was targeted.

## 4. RLS prototype tests and results

Because the original schema has no RLS on `iam.roles` and `iam.role_permissions`, the isolated test transaction temporarily created prototype policies, synthetic tenants A/B, roles and a permission. The test-only policy shapes were:

- `iam.roles`: `tenant_id = app_private.current_tenant_id()` for `USING` and `WITH CHECK`.
- `iam.role_permissions`: visibility/write check requires an associated `iam.roles` row whose `tenant_id` equals `app_private.current_tenant_id()`.

The transaction used `SET LOCAL ROLE iam_app_runtime_dev_safe`. To permit this role switch from the connector's pinned `Administrador` session, the membership's SET option was temporarily enabled on this isolated branch and restored to `false` before the transaction completed. This is not the same as authenticating with the runtime login's own credentials.

| Test | Result | Evidence boundary |
|---|---|---|
| Tenant A sees only its role and role-permission | PASS | Prototype policy, isolated branch |
| Tenant B sees only its role and role-permission | PASS | Prototype policy, isolated branch |
| Empty tenant context returns zero rows | PASS | Prototype policy, isolated branch |
| Invalid UUID context raises conversion error | FAIL-CLOSED | Application must handle safely; error is not a substitute for input validation |
| Same-tenant role INSERT | PASS | Temporary test grant and prototype policy |
| Cross-tenant role INSERT | PASS-DENIED | Temporary test grant and prototype policy |
| Cross-tenant role-permission INSERT | PASS-DENIED | Temporary test grant and prototype policy |
| Changing role tenant from A to B | PASS-DENIED | Temporary test grant and prototype policy |
| Cleanup of synthetic rows and temporary policies | PASS | Follow-up catalog query: zero test fixtures and zero `rls_test_*` policies |
| Actual runtime login authentication | BLOCKED | Connector rejects `role_name` because connection is pinned to `Administrador`; role switching is only a test approximation |

These results demonstrate that the proposed policy pattern can enforce tenant filtering in a controlled test transaction. They do **not** prove the current Development/Preview schema is isolated for roles, do not verify actual runtime login credentials, and do not authorize applying policies to shared branches.

## 5. Current observed blockers

1. Recover original SQL for migration 0001 and 0002, or approve a documented baseline/reconciliation plan without falsifying historical checksums.
2. Decide direct permission grants versus role-based RBAC; align TypeScript, contract documents, database schema, and tests.
3. Define `iam.tenants` discovery and global `iam.identities` read rules.
4. Design RLS for `iam.roles` and `iam.role_permissions`, including function EXECUTE/schema USAGE, FK behavior, `WITH CHECK`, and owner/migrator interaction.
5. Test using the actual non-owner runtime login from an authorized connection path, not only `SET ROLE` in the admin-pinned connector.
6. Reconcile Production's canonical application database (`iam_control_center`) with Development/Preview's current `neondb`.
7. Keep all schema changes out of shared environments until reviewed and approved.

## 6. Safety statement

This document records observed catalog state and prototype test evidence. It does not contain a production migration, does not apply changes to Production/Development/Preview, and does not claim that the existing RLS gap is fixed. The isolated test branch remains a separate Neon resource and should be retained until its evidence is reviewed; deleting it requires an explicit cleanup decision.
