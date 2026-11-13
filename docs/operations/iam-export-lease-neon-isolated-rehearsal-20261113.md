# IAM — exportação canônica com capacidade temporária: ensaio Neon isolado (13/11/2026)

**Estado PEOS:** `CLONE_TRANSACTIONAL_LEASE=PASS`, `ROLE_GRAPH_SIMULATION=PASS`, `SAVEPOINT_ROLLBACK=PASS`, `POST_ROLLBACK_CATALOG_PARITY=PASS`; **`SOURCE_PERMANENT_GRANT=NOT_AUTHORIZED`**, `PG_DUMP_REAL=NOT_RUN`, `RESTORE/CUTOVER=BLOCKED`.

Esta especificação documenta testes realizados **diretamente por meio do conector Neon**, sem credenciais nem dados pessoais no repositório. É uma proposta para revisão independente, **não** uma instrução para aplicar GRANT/ALTER ROLE em Development ou Production. Os comandos com efeito de privilégio foram executados somente dentro de transações revertidas na branch descartável. O modelo é compatível com PostgreSQL 18 e a política de evitar dependências pagas obrigatórias.

## 1. Escopo autorizado e isolamento comprovado

| Elemento | Identificador |
| --- | --- |
| GitHub main inspecionada | `alexoaraujo/iam-control-center-new`, `06f13cbd366141fc941cfb6037f14b2986cdd4b9` (PRs #60–#64 integradas, CI e database-schema-tests pós-merge SUCCESS) |
| Neon project | `tiny-rice-70320263` — não confundir com `twilight-fire-88497009` |
| Origem de referência (SOMENTE LEITURA) | `development/br-ancient-term-b6mmx5ol`, database `iam_database` |
| Clone criado para ensaios | `validation/iam-export-lease-rehearsal-20261113/br-spring-grass-b6gap6kp`, parent exato `br-ancient-term-b6mmx5ol` |
| TTL automático do clone | `2026-11-16T12:00:00Z`; computação 0,25 CU, sem modificação do período de suspensão padrão do plano |
| Target canônico existente (NÃO ALTERADO) | `validation/iam-canonical-restore-20261113/br-sweet-union-b6j80a7j`, database vazio `iam_canonical_validation`, TTL `2026-11-20T09:12:00Z` |
| Role exportadora real | `iam_schema_export_reader`, LOGIN / NOINHERIT / NOBYPASSRLS / sem memberships |

O clone é **copy-on-write** de Development, inclui dados existentes: não publicar seu URL/credentials, não copiar linhas e respeitar o TTL. O ensaio não usa Development como área de mutação e não toca Production, Auth0 ou Vercel.

O preflight no clone confirmou `current_database=iam_database`, `current_user=neondb_owner` no papel administrativo de ensaio, PostgreSQL `18.7`, 23 tabelas e a existência da tabela `iam.identities`; a role `iam_schema_export_reader` não possui BYPASSRLS. O `neondb_owner` administrativo jamais deve ser colocado no runtime ou na URL da exportação.

## 2. Resultados efetivamente executados — contrato de exportação

**Transação 1 — capacidade de lock temporária, integralmente revertida:**

1. Savepoint `peos_export_lease` e timeouts locais de lock/statement.
2. `GRANT USAGE` somente aos schemas `iam`, `audit` e `app_private`, para `iam_schema_export_reader`.
3. `GRANT MAINTAIN` somente às **23 tabelas regulares/particionadas explicitamente enumeradas** nesses schemas (sem `SELECT`/DML, sem default privileges, sem grants em sequências/views, sem BYPASSRLS).
4. Verificação via catálogos: `MAINTAIN=23/23`, `USAGE=3/3`, `SELECT/DML/REFERENCES/TRIGGER=0/23`.
5. Para testar efetivamente como o reader, atualizou-se **somente dentro do savepoint** a opção `SET` do vínculo administrativo `neondb_owner → iam_schema_export_reader`; a sessão usou `SET LOCAL ROLE iam_schema_export_reader` sem mudar a role persistente ou credenciais.
6. Sob a role exportadora: `LOCK TABLE iam.identities IN ACCESS SHARE MODE NOWAIT` **executou**; a tentativa de `SELECT count(*) FROM iam.identities` lançou `insufficient_privilege` e foi capturada como **negação esperada**, sem retornar linhas nem contagem de pessoas; `BYPASSRLS=false`.
7. `RESET ROLE` e `ROLLBACK TO SAVEPOINT peos_export_lease` **reverteram todos os grants e a alteração de membership**.
8. A transação e uma **segunda conexão independente** provaram `MAINTAIN=0/23`, `USAGE=0/3` e `neondb_owner → reader SET=false`.

**Observação:** não houve `pg_dump` autenticado real neste clone. O teste sintético PostgreSQL 18 da [PR #63](https://github.com/alexoaraujo/iam-control-center-new/pull/63) comprovou `pg_dump --schema-only` com `MAINTAIN` e sem `SELECT` em uma tabela artificial. Esses dois resultados são complementares, **não** evidência de dump completo das 23 tabelas IAM.

## 3. Grafo de roles — descoberta, simulação e rollback

**Constatação importante:** o contrato versionado em `database/bootstrap/0000_iam_roles.sql` e `role-security-harness/sql/00_fixture.sql` define:
- `iam_app_runtime_login`: **LOGIN, INHERIT=true**; `iam_app_runtime_login → iam_app_runtime` com **ADMIN=false, INHERIT=true, SET=false**;
- `iam_migrator_login`: **LOGIN, NOINHERIT**; `iam_migrator_login → iam_migrator` com **ADMIN=false, INHERIT=false, SET=true**;
- `iam_migrator → iam_owner`: **ADMIN=false, INHERIT=false, SET=true**, caminho administrativo de migração, nunca concedido ao runtime;
- `iam_worker_login`: extensão do contrato P0 representada pelo target: LOGIN, NOINHERIT, NOBYPASSRLS; `iam_worker_login → iam_worker`: ADMIN=false, INHERIT=true, SET=true, **sujeita à revisão de arquitetura**;
- `iam_schema_export_reader`: origem LOGIN sem memberships; target pode ter um placeholder **NOLOGIN**, que não deve ser confundido com o login da origem.

No Neon atual, o SOURCE tem runtime LOGIN `INHERIT=true`, membership SET=false e **não** possui `iam_migrator_login`, `iam_worker_login` ou `iam_migrator → iam_owner`. O TARGET tem os dois logins e o caminho do migrador, mas seu runtime LOGIN está `INHERIT=false` e o membership runtime usa `SET=true`: **copiar automaticamente o target para a origem violaria o bootstrap canônico**.

**Transação 2 — variante target-to-source, revertida:** a simulação reproduziu no clone os atributos/memberships do target e provou que seria possível criá-los; também mostrou que `rolinherit=false` não impediu herança runtime quando o `pg_auth_members.inherit_option=true`. A alteração `SET=true` ampliaria a capacidade de assumir a role de grupo. **Essa variante foi rejeitada como política final e integralmente revertida.**

**Transação 3 — topologia canônica, revertida:** sem modificar o runtime `INHERIT=true/SET=false`, criou-se de forma temporária `iam_migrator_login` e `iam_worker_login` **sem senhas** (`LOGIN/NOINHERIT/NOBYPASSRLS`), e as três memberships não administrativas `migrator→owner`, `migrator_login→migrator` e `worker_login→worker`. Comportamento observado:
- Runtime `pg_has_role(...,'iam_owner','SET')=false`.
- Migrator LOGIN **não herda** owner, mas pode `SET` para owner através da cadeia permitida. Essa é uma capacidade administrativa alta, não equivalente ao acesso comum de runtime.
- Runtime LOGIN preservou `INHERIT=true` e `SET=false`.
- Após `ROLLBACK TO SAVEPOINT`: **0 novos LOGINs**, **0 membership migrator→owner**, runtime `INHERIT=true/SET=false` preservado.

**Não houve criação persistente de LOGINs nem reconfiguração das roles de Development ou target.** O preflight `check_runtime_role_contract` antes desta proposta verificava apenas igualdade source/target; poderia retornar PASS para **duas configurações igualmente incorretas**. A PR associada exige agora a topologia canônica em **ambos** os lados antes do primeiro `pg_dump`.

## 4. Prova independente de ausência de deriva na origem

Após os ensaios, consultas SQL **somente leitura em sessões novas** confirmaram tanto SOURCE quanto clone com:
- `iam_schema_export_reader`: `MAINTAIN=0/23`, `USAGE=0/3`, sem membership adicional;
- nenhum `iam_migrator_login` nem `iam_worker_login`; `iam_app_runtime_login.rolinherit=true`, membership runtime `SET=false`, sem `iam_migrator→iam_owner`;
- contagem de **41 RLS policies** e **20 tabelas com FORCE RLS**;
- **fingerprint MD5 de catálogo idêntico**, `53be82958de7aebc4131c3190d4a31ce`, sobre **74 entradas** ordenadas de tabelas/owners/ACLs/flags RLS, schemas/ACLs, atributos IAM de roles, memberships cujo member é role IAM e policies dos três schemas.

Este MD5 é **comparação operacional de catálogo**, não manifesto SHA-256 assinado, nem substitui backup/restore/PITR. A igualdade após os savepoints e em conexão independente demonstra que **nenhuma remediação foi persistida** no clone ou SOURCE.

## 5. Avaliação de ameaça: MAINTAIN não é "lock-only"

| Risco | Controle necessário |
| --- | --- |
| MAINTAIN permite operações de manutenção, inclusive locks mais fortes e potencialmente disruptivos | Não conceder no runtime; identidade exportadora segregada, período muito curto, observabilidade, `lock_timeout`, `statement_timeout` e janela de manutenção |
| Reader autenticável já existe; conceder MAINTAIN diretamente cria janela de uso indevido da credencial | Environment protegido `IAM-Canonical-Isolated-Restore`, revisão independente, conexão Direct/TLS `verify-full`/CA system, acesso mínimo temporal e auditoria |
| Role de capacidade NOLOGIN via membership temporário parece atrativa | **Incompatível com o guard atual:** `check_source` exige `0` memberships no reader. Não criar exceção silenciosa; exigiria PR de segurança própria |
| Novo LOGIN migrator pode assumir `iam_owner` (alto privilégio) | Segregar secret/runner e sessão de migration; nunca atribuir esse caminho à role exportadora ou runtime |
| Branch ou database errado; roles são branch-wide | Conferir projeto ID, branch ID, database, host Direct e ambiente protected via control plane imediatamente antes da operação |
| Falha do runner após GRANT temporário, antes de REVOKE | Definir revogador independente e stop condition com alerta; sem prova deste kill-switch **não conceder MAINTAIN persistentemente em Development** |
| Schema-only dump não cobre dados, ledger, paridade de ACL/owner, funções, extensões ou PITR | Exigir fingerprint, manifesto/restauração isolada e checklist independente; `PG_DUMP_REAL` ainda bloqueado |

Consultas read-only dos catálogos não são acesso ao conteúdo das tabelas. Os ensaios de negativa de SELECT não fornecem por si mesmos testes HTTP de RBAC 200/403 ou RLS A/B com tenants.

## 6. Plano de aplicação futura, condicionado a gates

1. **GATE-G1 (concluído):** revisar fonte de verdade do bootstrap, source/target identities, práticas de MAINTAIN e executar concessão/rollback estritamente dentro de SAVEPOINT no clone.
2. **GATE-G2 (esta PR):** revisão independente do contrato canônico, cenários de parity-but-insecure, CI e testes de regressão. A PR não altera roles reais nem defaults de privileges.
3. **GATE-G3 (pendente):** decidir formalmente a correção de roles: o runtime do **target** deve ser avaliado à luz do bootstrap antes de qualquer correção na source; missing migrator/worker LOGINs da source devem seguir fluxo de provisionamento sem senha no repo, autorização separada e recuperação testada. Role login da exportadora **não** deve receber membership em owner/migrator.
4. **GATE-G4 (pendente):** aprovar plano de capacidade real e *kill-switch* independente: apenas `MAINTAIN` em 23 tabelas e `USAGE` em 3 schemas para `iam_schema_export_reader` durante o trabalho; capturar inventário pré/pós, job `always()` de cleanup e verificação fora do runner. **Não alterar esta role na source até obter aprovação específica**.
5. **GATE-G5 (pendente):** com roles/locks aprovados, repetir `readiness_only/NO_DDL` **real na main integrada e SHA exato**; sem PASS não invocar `export_only`, e sem export real/manifest/restore test não liberar `restore_isolated` nem cutover.
6. **GATE-G6 (pendente):** restauração em database `iam_canonical_validation`, ledger/checksums, funções/ACLs, RLS A/B, HTTP grant/revoke, rollback e backup/PITR ensaiados com aprovador independente.

**Stop conditions:** side effects fora do clone, operação executada por provider/admin role no runtime, permissões SELECT/DML/BYPASSRLS, membership exportadora diferente de vazio, fingerprint divergente, roles não canônicas, branch expirada, falha de cleanup, target fora do banco explicitamente aprovado. O clone deverá expirar automaticamente em 16/11/2026; deletar antecipadamente exige autorização específica e verificação de ausência de dependências.

**Referências:** [Issue #15](https://github.com/alexoaraujo/iam-control-center-new/issues/15); [PR #63](https://github.com/alexoaraujo/iam-control-center-new/pull/63); [PR #64](https://github.com/alexoaraujo/iam-control-center-new/pull/64); [Neon branching](https://neon.com/docs/introduction/branching); [PostgreSQL 18 GRANT](https://www.postgresql.org/docs/18/sql-grant.html) e [LOCK](https://www.postgresql.org/docs/18/sql-lock.html).
