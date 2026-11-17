# IAM G1 — independent PostgreSQL 18 temporary privilege lease rehearsal

**Date:** 2026-11-15 UTC. **Classification:** synthetic CI PASS only, NOT Neon G1
release approval. No credentials, secrets, Production or Development connection.

## Proven with real PostgreSQL 18

Source: `database/tests/iam-g1-pg18-lease-synthetic.sh`, executed by
`.github/workflows/iam-g1-pg18-lease-synthetic.yml`, with
`postgres:18-bookworm` and `docker run --network none`.

- A synthetic `iam_schema_export_reader` role begins with no USAGE, MAINTAIN,
  SELECT, INSERT, UPDATE, DELETE, TRUNCATE or BYPASSRLS. Schema-only pg_dump is
  correctly denied.
- Runtime tenant isolation: synthetic tenant A reads only A, B reads only B,
  no tenant context reads 0 rows. All verification from independent
  authenticated local PostgreSQL sessions with FORCE RLS.
- A temporary local fixture lease grants `USAGE ON SCHEMA iam,audit,app_private`
  and `MAINTAIN` only on three named synthetic tables **and one view**.
- A real `pg_dump --schema-only --format=custom` with PostgreSQL 18 **succeeds
  on the synthetic fixture**. The TOC contains schema objects, no TABLE DATA
  or BLOB DATA. The temporary archive and all synthetic test data stay in the
  isolated container and are not uploaded.
- `SELECT` from all three fixture tables, including
  `app_private.context_keys`, remains forbidden throughout the local lease.
- Schema USAGE makes a publicly EXECUTE-granted SECURITY DEFINER function
  invocable. This is a **documented risk**, not an acceptable consequence to
  ignore in Neon.
- The fixture privilege lease is revoked and committed. A separate connection
  verifies 0/3 schema USAGE, 0/4 relation MAINTAIN (including the view), 0/4 relation SELECT. A subsequent
  pg_dump is denied again; the synthetic SECURITY DEFINER function is no
  longer callable.

## Why this is NOT permission to perform a Neon grant

The test initially exposed an incomplete REVOKE: the added view retained MAINTAIN and the independent parity check correctly failed. The corrective test updates REVOKE to include the view and requires a new CI PASS.

The actual Neon PostgreSQL 18 branch `br-spring-grass-b6gap6kp` has **23**
tables, **3** sequences and **1** view; the synthetic fixture has only three
tables, an identity sequence and one view. It cannot prove that every production-schema
object can be dumped under this privilege set.

The actual Neon `app_private.context_keys` has a `secret bytea` column and
does **not** use RLS; the schema-level grant to the reader could open
function execution paths not currently available. The Neon
`iam.clear_tenant_context()` is SECURITY DEFINER with EXECUTE granted to
PUBLIC. Although its reviewed definition only clears session GUCs, a
temporary USAGE grant widens invocation surface.

**MAINTAIN is not a lock-only privilege.** It also permits maintenance
operations such as VACUUM, ANALYZE, CLUSTER and REINDEX on its relations.
No PostgreSQL privilege provides exactly 'LOCK ACCESS SHARE only'
without additional authority. Do not substitute broad SELECT, INSERT,
UPDATE, DELETE, TRUNCATE, SUPERUSER, BYPASSRLS or SECURITY DEFINER
wrappers without a separate security design.

The PR #83 probe explicitly requires `USAGE=0/3` and `MAINTAIN=0/23`
before running its negative test. An authorized privilege lease requires
**a distinct reviewed execution mode** with exact expected grants and
post-rollback verification; changing existing negative contract checks
to accept anything automatically would be a regression.

## Required approval packet for a Neon branch-only lease

- [ ] Independently approved scope: project `tiny-rice-70320263`,
  disposable Neon branch `br-spring-grass-b6gap6kp`, database
  `iam_database`, reader `iam_schema_export_reader`, 3 app schemas,
  list of exactly 23 tables, no grants on other branches.
- [ ] Confirm the Neon branch is still valid (expires
  `2026-11-16T12:00:00Z`). Never repurpose a Development or Production
  branch if it expires; create a new dedicated isolated branch with a
  separate approval and pinned URL.
- [ ] Operational owner and independent reviewer explicitly approve the
  time-bounded risk of MAINTAIN (not just USAGE) and evaluate function
  invocation, role memberships, owner and signature-key surfaces.
- [ ] Create a **separate dedicated protected GitHub environment** for the
  disposable lease operator, with allowlisted exact branch and SHA,
  admin credentials independent from the export reader, and short TTL.
  Never expose Development/Production operator secrets to PR code.
- [ ] Before first COMMIT, test RLS A/B with representative synthetic data,
  record the role attributes and a schema/table/sequence/view privilege
  manifest, and establish an independently executed REVOKE recovery path.
- [ ] Validate live schema-only pg_dump via direct TLS verify-full and
  PostgreSQL 18, inspect TOC for data and dependencies, record SHA256
  without publishing archive or secret, check role still lacks SELECT.
- [ ] Revoke the temporary grants in a separate independently approved
  session and prove 0 USAGE/MAINTAIN/SELECT after COMMIT. Fail closed if
  any authorization remains, including inherited grants.
- [ ] Independent review of the evidence and **separate formal approval**
  for real full-data backup, role graph parity and isolated DDL restore.

The existing independent emergency revoker
`.github/scripts/iam-export-lease-emergency-revoke.py` is **pinned to
Development**, not the disposable branch. It must **NOT** be reused with
changed connection parameters. The branch-only approval packet needs its
own independently reviewed revoker and verified test run.

## Rollback and status

This synthetic workflow never changes the Neon branch. There is nothing
to revoke on Neon from running the synthetic test. If the CI fails,
the container is deleted by an EXIT trap and no privileges persist.

- Synthetic PostgreSQL18 schema-only export: **PASS** when the workflow
  and log show `PASS_G1_SYNTHETIC_FINAL`.
- Neon authenticated schema-only export: **BLOCKED** with
  `PG_DUMP_SCHEMA_USAGE_DENIED`; no grants made.
- Neon role/membership parity: **BLOCKED**.
- `iam_canonical_validation` full-data restore and ledger: **BLOCKED**.
- GitHub `main`, PR #41, Neon Production and Vercel Production: untouched.

**References:** PostgreSQL 18
[LOCK](https://www.postgresql.org/docs/18/sql-lock.html),
[Privileges](https://www.postgresql.org/docs/18/ddl-priv.html) and
[pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html).
