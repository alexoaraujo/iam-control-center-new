# Contrato operacional de migrations PostgreSQL

**Status:** contrato documentado; validação CI adicionada e aguardando execução no novo HEAD.
**Fonte canônica:** Neon twilight-fire-88497009 / branch br-little-fire-b6adup9f / database iam_database.
**Engine de teste:** PostgreSQL 18 descartável.
**Limite:** nenhuma instrução deste documento autoriza DDL, GRANT ou migration em Neon persistente ou Production.

## Modelo de principal e privilégio

| Principal | LOGIN | INHERIT | Responsabilidade |
|---|---:|---:|---|
| iam_migrator_login | Sim | Não | Identidade autenticada da conexão de migration |
| iam_migrator | Não | Não | Capacidade intermediária de migration; não é credencial |
| iam_owner | Não | Não | Owner de schemas/objetos IAM |
| iam_app_runtime_login | Sim | Não | Conexão de aplicação |
| iam_app_runtime | Não | Sim | Grupo de privilégios mínimos do runtime |
| iam_worker | Não | Sim | Principal de worker; fora do escopo de grants de migration |

A cadeia de migration é estritamente:
1. iam_migrator_login → iam_migrator: INHERIT FALSE / SET TRUE / ADMIN FALSE.
2. iam_migrator → iam_owner: INHERIT FALSE / SET TRUE / ADMIN FALSE.

A conexão inicia diretamente como iam_migrator_login; o preflight valida session_user, current_user, atributos administrativos e memberships antes de qualquer SET ROLE ou DDL. O login não herda privilégios de iam_owner; a capacidade de assumir o owner é explícita e transitiva. Nenhum principal IAM deve receber SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB ou REPLICATION.

### Memberships gerenciadas pelo Neon

O catálogo da fonte registra arestas provider-managed em que iam_database_owner é membro de roles IAM, concedidas por cloud_admin com ADMIN OPTION, sem INHERIT e sem SET. Para iam_owner, também foi observada uma aresta SET TRUE / INHERIT FALSE / ADMIN FALSE concedida pelo próprio iam_database_owner. Essas associações não são grants a runtime/login e não devem ser revogadas como parte do hardening.

O preflight da migration aceita somente as arestas exatas do database owner real e rejeita grantees inesperados. Não se deve presumir que o database owner do provedor é um principal IAM nem que seu nome é fixo entre projetos.

## Contrato do advisory lock

iam.acquire_migration_lock():
- é SECURITY DEFINER, owner iam_owner;
- usa search_path = pg_catalog;
- recebe EXECUTE de iam_migrator e iam_owner, sem PUBLIC;
- executa pg_advisory_xact_lock(721347, 18001);
- mantém o lock até o fim da transação que executou a função.

O runner CI deve provar contenção real, não apenas invocar a função: sessão A inicia transação, assume iam_migrator, adquire o lock e mantém a transação aberta; sessão B tenta adquirir o mesmo lock e só deve prosseguir depois do COMMIT de A. O teste não deve usar pg_advisory_unlock porque o lock é transacional.

## Contrato do ledger

iam.record_migration(text,text,text):
- é SECURITY DEFINER, owner iam_owner;
- usa search_path = pg_catalog, iam;
- recebe EXECUTE de iam_migrator e iam_owner, sem PUBLIC;
- valida formato do identificador, SHA-256 e source SHA;
- mesmo identificador + mesmo checksum é idempotente;
- mesmo identificador + checksum diferente deve abortar;
- grava session_user como principal executor, sem conceder DML direto no ledger ao login/migrator.

O teste CI deve demonstrar duas chamadas idênticas gerando uma única linha, checksum divergente sendo rejeitado e rollback removendo a linha sintética de teste.

## Privilégios observados na fonte (consulta read-only)

Snapshot consultado em 2026-11-08:

| Capacidade | iam_migrator |
|---|---:|
| USAGE em schema iam | true |
| SELECT em iam.schema_migrations | true |
| INSERT em iam.schema_migrations | false |
| EXECUTE iam.acquire_migration_lock() | true |
| EXECUTE iam.record_migration(text,text,text) | true |

As duas funções são SECURITY DEFINER e têm ACL explícita para iam_migrator e iam_owner, sem EXECUTE para PUBLIC. O login iam_migrator_login não herda privilégios de owner; ele usa a cadeia SET-only. Não conceder INSERT/UPDATE/DELETE direto no ledger nem privilégios em audit ou app_private por conveniência.

O ledger observado na fonte contém 0001_context_key_hardening, checksum 2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab, source SHA b80c98c51746e1d49039015eb649b9bdd735ef7f, execution role iam_migrator_login. Esse registro é evidência histórica do estado da fonte, não prova de que o HEAD atual da PR corresponde ao checksum registrado.

## Camadas de teste obrigatórias

1. **Bootstrap inicial limpo:** aplicar 0001_initial_iam_schema.sql em database vazia separada; validar ownership, roles, RLS/FORCE RLS, default-deny, integridade cross-tenant e integridade de ator/audit.
2. **Migration incremental:** preparar somente a fixture operacional mínima explicitamente declarada e aplicar 0001_context_key_hardening.sql por sessão autenticada iam_migrator_login.
3. **Preflight negativo:** rejeitar atributos administrativos e memberships adicionais antes de DDL; após cada rejeição, confirmar ausência do índice e do ledger entry.
4. **Concorrência:** duas sessões reais concorrendo pelo advisory transaction lock; a segunda deve bloquear até o COMMIT da primeira.
5. **Ledger:** idempotência, checksum mismatch, formato inválido e rollback.
6. **Baseline integral:** restaurar iam_database_schema.sql em PostgreSQL 18 descartável e verificar contagens, ownership, ACLs, extensões e ausência de dados.
7. **Isolamento tenant:** testes dinâmicos com tenants A/B, identidades/memberships sintéticas e roles reais; FORCE RLS/catalog counts não substituem os testes de acesso.
8. **Rollback operacional:** provar apenas em ambiente descartável. Não executar rollback experimental no Neon persistente.

## Evidências e limites atuais

- Neon main foi consultado somente por catálogo/SELECT.
- PostgreSQL 18 CI passou anteriormente para os contratos de role e migration no SHA 71c17ae648521b3f3b5d73689e756e981f6f9bfd; esse resultado não cobre os testes adicionais que acabam de ser incluídos.
- O restore integral do dump passou em PostgreSQL 18 descartável no SHA 50c0e71fa166158a80172dc9b27175982e439b22; não comprova igualdade objeto-a-objeto com a fonte Neon.
- Os testes independentes de bootstrap inicial, contenção concorrente do lock e ledger idempotence/mismatch foram adicionados à PR #85 e aguardam execução CI no novo SHA.
- Preview e Auth0 E2E foram SKIPPED nos workflows observados; não classificá-los como PASS.
- A sequência de migration continua bloqueada até reconciliar a migration inicial de revisão com a baseline operacional completa da PR #86.