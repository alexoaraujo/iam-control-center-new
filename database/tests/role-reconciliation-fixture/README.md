# PEOS — role reconciliation fixture (PG18)

This is an executable **test-only** reconciler, not a Neon bootstrap. The independent
CI service starts with no IAM roles or IAM schema, uses the literal localhost
database and an authenticated disposable postgres administrator, checks PG18,
absence of Neon identity and database ownership before any DDL, and serializes
under the fixture migration advisory lock. No production secrets or SQL inputs.

- Production-like partial state: only runtime login exists; add six roles/four edges.
- Development-like partial state: five roles/one edge; add two roles/three edges.
- Seven canonical role attributes and four INHERIT/SET/ADMIN memberships.
- Preserve existing identities; refuse attribute drift, unexpected inbound/outbound
  memberships, unexpected grantors/options, role settings, default ACL drift and
  unexpected database/schema/table/column ACLs. Owners and FORCE RLS drift block
  instead of being silently rewritten. Only default PUBLIC CONNECT/TEMP of the
  disposable database is removed, as an explicit fixture policy.
- Validate synthetic owner schema and table with no policies/default deny.
  No business data, no password imported; rollback includes role creation,
  memberships, database ACLs and synthetic schema.
- Idempotent replay produces zero changes. Failures use subtransactions and
  savepoints to prove no partial grant/role changes. Final committed fixture is
  used to run the existing migration-runner harness via a real local login.
- The postgres superuser here is a CI fixture setup identity, **not** proof of a
  least-privilege Neon administrative executor. Provider-managed inbound grants,
  real owner/ACL inventories, role credential custody, actual worker/runtime
  access and canonical lineage require separate reconciliation and approval.

The canonical bootstrap 0000 and migrations 0001–0004 are unchanged. No live Neon,
no ledger backfill, no G3 or Production authorization.
