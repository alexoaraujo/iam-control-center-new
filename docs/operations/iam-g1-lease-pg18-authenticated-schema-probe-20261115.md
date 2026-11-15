# IAM G1 — schema-only PG18 on disposable Neon branch (2026-11-15)

> **Operational gate — NOT release authorization.** PostgreSQL roles are branch-wide
> in Neon; a GRANT/ALTER ROLE on the recovery branch also affects its inherited
> `iam_database`. This proposal must not mutate Development or Production.

## Branch and connection allowlist

- Neon project: `tiny-rice-70320263`, region `aws-sa-east-1`, PostgreSQL 18.
- Disposable lease: `br-spring-grass-b6gap6kp`, endpoint
  `ep-sparkling-sea-b6iw0z9y.c-2.sa-east-1.aws.neon.tech:5432` (direct).
- Database: `iam_database`, role: `iam_schema_export_reader`.
- TLS: `sslmode=verify-full&sslrootcert=system`; no pooler, no admin URL.
- Branch TTL: `2026-11-16T12:00:00Z`; verify again before dispatch.
- Restore branch: `br-sweet-union-b6j80a7j`, target **empty** database
  `iam_canonical_validation`; never mistake the inherited `iam_database`
  on this branch for a completed restore.

## Execution with explicitly approved exact SHA

Workflow: `.github/workflows/iam-g1-lease-schema-probe.yml`.

1. Independent review of the workflow and the exact commit SHA.
2. In GitHub protected environment `IAM-Canonical-Isolated-Restore`, approve
   the **explicit audit branch**, without opening environments to arbitrary PRs.
3. Set environment variable `IAM_G1_LEASE_APPROVED_SHA` to the reviewed
   40-character SHA, not an old SHA or `main` baseline.
4. Set environment **secret** `IAM_EXPORT_LEASE_DATABASE_URL` to the dedicated
   disposable-branch direct URL for `iam_schema_export_reader`, including
   `sslmode=verify-full&sslrootcert=system`. **Never place this URL in the
   repository, PR comments, logs or ChatGPT.** Do not substitute
   `IAM_CANONICAL_SOURCE_URL` because it points to Development.
5. Run only the reviewed workflow's schema-only probe. It verifies identity,
   **zero existing SELECT, MAINTAIN and USAGE privileges**, then attempts the
   **real** PostgreSQL 18 `pg_dump -w --schema-only --format=custom` with
   `--schema=iam --schema=audit --schema=app_private`. Archive stays on ephemeral
   runner filesystem and is deleted; only digest/size/TOC summary is printed
   when the command actually succeeds. A permissions error is **BLOCKED**, not PASS.
6. Never infer from an offline PASS that a live `pg_dump` ran. On any failure
   preserve `iam_database`, `iam_canonical_validation`, secrets, roles and
   existing PR approvals; investigate the annotated job outcome.

**Actual execution evidence on initial push (run 43706898906):**
`offline-contracts=SUCCESS` (8/8 unit tests); `authenticated-schema-probe=FAILURE`
before usable PostgreSQL job logs, so there is **no observed pg_dump outcome**.
Protected environment admission, SHA approval and dedicated credential availability
must be independently checked; the exact failure cause was not established.

## Role membership contract: audit executed read-only

SQL: `database/scripts/iam-g1-role-parity-readonly.sql` executed with
`Neon.run_sql` on all three environments:

| Check | Development | Lease | Recovery branch |
| --- | --- | --- | --- |
| Canonical role errors | 2 | 2 | 1 |
| Canonical membership errors | 3 | 3 | 1 |
| Unexpected IAM membership errors | 0 | 0 | 0 |
| Canonical role/membership PASS | NO | NO | NO |

Development and disposable lease are missing `iam_migrator_login` and
`iam_worker_login` plus memberships `iam_migrator→iam_owner`,
`iam_migrator_login→iam_migrator`, `iam_worker_login→iam_worker`.
Recovery has `iam_app_runtime_login.rolinherit=false` (must be true)
and `iam_app_runtime_login→iam_app_runtime` `SET=true` (must be false).

Do **not** promote the recovery graph into Development or loosen the canonical
contract. Do **not** make the recovery branch's export reader LOGIN just to
force superficial equivalence: export-role login policy is purpose-specific.

### Remediation approval packet (NOT EXECUTED)

For **recovery disposable branch only**, independent operator approval is
required before changing `iam_app_runtime_login` to `INHERIT` and
replacing its membership with `ADMIN=false, INHERIT=true, SET=false`.
These are **cluster roles scoped to the Neon branch**, not database-only
objects. A reviewed rollback must restore the exact previous role attributes
and membership options, with post-COMMIT verification from separate sessions.

For **Development**, a **separate** authorization and recovery point are
required before creating/provisioning the two missing LOGIN roles and three
canonical memberships. Role creation without a password does not prove
external authentication. Do not do this to force parity in the absence of
RLS A/B and permission-revocation tests.

`MAINTAIN` is a maintenance privilege; it is not general permission to
dump application data. Do not grant it by default. `SELECT` and
`BYPASSRLS` are also forbidden without a separately approved backup identity
and tenant/RLS access proof.

## Real full restore remains a separate gate

A `pg_dump --schema-only` archive contains **no business data** and
`--schema=iam/audit/app_private` may omit extension dependencies in
`public`. It **cannot** alone satisfy
`FULL_BACKUP_AND_RESTORE=PASS`. Before doing any restore to
`iam_canonical_validation`, verify encrypted full schema+data provenance,
manifest, checksum, approved data-reading identity, pgcrypto dependency,
ACL role graph, real ledger and signed RLS A/B, cross-tenant, rollback evidence.
The target must be preflighted empty and the artifact independently inspected.
Explicit approval for the **full data backup and the isolated DDL** is required.

Keep `main`, PR #41 SHA `4bbba5b7e2000614d2b4106da89489b0e0b2b125`,
Neon Production and Vercel Production unchanged. No cutover.

## References

- PostgreSQL 18: https://www.postgresql.org/docs/18/app-pgdump.html
- PostgreSQL role membership: https://www.postgresql.org/docs/18/role-membership.html
- PostgreSQL SQL dump: https://www.postgresql.org/docs/18/backup-dump.html
