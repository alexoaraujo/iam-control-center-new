# PEOS G1 — Post-COMMIT export lease revocation: synthetic PostgreSQL 18 gate

**Status:** simulation only. No restoration, rollback, privilege change, DDL, `pg_dump` or cutover was executed on Neon by this test. Never run the synthetic script against Neon.

## Context and constraints

- Authorized project: Neon `tiny-rice-70320263` (`iam-database-delivery`).
- Source reference: NEW Development `br-ancient-term-b6mmx5ol`, `iam_database`, direct role `iam_schema_export_reader`.
- Restore destination: `br-sweet-union-b6j80a7j`, database **`iam_canonical_validation`**, not the inherited `iam_database`. Restore branch expires `2026-11-20T09:12:00Z`.
- Source roles and destination role graph differ branch-wide; SOURCE reader has `MAINTAIN=0/23`, `USAGE=0/3`, no DML or BYPASSRLS. Source and target ledgers hold 0 rows. Do not copy role options from target to source.
- Protected environment `IAM-Canonical-Isolated-Restore` has independent reviewer, no self-review, no admin bypass, main-only, three existing secrets; [`auth_only` success on main](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43644664122), `NO_DDL`.
- Neon Free has at most **10 branches/project**, with 9 currently enumerated. Root-only Neon instant restore and snapshot restrictions do not constitute rollback protection for child branches. Six-hour history is not a verified backup.
- Existing [Neon isolated transactional rehearsal](iam-export-lease-neon-isolated-rehearsal-20261113.md) proved **SAVEPOINT rollback** on clone `br-spring-grass-b6gap6kp`; [PG18 schema-only maintain CI](../../database/tests/pg18-schema-only-maintain-ci.sh) tested a single table. Neither establishes post-COMMIT recovery or real production authorization.

## New independent CI rehearsal

`database/tests/pg18-role-lease-postcommit-revocation-ci.sh` executes only on an authenticated local disposable PostgreSQL **18** service where `current_user=postgres` and `current_database=iam_source_restore_test`. No Neon API key, GitHub protected environment or real IAM credentials are passed.

1. Create **only synthetic** principals `peos_g1_export_reader`, `peos_g1_runtime_login`, `peos_g1_runtime`, and **23 synthetic tables** across three fresh synthetic schemas; stop on any collision.
2. Fingerprint exact initial role flags, membership `ADMIN/INHERIT/SET`, permissions `MAINTAIN/SELECT/DML/USAGE/CREATE`, and reader memberships from PostgreSQL catalogs.
3. **Commit** the lease: grant `USAGE` on three schemas and `MAINTAIN` on 23 tables, and simulate the canonical runtime role flags, with `BYPASSRLS=false` and no data privileges.
4. Use a **separate connection** after the COMMIT to verify `MAINTAIN=23/23`, `USAGE=3/3`, no SELECT/DML/CREATE, and canonical `SET=false`. Also require a negative actual SELECT under the reader and an actual denied `SET ROLE` under the runtime login.
5. Commit inverse `REVOKE` and restore the synthetic runtime role flags/membership in a **new connection**; inspect in yet another independent connection and compare the complete observed fingerprint byte-for-byte with the baseline.
6. Fail closed if the inverse is incomplete; cleanup synthetic schemas and roles in a separate transaction and verify no synthetic artifacts remain. All plaintext output is sanitized and contains only synthetic gate markers.

The script is invoked by the existing `postgres-18-source-schema-restore` job in `.github/workflows/database-tests.yml`. A successful CI run is **synthetic proof of technical reversibility**, not a backup, real branch restore, cross-tenant test or authorization to grant `MAINTAIN` in Development. The script must not be run against live databases or via a different DATABASE_URL.

## Operational exit criteria — fail closed

| Gate | Evidence required | Current |
| --- | --- | --- |
| Real `auth_only` TLS/role on protected main | Workflow proof on exact SHA | PASS on historical main |
| Synthetic post-COMMIT inverse | PostgreSQL 18 job and independent sessions | CI pending until job completes |
| Direct/verified source export reader | NOBYPASSRLS, no DML, fixed direct host | Reader exists, 0/23 MAINTAIN |
| Role recovery point | Immutable `pg_dumpall --globals-only`/owner/ACL inventory and independently restorable point, with secrets omitted | BLOCKED |
| Rehearsal in isolated clone | Approved role-change plan, verified reversion in fresh sessions, comparison with pre-change manifest | BLOCKED |
| Lease kill switch for Development | Independent revoker with permissions, timeout, `always()` cleanup, after-COMMIT revalidation | BLOCKED |
| Real PostgreSQL schema-only export | Reviewed `readiness_only` on exact SHA, protected approval, schema archive/hash | BLOCKED |
| Restore & rollback | Verified recovery of actual data/schema/roles in isolated environment | BLOCKED |
| Merge/cutover | Release SHA, `quality` + `security-gate`, human release approval | BLOCKED |

**No free-plan workarounds:** do not snapshot a child branch or create another clone to pretend rollback is proved. Neon [history-window](https://neon.com/docs/guides/backup-restore/history-window) and [instant restore](https://neon.com/docs/guides/branch-restore) apply to root-branch recovery and are bounded by retention. No changes to the root Production branch are permitted for G1 rehearsal.

**PEOS:** execute → verify → correct → test → review → validate → advance only after evidence. The next live step needs a reviewed recovery method independent of the changed branch and explicit authorization for grants/role mutations. This PR does not request that authorization.

## Complemento — backup/restauração independente de dados sintéticos

`database/tests/pg18-g1-independent-recovery-ci.sh` cria uma role e um schema de teste no mesmo servidor PostgreSQL 18 descartável do CI, **exclusivamente com registros sintéticos**, e grava um archive custom do schema/tabela, além de um inventário `pg_dumpall --globals-only --no-role-passwords` armazenado apenas no diretório temporário do job. O teste exige presença de TABLE DATA e POLICY no TOC, verifica que a role do ensaio é NOBYPASSRLS e que o dump global contém essa role. Nenhum arquivo é publicado como artifact nem colocado em commit.

Após o backup, uma alteração é confirmada com `COMMIT` na tabela sintética de origem. A recuperação ocorre em um **database de teste diferente** (`peos_g1_recovery_verify`) por `pg_restore --single-transaction --exit-on-error`, usando conexão independente. O teste compara o hash de dados da restauração com o baseline anterior à alteração, verifica a RLS policy, `FORCE RLS`, os ACLs de schema/tabela e o atributo `NOBYPASSRLS`. Em falhas, o processo falha fechado e tenta remover o database, role e schema de teste, exigindo contagem final zero. A restauração não importa roles em outro cluster: o `pg_dumpall --globals-only` é **inventário**, não prova de restore de globals.

Mesmo após os dois scripts passarem, isso prova apenas o funcionamento sintético de `pg_dump`/`pg_restore` e dos mecanismos de revogação no serviço CI. **Não prova backup de dados reais, PITR Neon, restauração de globais em cluster independente ou rollback de branch real**; os gates G1 de Development permanecem bloqueados.
