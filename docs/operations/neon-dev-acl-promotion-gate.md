# IAM Control Center NEW — Neon Development future-default-ACL promotion gate

**PEOS STATUS: PREPARED FOR INDEPENDENT REVIEW — NOT APPROVED FOR PERSISTENT DDL.**

This is an operational proposal for the **six** future grants of `iam_app_runtime_login` on objects that `neondb_owner` may create in `public`. A passing automated test, a matching catalog preflight, or an approval on a **different PR** does **not** authorize the DDL below. Never treat PostgreSQL 18 CI fixtures as a Neon restore/PITR rehearsal.

## Proven environment and scope (12 Nov 2026)

| Property | Exact expectation |
| --- | --- |
| Neon project | `tiny-rice-70320263` |
| Environment | `development` — branch ID `br-ancient-term-b6mmx5ol` |
| Database | `iam_database`, PostgreSQL 18.6 |
| Administrative execution identity | `neondb_owner`, direct TLS connection, never an app/runtime credential |
| Runtime principal | `iam_app_runtime_login`, LOGIN, NOBYPASSRLS, no database CREATE/TEMP |
| Expected future `public` default ACL | 6, four table + two sequence grants, from `neondb_owner` |
| Current objects in `public` | 0 relations/sequences/views |
| Application relations | 27; all owned by `iam_owner` |
| RLS baseline | 41 policies; 20 FORCE RLS relations |
| Legacy ledger / NEW ledger | 1 / 0 (**separate BLOCKED gate**) |
| Source of clone proof | `br-calm-mud-b6x10uvf`, derived from Development, expiring 2026-11-13T13:00:00Z |

The isolated [PR #45 rehearsal](https://github.com/alexoaraujo/iam-control-center-new/pull/45#issuecomment-6824200391) tested the **minimal REVOKE pair** in a Neon transaction on a disposable clone. Results: future objects denied; older objects retained their original grants; `ROLLBACK TO SAVEPOINT` restored six defaults, removed four probes; clone-vs-Development schema diff empty. The clone rehearsal is **PASS**. Development still has six grants; no persistent operation occurred.

## Gate contract: actions before an authorized execution

1. **Control-plane identity:** independently verify the exact project ID, branch ID, and database via Neon. A `SELECT current_database()` does **not** prove the Neon branch. Forbid default `production` (`br-muddy-snow-b63cepcv`) and any Preview/E2E branch. Never use a pooled/multiplexed endpoint for operational DDL.
2. **Independent reviews:** obtain a new approval on **this proposal's exact final SHA**, separate from the approval of the tested PR #45. Operator explicitly approves **persistent ACL-only remediations on Development**, after confirming off-peak impact and any maintenance/change ticket. No blanket approval for roles, migrations, audit policies, data, flags, Vercel, or Production.
3. **Recovery checkpoint:** verify direct TLS connectivity; capture independent pre-change catalog manifest with protected storage and an approved backup/PITR or a rollback alternative. Use the actual role and owner from the preflight. Record last-known-good SHA, timestamp, branch, and output checksum. Secrets must remain in protected environments.
4. **Role graph:** reject any direct membership beyond the single reviewed `iam_app_runtime` grant, or any recursively reachable role outside `iam_app_runtime_login` / `iam_app_runtime` (including elevated provider roles). Version `18.6` is pinned to the reviewed snapshot; a patch upgrade requires a fresh preflight and review.
5. **Snapshot/invariant:** execute `database/scripts/neon-dev-acl-promotion-readiness.sql` as `neondb_owner` directly in the exact target branch. Require `PRECHECK_MATCH_REVIEW_REQUIRED` **AND operator approval**. Any BLOCKED error, missing object, new grant, unexpected owner, changed policy/ledger, or altered runtime attribute stops work. Re-run immediately before execution; do not reuse an old snapshot.
6. **Review `SECURITY DEFINER`** with `database/scripts/neon-security-definer-preflight.sql` from PR #45. Its `REVIEW_PUBLIC_EXECUTE_WITHOUT_SCHEMA_USAGE` is a separate reviewer decision. Do not broaden privileges in order to make this report green.
7. **Change isolation:** halt migrations and other writers while owner-default ACL operations are in progress. Confirm no concurrent DDL. Locking, latency, and conflicting migrations are STOP conditions.
8. **Rehearsal:** revalidate that a disposal-only clone test on a recent parent LSN matches the reviewed proposed two statements. The previous clone result is proof of behavior for its snapshot only.


### Recovery constraints revalidated against official Neon documentation (2026-11-12)

- **Manual snapshots can only be created from root branches**, not from the `development` child branch used for the ACL remediation. The project's root/default is `production`; do not snapshot, restore, swap, reset, or otherwise operate on it as a shortcut for a Development-only change.
- Neon Free allows **one manual snapshot**, and snapshot storage is [priced by retained bytes](https://neon.com/docs/guides/backup-restore). Automated schedules are on paid plans. This project's free-only constraint forbids silently enabling a paid backup feature or incurring unapproved snapshot charges.
- Neon reports a **6-hour history window**, but historical retention alone is not a demonstrated PITR restoration or persistent backup. The currently disposable `validation/iam-runtime-acl-peos-20261112` branch expires 2026-11-13T13:00:00Z.
- **Live logical consistency proof:** exact `COUNT(*)` checks across all 23 IAM/app_private/audit tables matched between Development and the Development-derived clone: **18 total rows in each** (2 identities, 16 permissions, all other tables empty). Separately computed SHA-256 of canonicalized full row JSON for every one of the 23 tables also matched in all sections. No row contents, identity subjects, keys, or individual hashes were exported into the repository. This is a point-in-time equivalence check between branches, **not** an executed restore, data backup integrity attestation, durability guarantee or RTO/RPO measurement.

**Safe next recovery exercise (not yet executed):** obtain independent approval for a direct-TLS, least-privilege logical `pg_dump` of Development and a `pg_restore` into an exclusively disposable, non-production destination, or use a provider-supported isolated restore path that does not mutate `production`. Before execution check the Free plan limits, backup size, credentials, secret storage, expiry, and source/target identifiers. The restoration gate passes only with actual restored table/row/schema consistency, tested role/ACL/RLS semantics, audit provenance, and independently recorded RPO/RTO. The backup contents must not be uploaded as a public GitHub artifact. Until such proof exists: **RECOVERY BLOCKED / PERSISTENT DDL BLOCKED**.

## Live recovery readiness check — 2026-11-12

Read-only Neon control-plane inspection of project `tiny-rice-70320263` found **no listed snapshots** and **no automatic snapshot schedule** for Development or the temporary clone. The project's configured historical retention is `21600` seconds (**6 hours**). This does not establish whether other backup processes exist, nor does it prove a usable PITR recovery point. The disposable ACL rehearsal branch `br-calm-mud-b6x10uvf` has an expiry; it must **not** be treated as the long-term rollback copy.

**Recovery readiness verdict: BLOCKED.** Before any persistent Development ACL change, the operator must obtain an approved recovery path: a verified snapshot or validated time-based branch restore with suitable RPO/RTO, exact baseline/project/branch mapping, and an independently witnessed restore rehearsal. Record evidence in the existing backup/restore issue and identify a fallback for when the six-hour history window expires. No snapshot was created, no automatic schedule was changed, and no restore was invoked in this assessment. Resource use must remain within the project's permitted free-tier limits.

## Candidate change — for human-reviewed manual execution only

**Do not feed this section to an automated migration runner.** The repo intentionally contains no automatically executed persistent ACL migration for this operation. The operator must perform the identity, environment and security gates above, use direct authenticated SQL with `ON_ERROR_STOP`, and review the transaction outcome **before COMMIT**.

Within **one** verified Development administrative transaction:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Operator rechecks the complete fail-closed preflight before opening this transaction.
-- Assert effective role, expected grants, ledger, policies, owner graph and correct branch
-- using separately reviewed catalog assertions; if any condition changed, ROLLBACK.
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM iam_app_runtime_login;

ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  REVOKE SELECT, USAGE ON SEQUENCES FROM iam_app_runtime_login;

-- Mandatory within-transaction postconditions before the operator can COMMIT:
-- 0 future default grants to runtime from this owner/schema;
-- no other grants changed, no existing object/tenant/RLS/ledger change;
-- role membership and owner graph unchanged.
-- If any postcondition fails, ROLLBACK. No partial commit.
-- COMMIT is deliberately not included in this proposal.
ROLLBACK; -- safe default for copy/paste; replace only in separately approved procedure.
```

The absence of a `COMMIT` is intentional. Once reviewed and specifically authorized, the production-grade execution procedure must incorporate **executable** SQL assertions for both the six-entry baseline and the zero-entry postcondition in the same transaction, not merely rely on comments, a stale preflight, or a client that masks errors. Do **not** run a partial text fragment without these guards.

**Not retroactive:** these two statements affect only future objects. Existing object ACLs and the runtime's own roles/memberships must be reviewed separately. Do not revoke `iam_app_runtime` access to existing IAM tables.

## Post-execution gates (only after separately authorized persistent DDL)

- Re-run preflight from a new session; the expected result after a legitimately approved change is **0** target default grants. The pre-change fingerprint script will then report `BLOCKED_UNEXPECTED_FUTURE_ACLS` by design: **do not** mislabel this as a failed remediation. A distinct postcondition must assert exactly zero remaining grants and all other ownership, RLS, and ledger invariants unchanged.
- Verify runtime authentication, no-context deny, signed context, tenant A/B read/write negative cases, Auth0 200→403 grant/revoke at the exact Preview SHA, and audit/outbox artifacts with cleanup on a non-production test environment.
- Record immutable post-change evidence, revised manifest and migration/change log with correct lineage. Never invent historical `iam.schema_migrations` entries.
- A rollback request restores **only the original six known defaults** with the inverse `ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT` commands; verify the role, scope, pre-repair state, exact privileges, unaffected preexisting objects, and change ticket first. Revoking default privileges does not undo intervening object creations. Manual rollback also requires approval and subsequent verification.
- No release/cutover authorization follows from this ACL gate. Resolve [issues #14](https://github.com/alexoaraujo/iam-control-center-new/issues/14), [#15](https://github.com/alexoaraujo/iam-control-center-new/issues/15), [#31](https://github.com/alexoaraujo/iam-control-center-new/issues/31), [#34](https://github.com/alexoaraujo/iam-control-center-new/issues/34) independently.

## Evidence and refusal conditions

- `PASS`: a checked preflight matches expected metadata **and** the operator-specific persistent change approval and rollback checkpoint are independently verified; only then can a separately reviewed manual transaction be planned.
- `BLOCKED`: any structural/ledger drift, unreviewed ownership difference, changed policies, unknown grants, role escalation, wrong branch, unresolved backup/restore, unavailable independent approval, or missing rollback evidence.
- `SKIPPED` never equals PASS.
- This PR's CI can confirm **guard correctness** and may not prove Neon branch identity, full Auth0 end-to-end, or data recovery.
