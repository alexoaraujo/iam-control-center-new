# PostgreSQL Schema Decision Record (v1)

Status: proposed defaults for review. This document does not create or execute SQL and does not authorize changes to shared databases.

## Decision summary

| Topic | Proposed v1 default | Status |
|---|---|---|
| UUID generation | Generate UUIDv4 in the application; no PostgreSQL extension required | Proposed |
| Membership lifecycle | One durable row per `(tenant_id, principal_id)`; revocation/reactivation updates that row and emits an append-only audit event | Proposed |
| Permission grants | Store current authorization state in `membership_permissions`; revoke by setting `revoked_at`; enforce one active grant per membership/permission with a partial unique index | Proposed |
| Grant history | Append grant/revoke events to `audit_events`; audit history is evidence, not the source used to decide current authorization | Proposed |
| Audit retention | Do not invent a legal retention period; define retention, export and deletion controls before production. No automatic pruning in v1 until that policy is approved | Open blocker |
| PostgreSQL version | Target PostgreSQL 18, matching the current Neon project configuration; CI must use the same major version | Evidence-backed proposal |
| Migration runner | Select after dependency inventory and review of transaction/concurrency requirements; no migration SQL until chosen | Open blocker |
| Runtime role | Dedicated non-owner role with no `BYPASSRLS`, `SUPERUSER`, `CREATEDB`, `CREATEROLE` or `REPLICATION`; exact name/grants verified in isolated tests | Proposed |
| Migration role | Separate schema owner/migration identity, never used by the web runtime | Proposed |

## Rationale and constraints

### UUIDs and extensions
Use application-generated UUIDv4 values initially. This avoids requiring a database extension or elevated database privilege solely for identifier generation. Do not derive authorization identity from email or profile metadata.

### Membership lifecycle
Keep one durable membership row for each tenant/principal pair. Revocation changes the row to `revoked`; a later re-invitation/reactivation reuses the same row and changes its status through an explicit authorized transition. Every transition must emit an append-only audit event with a required `occurred_at_utc` timestamp (non-null; use a database-generated UTC timestamp when the caller cannot supply a trustworthy occurrence time), actor, tenant, target membership, outcome, and request/correlation identifier where available. No membership transition may commit without its audit event and required timestamp. Never cascade-delete audit evidence.

This choice makes uniqueness straightforward, but does not preserve each membership incarnation as a separate relational row. If product requirements need distinct historical membership periods as first-class queryable objects, this decision must be revisited before SQL is written.

### Permission grants
Treat `membership_permissions` as current authorization state, not an immutable event log. Enforce one active grant per `(tenant_id, membership_id, permission_key)` (for example, a partial unique index where `revoked_at IS NULL`). Grant/revoke changes must also create append-only audit events. Authorization checks must ignore revoked grants and validate permission keys against the application-owned registry.

### Audit retention
Do not set an arbitrary retention duration without an approved operational/legal requirement. Before production, define retention period, export/backup requirements, access controls, deletion/partitioning procedure, and who may execute retention operations. Until approved, production remains blocked; test data may be synthetic and disposable.

### PostgreSQL and migration execution
The Neon project currently reports PostgreSQL 18. CI and disposable integration databases should target PostgreSQL 18 so tests exercise the same major version. Verify available extensions and actual privileges rather than assuming them.

Choose a migration runner only after reviewing existing dependencies and deciding transaction, lock, concurrency, retry, rollback/forward-recovery, and migration-ledger behavior. Migrations must be versioned SQL, applied in a disposable PostgreSQL 18 database first, and tested from both empty and prior-schema states.

### Roles and RLS
The web runtime must not own tenant tables and must not bypass RLS. Grant only required schema/table/sequence/function privileges. Tenant context must be derived after authentication and membership authorization and set transaction-locally; missing tenant context must fail closed. Validate actual read/write behavior as the non-owner runtime role, including pooled connection reuse.

## Required evidence before executable migrations

- [ ] Review and approve the proposed membership and permission semantics.
- [ ] Decide audit retention and operational access controls.
- [ ] Inventory package dependencies and choose a migration runner.
- [ ] Verify PostgreSQL 18 availability in disposable CI.
- [ ] Specify exact migration/runtime role grants without exposing credentials.
- [ ] Implement migrations in a separate PR only after the above decisions.
- [ ] Test empty install, upgrade, concurrency, failure recovery, RLS, cross-tenant denial, missing-context denial, and append-only audit enforcement.
- [ ] Record results against exact commit SHA and CI run.

No migration is included in this decision record. No shared Neon branch is changed.
