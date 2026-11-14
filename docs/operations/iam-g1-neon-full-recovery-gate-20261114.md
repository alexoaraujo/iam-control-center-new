# PEOS G1 — Recuperação Neon autenticada, inventário e plano de operação controlada

**Data:** 2026-11-14. **Escopo:** `alexoaraujo/iam-control-center-new`, Neon `tiny-rice-70320263` (`iam-database-delivery`), PostgreSQL 18.  
**Estado:** **inventário PASS, lease sintético em Neon PASS, recuperação integral REAL BLOCKED**. Este documento **não autoriza GRANT/ALTER ROLE em Development, backup de dados pessoais, restore, merge ou cutover**. A revisão do código e a autorização operacional são gates diferentes.

## 1. Identidades de ambiente — lista fixa

| Papel | Branch | Banco | Regras |
| --- | --- | --- | --- |
| Origem | `development` / `br-ancient-term-b6mmx5ol` | `iam_database` | READBACK somente SELECT |
| Clone pré-validação | `validation/iam-g1-recovery-preflight-20261114` / `br-shy-night-b638k9e7` | `iam_database` | Ensaios exclusivamente sintéticos; expira `2026-11-15T23:00:00Z` |
| Branch de restauração | `validation/iam-canonical-restore-20261113` / `br-sweet-union-b6j80a7j` | **`iam_canonical_validation`** | Único banco admitido para restore isolado, sujeito a aprovação; expira `2026-11-20T09:12:00Z` |
| Banco herdado no destino | `br-sweet-union-b6j80a7j` | `iam_database` | **NUNCA** sobrescrever nem usar como destino de restore |
| Production | `production` / `br-muddy-snow-b63cepcv` | conforme ambiente | **Proibido** alterar neste gate |

Projeto: Neon Free `free_v3`, PostgreSQL 18, até 10 branches, **9 branches existentes** no readback, history retention **21600 s (6h)**, **0 snapshots** listados. Nenhuma destas facilidades constitui prova de backup integral recuperável da origem.

## 2. Inventário executado — evidência sem dados pessoais

O arquivo [`database/scripts/iam-g1-neon-catalog-readback.sql`](../../database/scripts/iam-g1-neon-catalog-readback.sql) contém apenas SELECT e consultas a catálogos. Foi executado diretamente contra a origem: **3 schemas** (`iam`, `audit`, `app_private`), **23 tabelas**, **41 policies**, **20 FORCE RLS**, **0 registros no ledger `iam.schema_migrations`**, **23 proprietários `iam_owner`**, **0 ACLs padrão explícitas**, extensões `pgcrypto` e `plpgsql`.

Origem: **6 roles IAM** (`iam_owner`, `iam_migrator`, `iam_worker`, `iam_app_runtime`, `iam_app_runtime_login`, `iam_schema_export_reader`), sem `iam_migrator_login` e `iam_worker_login`. Export reader: `LOGIN=true`, `BYPASSRLS=false`, `MAINTAIN=0/23`, `USAGE=0/3`, `SELECT=0/23`.

Destino herdado `iam_database`: mesma contagem estrutural **23/41/20**, ledger 0, mas **8 roles IAM**: `iam_migrator_login` e `iam_worker_login` presentes; export reader `LOGIN=false`; runtime login `INHERIT=false` e membership `SET=true` contra `INHERIT=true`, `SET=false` na origem. Não copiar automaticamente topologia do destino para origem. Banco permitido `iam_canonical_validation`: **0 schemas IAM, 0 tabelas IAM** no último readback.

O `neondb_owner` na origem tem `BYPASSRLS=true`; `iam_owner` e export reader têm `BYPASSRLS=false`. **Esta distinção exige controle especial para exportação de dados**: `pg_dump` normalmente desliga RLS para extrair todas as linhas; `--enable-row-security` pode criar dump parcial, inválido como backup integral. Consultar [PostgreSQL 18 — pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html). Não dar BYPASSRLS ao reader.

### Gate automatizado de prontidão — fail-closed

O novo [`database/scripts/iam-g1-neon-backup-readiness.sql`](../../database/scripts/iam-g1-neon-backup-readiness.sql) retorna **somente status/catálogo**, nunca linhas da aplicação. Foi executado na SOURCE e no banco herdado da TARGET:

| Teste | SOURCE Development | TARGET `iam_database` herdado |
| --- | --- | --- |
| PostgreSQL 18 | PASS | PASS |
| Contrato estrutural 23/41/20 + owner | PASS | PASS |
| Login roles + runtime `INHERIT/SET` canônicos | **BLOCKED** (2 LOGIN ausentes) | **BLOCKED** (`INHERIT/SET` drift) |
| Privilégios do reader `MAINTAIN=23/USAGE=3` sem SELECT | **BLOCKED** (0/0) | **BLOCKED** (reader `LOGIN=false`, 0/0) |
| Backup **integral** autenticado e restaurado | `NOT_EVALUATED_NO_ARCHIVE_OR_RESTORE` | `NOT_EVALUATED_NO_ARCHIVE_OR_RESTORE` |

Esta consulta **não** usa credenciais de exportação, não valida se o cliente `pg_dump` poderia contornar RLS e **não** concede qualquer autorização operacional.

## 3. Ensaio real no clone — escopo sintético, já executado

No clone `br-shy-night-b638k9e7` foi criado exclusivamente o schema `peos_g1_recovery_fixture_20261114` e a tabela `backup_probe`, com **uma linha fabricada**, SEM usar dados das tabelas IAM. Foram executados `GRANT MAINTAIN` na tabela sintética e `GRANT USAGE` no schema sintético para o reader existente da branch. Uma nova consulta **após COMMIT** comprovou `MAINTAIN=true`, `USAGE=true`, `SELECT=false` e o registro sintético. Em outra transação, `REVOKE MAINTAIN`, `REVOKE USAGE` e remoção **somente** do schema de fixture foram confirmados. Readback subsequente: **0 schemas fixture, 0 objetos fixture, 23 tabelas IAM, 41 policies, 20 FORCE RLS, ledger 0**.

**PASS limitado:** lease/rollback de *privilégios de fixture* real em Neon, após COMMIT. Não comprova restauração de dados de Development, ACL/ownership reais, ledger ou reversão de mudanças persistidas nas tabelas IAM.

## 4. Gate de backup integral de dados — BLOQUEADO, procedimento para revisão

**Não utilizar `IAM_CANONICAL_SOURCE_URL` como se fosse credencial de backup integral.** Ela corresponde ao export reader sem SELECT e sem BYPASSRLS; o workflow `iam-canonical-isolated-restore.yml` da `main` é de **schema-only** (arquivo `database/scripts/canonical-isolated-operation.py` declara *no application rows*). `auth_only` já passou no run [#43644664122](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43644664122), mas isso **não** comprova dump de dados.

### Contrato proposto de backup sensível, não executável antes dos gates

1. Aprovar separadamente a identidade privilegiada responsável por *backup completo*, observando que `neondb_owner` já possui BYPASSRLS e não deve ser reutilizado no runtime da aplicação. Concessões adicionais ao reader são proibidas; se for necessário usar uma credencial administrativa preexistente, seu uso deve ser temporário, auditável e protegido por revisor independente.
2. Provisionar **separadamente** um segredo para esse procedimento, em environment GitHub protegido com revisão independente, restrito à branch e ao SHA do procedimento. Exigir conexão PostgreSQL **direct**, banco `iam_database`, TLS `verify-full`, `sslrootcert=system`, host da source conferido por allowlist; sem credenciais em comandos visíveis, logs, issues ou commits. Não presumir que o novo segredo esteja configurado.
3. Backup offline protegido: `pg_dump` PostgreSQL 18 em formato `-Fc` das três schemas, incluindo **data**, além do inventário `pg_dumpall --globals-only --no-role-passwords`; ledger, ACLs, policies, roles, memberships, ownership, constraints, sequências e extensões em manifesto separado. Nunca restaurar automaticamente a totalidade de globals/roles gerenciadas do Neon; revisar e permitir somente principals IAM.
4. Criptografar o archive **antes** de qualquer upload externo; registrar SHA-256 da **versão criptografada**, hash de conteúdo/TOC em evidência privada e retenção/expiração. Nunca publicar dump ou manifesto com conteúdo pessoal em GitHub público ou Actions artifacts não criptografados.
5. Validar autenticidade e integridade por `pg_restore --list`, presença de entradas TABLE DATA pertinentes, `pg_dumpall` sem senhas, verificação de todas as 23 tabelas e prova de descriptografia **privada**. Inspecionar SQL restaurável de origem confiável; não executar dump arbitrário não revisado.
6. Confirmar que o backup é recuperável **no banco isolado e vazio `iam_canonical_validation`**, com verificação de contagens REAIS por tabela, hashes de fixtures não sensíveis, integridade de constraints, ACLs, FORCE RLS, políticas, ownership e 0 linhas de ledger **apenas se** reconciliadas com a proveniência canônica do histórico. Ledger vazio **não** significa migrations reconciliadas.
7. Somente então considerar ponto de recuperação comprovado para executar lease no ambiente source. Exigir artefato externo independente que sobreviva à exclusão/perda da branch e simular rollback pós-COMMIT até obter paridade de catálogo/roles e dados. Se a restauração falhar, **parar**; não promover a branch nem tentar restore contra Production.

### Exemplos de operação restrita (NÃO executar pelo CI atual)

```bash
# Em runner protegido já autenticado por variáveis PGHOST/PGPORT/PGDATABASE/
# PGUSER/PGPASSWORD injetadas em segredo, sem set -x, sem URL no argv.
# Evidência privada e proteção do arquivo dependem de revisão formal.
umask 077
export PGSSLMODE=verify-full PGSSLROOTCERT=system
pg_dump --format=custom --lock-wait-timeout=10000 \
  --schema=iam --schema=audit --schema=app_private \
  --file="$SECURE_PRIVATE_DIR/iam-canonical-data-and-schema.dump"
pg_dumpall --globals-only --no-role-passwords \
  --file="$SECURE_PRIVATE_DIR/iam-globals-inventory.sql"
pg_restore --list "$SECURE_PRIVATE_DIR/iam-canonical-data-and-schema.dump" \
  >"$SECURE_PRIVATE_DIR/iam-archive-toc.txt"
# CRITICO: criptografar/selar antes de exportar do diretório privado;
# não salvar estes arquivos no repositório nem em artifact público.
```

Os comandos acima são **proposta para revisão**, não execução deste PR, e não podem ser usados com a identidade export reader. Antes de usar, validar privilégio efetivo para ler todas as linhas sem falhas RLS e garantir que dump/TOC/manifest não sejam publicados em logs.

## 5. Lease `MAINTAIN`/`USAGE` com privilégio mínimo — contrato

Conceder à identidade `iam_schema_export_reader` **somente se existir backup integral previamente restaurado e revisão operacional específica**:
- `USAGE` em `iam`, `audit`, `app_private`.
- `MAINTAIN` **nas 23 tabelas exatas do manifesto**; não usar `GRANT ALL`, `ALL TABLES` sem revisão de diff/objetos novos, `SELECT`, DML, `CREATE`, `BYPASSRLS`, `CREATEROLE`, memberships extras ou `ALTER ROLE`.
- O privilégio `MAINTAIN` permite manutenção de tabelas além de locks; limitar duração e risco. Exigir aprovação da listagem exata de objetos/SQL, controle de conexões, sessões novas de readback, prazo de revogação, operador independente e *kill switch* de `REVOKE` disponível fora do próprio job que concede.
- Revogar em transação independente após COMMIT, e verificar em nova sessão catálogo idêntico à baseline: reader `MAINTAIN=0/23`, `USAGE=0/3`, `SELECT/DML=0`, sem alterações inesperadas de ACL/roles/memberships.
- Se qualquer etapa falhar ou deixar grants residuais: **BLOCKED**, executar exclusivamente o revogador independente já auditado e inspecionar antes de retomar. Não forçar merge.

## 6. Gates e critérios de saída

| Gate | Evidência obrigatória | Estado |
| --- | --- | --- |
| G1.1 — inventário reproduzível | Roles, memberships, ownership, ACL, default ACL, ledger, 23/41/20 | **PASS** |
| G1.2 — lease em clone Neon após COMMIT | MAINTAIN/USAGE true, SELECT false, revogação e cleanup 0 | **PASS — sintético** |
| G1.3 — autenticação direta do reader, TLS | `auth_only` run #43644664122 | **PASS — histórico** |
| G1.4 — backup integral autenticado e selado | Arquivo real com schema + dados + globals/roles + hashes + custódia | **BLOCKED** |
| G1.5 — restore real isolado | 23 tabelas, dados/ACL/owners/ledger íntegros em `iam_canonical_validation` | **BLOCKED** |
| G1.6 — lease temporário sobre objetos reais | SQL allowlist, aprovação independente, revogação após COMMIT | **BLOCKED** |
| G1.7 — rollback real de dados/roles | Auditoria e recuperação verificada com readback independente | **BLOCKED** |
| G1.8 — revisão independente do procedimento | Review `APPROVED` no SHA exato + gates de ambiente e release | **PENDENTE** |
| G1.9 — merge/cutover Production | `security-gate` + release SHA + RBAC/HTTP + migrações + backup/rollback | **PROIBIDO** |

**PEOS:** Executar → Verificar → Corrigir → Testar → Revisar → Validar → Avançar. O próximo passo real é obter um mecanismo de backup integral com custódia e restauração independente demonstrada; sem isso, não atribuir PASS ao G1 Neon.
