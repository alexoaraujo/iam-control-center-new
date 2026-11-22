# PEOS G1 — atestado de restauração isolada B2/Neon (22/11/2026)

**Veredito estritamente limitado:** `PASS_G1_B2_FULL_RESTORE_ISOLATED_DISPOSABLE`. Este documento registra evidência operacional observada e aprovação do **gate de restauração isolada G1**, não aprovação independente para novas execuções privilegiadas, migrações, cutover ou Production.

## Cadeia de evidência imutável

- Repositório: `alexoaraujo/iam-control-center-new`.
- Executável confiável integrado em `main`: `cf632b30b402e08b475a0bb6585221e97133b0f4`, preservado como referência exata; `main` ainda apontava para este SHA no readback de 22/11/2026.
- [Workflow manual #45060036018](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/45060036018): `completed/success`, primeira tentativa, 22/11/2026 19:18:51Z–19:22:21Z.
- Jobs comprovados: `preflight-no-secrets` [#137323695139](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/45060036018/job/137323695139); `stage-encrypted-ciphertext` [#137323768968](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/45060036018/job/137323768968); `restore-and-audit-isolated-only` [#137323848691](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/45060036018/job/137323848691): todos `success`.
- Checks no SHA de `main`: `quality`, `pg18-security-contracts` e `g1-real-restore-offline-contract` com `success`; eventos de escopo não aplicável podem ter resultado `skipped`, que **não** conta como `success` de Auth0/Preview/security-gate.
- Artifact `iam-g1-ciphertext-45060036018`, id `14769151981`, ciphertext apenas, retenção de um dia. Sem plaintext, segredos AES ou URL de conexão neste documento.

## Evidência de execução real, não sintética

O job de restore registrou os seguintes marcadores após executar o executor integrado no SHA acima:

1. `PASS_G1_RESTORE_ACTUAL_AES256_GCM_TAG_VERIFIED_BEFORE_DDL`.
2. `PASS_G1_RESTORE_EXACT_EMPTY_DISPOSABLE_DB_AND_PG18_TLS`.
3. `PASS_G1_RESTORE_AUTHENTICATED_PG18_TOC_AND_TABLE_DATA`.
4. `PASS_G1_RESTORE_NEON_PROVIDER_DEFAULT_ACL_UNCHANGED`.
5. `PASS_G1_RESTORE_23_TABLES_41_POLICIES_20_FORCED_RLS_LEDGER_OWNER_ACL_ROWS`.
6. `PASS_G1_RESTORE_COMMITTED_DDL_ROLLBACK_DRILL` (**nome histórico incorreto**: a rotina executou `BEGIN + DDL/DML + ROLLBACK`, sem commit; tratar como ensaio de rollback **transacional**, não prova de recuperação pós-COMMIT).
7. `PASS_G1_RESTORE_ISOLATED_DATABASE_CLEANUP_ZERO_RESIDUE`.
8. `PASS_G1_FULL_B2_ARCHIVE_RESTORED_AUDITED_AND_REMOVED_ISOLATED`.

O SHA do backup cifrado aprovado e os identificadores da origem continuam registrados no [contrato anterior](./iam-g1-real-isolated-restore-20261122.md). **Não editar ou substituir os logs imutáveis nem os marcadores do run histórico.**

## Limites, lease e limpeza conferidos

- Projeto Neon: `tiny-rice-70320263`; clone descartável `validation/iam-g1-full-restore-20261122`, `br-floral-glitter-b6zvytjp`; parent `br-ancient-term-b6mmx5ol` (Development).
- O banco de restauração `iam_g1_restore_validation` foi removido e não aparece no `pg_database` do clone (consulta somente leitura em 22/11/2026); `iam_database` e `neondb` continuam presentes.
- Branch descartável permanece `ready`; expiração Neon `2026-11-27T12:00:00Z`. **A lease não foi encerrada e a branch não foi removida**; futuras operações devem revalidar TTL e margem mínima de 24h.
- O ledger `iam.schema_migrations` da database herdada contém **0 linhas** e usa as colunas `migration_id, checksum_sha256, source_sha, applied_at, execution_role`. A comparação de schema/ledger atesta paridade do clone com o backup, mas **não prova cadeia histórica de migrations**. Fonte de lineage `database/migrations/lineage-policy.json` mantém `execution_authorized=false`.
- Restore de database **não** reproduz automaticamente roles globais do cluster. Não interpretar verificação `BYPASSRLS=0` nas roles IAM como prova funcional grant/revoke com identidades reais.

## Gates separados, ainda obrigatórios

- Corrigir apenas a nomenclatura `COMMITTED_DDL_ROLLBACK_DRILL` em PR isolada; preservar este documento como referência ao texto **literal** do run já executado.
- Validar a proveniência do ledger sem backfill, escrita ou inferência histórica; reconciliar migrations candidatas com baseline aprovada.
- Validar o RBAC/RLS funcional com login runtime efetivo, tenants A/B, Auth0 grant→HTTP 200/revoke→HTTP 403 e limpeza, em fixture separada autorizada; jobs `skipped` não satisfazem o gate.
- Ensaiar, em gate futuro separado, recuperação **pós-COMMIT** e inventário de roles/globals com aprovação e escopo próprios.
- **Production, cutover e qualquer nova restauração privilegiada: HOLD** até novos SHA, TTL, aprovação operacional, evidência no ambiente protegido e checks específicos.

Registro auditável e append-only de fato: a evidência operacional primária é o run GitHub imutável, não uma declaração de PR. Nenhum DDL, credential write, merge ou alteração em Development/Production decorre deste adendo.
