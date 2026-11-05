# Reconciliação da baseline PostgreSQL com Neon

**Status:** IN PROGRESS — baseline de referência confirmada; export estrutural e reconciliação SQL ainda pendentes.  
**Repositório:** `alexoaraujo83/iam-control-center`  
**Branch desta documentação:** `chore/reconcile-neon-source-schema-baseline`  
**Base GitHub:** `main` em `ff71607948c9d02d90fc0b1b26931c573ab660f8`  
**Arquivo de bootstrap em main:** `database/migrations/0001_initial_iam_schema.sql`  
**Blob SHA observado:** `18ff99eade3a216df2396b564fe11de6482dc8d8`

## Decisão de fonte oficial

A decisão aprovada é usar o schema operacional de `iam-database-delivery / iam_database` como referência oficial para reconciliar a baseline do repositório IAM Control Center.

Identificação da fonte consultada (somente leitura):

- Neon project ID: `twilight-fire-88497009`
- Branch ID: `br-little-fire-b6adup9f` (branch principal do projeto consultado)
- Database: `iam_database`
- PostgreSQL: `18.6 (ac70818)`
- Região: `aws-sa-east-1`

Esta decisão define a fonte de verdade estrutural para a reconciliação. Não autoriza alterações na fonte, execução de migrations, cópia de dados, rotação de credenciais, nem alterações em Production.

## Inventário estrutural confirmado

Consulta ao catálogo PostgreSQL nos schemas `iam`, `audit` e `app_private`:

| Objeto | Quantidade |
|---|---:|
| Tabelas | 23 |
| Views | 1 |
| Policies RLS | 41 |
| Tabelas com RLS habilitado | 20 |
| Tabelas com FORCE ROW LEVEL SECURITY | 20 |
| Funções/procedures | 9 |
| Tipos ENUM | 7 |
| Triggers não internos | 12 |

### Tabelas

- `app_private.context_keys`
- `audit.events`
- `audit.outbox`
- `iam.access_policies`
- `iam.api_keys`
- `iam.group_memberships`
- `iam.group_roles`
- `iam.groups`
- `iam.idempotency_keys`
- `iam.identities`
- `iam.identity_providers`
- `iam.invitations`
- `iam.membership_roles`
- `iam.memberships`
- `iam.organizations`
- `iam.permissions`
- `iam.role_permissions`
- `iam.roles`
- `iam.schema_migrations`
- `iam.security_events`
- `iam.service_accounts`
- `iam.sessions`
- `iam.tenants`

View: `iam.v_effective_membership_permissions`.

As 41 policies foram inventariadas com comando, roles, expressão `USING` e `WITH CHECK`. A matriz de privilégios foi consultada com funções `has_schema_privilege`, `has_table_privilege` e `has_function_privilege` para as roles operacionais e de migração.

## Divergência da migration inicial versionada

O arquivo `database/migrations/0001_initial_iam_schema.sql` em `main` declara no cabeçalho:

- `REVIEW PROPOSAL`;
- banco limpo;
- sem extensões, seeds, policies ou grants de runtime;
- RLS sem policies como default-deny.

A proposta cria somente um subconjunto do modelo observado no Neon. Exemplos de objetos existentes na fonte e ausentes na proposta incluem:

- `app_private.context_keys`;
- `audit.outbox`;
- `iam.access_policies`;
- `iam.api_keys`;
- `iam.groups` e suas tabelas de associação;
- `iam.identity_providers`;
- `iam.idempotency_keys`;
- `iam.organizations`;
- `iam.security_events`;
- `iam.service_accounts`;
- `iam.sessions`;
- `iam.v_effective_membership_permissions`.

Portanto, a migration atual não pode ser tratada como reprodução fiel do schema operacional nem como baseline integral para testes RLS.

## Evidência relacionada ao hardening

A fonte consultada apresenta o índice parcial único `app_private.context_keys_one_active_idx`, válido e com predicado `(active IS TRUE)`, e a função `app_private.current_tenant_id()` com `SECURITY DEFINER` e `search_path` endurecido para `pg_catalog, app_private, iam`.

O ledger da fonte contém a migration `0001_context_key_hardening`, checksum SHA-256 `2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab`, source SHA `b80c98c51746e1d49039015eb649b9bdd735ef7f` e execution role `iam_migrator_login`.

Observação: a fonte e uma branch isolada anteriormente consultada apresentaram ledger idêntico. A origem temporal dessa igualdade não foi estabelecida. Este documento não atribui causa nem presume execução independente.

## Extração detalhada — rodada 1 (catálogo read-only)

Em 2026-11-05 foi executada uma extração adicional de metadados diretamente do catálogo PostgreSQL da mesma fonte. A consulta composta retornou parte do snapshot estrutural, mas a resposta foi truncada pelo limite de saída; portanto, esta rodada **não é classificada como export DDL integral**.

Evidências detalhadas obtidas em consultas menores:

- PostgreSQL 18.6; schemas `iam`, `audit` e `app_private` pertencem a `iam_owner`.
- 7 ENUMs: `api_key_status`, `audit_outcome`, `identity_status`, `invitation_status`, `membership_status`, `session_status` e `tenant_status`.
- View `iam.v_effective_membership_permissions`: owner `iam_owner`, opção `security_invoker=true`; delega a resolução para `iam.effective_permissions(id)`.
- Contagens confirmadas novamente: 23 relações tabulares, 20 com RLS, 20 com FORCE RLS, 41 policies e 12 triggers não internos.
- As ACLs de tabelas foram extraídas sem consultar linhas de dados. Foram observados privilégios distintos para `iam_app_runtime`, `iam_worker` e `iam_migrator`; a extração integral e a matriz efetiva por operação ainda precisam ser normalizadas.
- As 9 funções foram identificadas e suas definições obtidas em consulta separada. Entre elas há 6 funções `SECURITY DEFINER` nos schemas examinados.

### Achado de hardening: `iam.set_tenant_context(...)`

A função `iam.set_tenant_context(uuid, uuid, bigint, text, text)` é `SECURITY DEFINER`, pertence a `iam_owner` e atualmente declara:

```sql
SET search_path TO 'pg_catalog', 'app_private', 'iam', 'public'
```

Isso diverge do padrão de hardening já observado em `app_private.current_tenant_id()` e dos demais caminhos SECURITY DEFINER que restringem o `search_path`. A consulta de ACL também confirmou que `PUBLIC` tem apenas `USAGE` no schema `public` (sem `CREATE`), e que as roles `iam_owner`, `iam_migrator`, `iam_migrator_login`, `iam_app_runtime` e `iam_worker` consultadas não têm `CREATE` em `public`. Portanto, o achado é uma **divergência de hardening a corrigir/justificar**, não evidência isolada de exploração ou de escalada efetiva.

Ação de baseline: avaliar a definição pretendida e remover `public` do `search_path` dessa função em uma migration de reconciliação separada, depois de validar dependências e comportamento em PostgreSQL descartável. Nenhuma alteração foi aplicada na fonte.

## Extração estrutural por objeto — rodada 2 (2026-11-05)

A listagem e as consultas de catálogo foram divididas por objeto para evitar o truncamento da consulta composta anterior. O inventário confirmado nesta rodada é:

| Elemento | Quantidade |
|---|---:|
| Tabelas base | 23 |
| Views | 1 |
| Colunas nas tabelas/views | 182 |
| Constraints nas tabelas | 244 |
| Índices | 63 |
| Sequências | 3 |
| ENUMs | 7 |
| Triggers não internos | 12 |
| Policies RLS | 41 |

As 3 sequências pertencem a `audit.events`, `audit.outbox` e `iam.security_events`; todas têm owner `iam_owner`.

### Flags RLS confirmadas por relação

- 20 tabelas têm RLS habilitado e FORCE RLS.
- 3 tabelas não têm RLS: `app_private.context_keys`, `iam.permissions` e `iam.schema_migrations`.
- A view `iam.v_effective_membership_permissions` usa `security_invoker=true`.
- A presença de RLS/FORCE não prova isolamento correto por si só; as expressões das policies, grants, funções chamadas e testes com roles reais ainda precisam ser validados em fixture integral.

### Triggers identificados

- `audit.events`: `audit_events_no_truncate` e `audit_events_no_update`, ambos chamam `audit.reject_event_mutation()`.
- `iam.access_policies`, `iam.groups`, `iam.identities`, `iam.identity_providers`, `iam.memberships`, `iam.organizations`, `iam.roles`, `iam.service_accounts`, `iam.sessions` e `iam.tenants`: triggers `*_touch` que chamam `iam.touch_updated_at()`.

### Restrições sensíveis confirmadas por definição

- `iam.identity_providers` rejeita chaves de segredo em texto puro no JSON `configuration`.
- `iam.api_keys.key_hash` e `iam.invitations.token_hash` têm tamanho fixo de 32 bytes.
- `iam.idempotency_keys.request_hash` tem tamanho fixo de 32 bytes.
- `iam.sessions.token_fingerprint`, quando presente, tem tamanho fixo de 32 bytes.
- `app_private.context_keys.secret` exige ao menos 32 bytes. Somente a definição da coluna/constraint foi consultada; nenhum valor foi lido.

Esta rodada fornece inventário detalhado de colunas, defaults, constraints, índices e demais metadados. Ainda não é um artefato DDL canônico reproduzível: faltam consolidar todas as definições SQL em arquivo versionado, verificar owners/ACLs de todos os tipos/rotinas/objetos e validar a ordem de dependências em PostgreSQL descartável.

## Comparação nominal com `0001_initial_iam_schema.sql` — rodada 3

A migration em `main` foi inspecionada por leitura do blob SHA `18ff99eade3a216df2396b564fe11de6482dc8d8` (258 linhas). O parser estrutural do arquivo identificou:

- 3 schemas criados: `iam`, `audit`, `app_private`.
- 10 tabelas declaradas.
- 0 tipos ENUM, 0 funções, 0 triggers, 0 views e 0 policies declaradas.

As 10 tabelas da proposta têm nomes que também existem na fonte, mas isso não implica equivalência de estrutura: a definição de colunas, constraints, índices, tipos e defaults diverge em objetos como `iam.tenants`, `iam.identities`, `iam.memberships`, `iam.roles`, `iam.permissions`, `iam.invitations`, `audit.events` e `iam.schema_migrations`.

### Objetos da fonte ausentes na migration 0001

1. `app_private.context_keys`
2. `audit.outbox`
3. `iam.access_policies`
4. `iam.api_keys`
5. `iam.group_memberships`
6. `iam.group_roles`
7. `iam.groups`
8. `iam.idempotency_keys`
9. `iam.identity_providers`
10. `iam.organizations`
11. `iam.security_events`
12. `iam.service_accounts`
13. `iam.sessions`

Além das tabelas ausentes, faltam na proposta os 7 ENUMs, a view `iam.v_effective_membership_permissions`, as 9 funções/procedures, os 12 triggers, as 41 policies e os grants operacionais observados na fonte. Assim, a migration atual é uma proposta inicial reduzida, não um baseline operacional.

**Classificação da divergência:** estrutural e semântica, não apenas diferença de nomenclatura. Não é seguro “completar” a migration 0001 em lugar, pois ela pode ter sido aplicada em ambientes ou registrada em ledgers. A estratégia precisa preservar histórico e separar bootstrap de banco novo da reconciliação de instalações existentes.

### Revisão de segurança direcionada — `iam.set_tenant_context`

Consulta read-only adicional da definição completa confirmou:

- A função apenas define GUCs transacionais `iam.tenant_id`, `iam.identity_id`, `iam.expires_at`, `iam.nonce` e `iam.signature`, chama `app_private.current_tenant_id()` com schema qualificado e limpa o contexto antes de lançar `42501` quando a validação falha.
- Não foi observado SQL dinâmico nem referência a objetos de aplicação não qualificados no corpo; `set_config` é função de catálogo `pg_catalog`.
- ACL concede EXECUTE a `iam_app_runtime` e `iam_worker`, além de `iam_owner`.
- As policies tenant-scoped inspecionadas referenciam `app_private.current_tenant_id()`; não dependem diretamente de resolução de nomes via `public`.
- A função auxiliar `app_private.current_tenant_id()` mantém `search_path=pg_catalog, app_private, iam`.

**Refinamento da classificação:** o `public` no search_path de `iam.set_tenant_context` é desnecessário para o corpo atualmente observado e viola o padrão mínimo de hardening, mas não foi identificada, nesta revisão estática, uma referência não qualificada explorável. Manter como hardening pendente; a correção proposta é restringir o search_path após validar a assinatura/definição e testar comportamento e grants em branch descartável. Nenhuma alteração na fonte.

## Matriz de privilégios efetivos — rodada 4 (2026-11-05)

Consulta read-only via `has_schema_privilege`, `has_table_privilege` e `has_function_privilege`, sem consultar dados de aplicação.

### Roles

| Role | LOGIN | SUPERUSER | BYPASSRLS | INHERIT | CREATEDB/CREATEROLE |
|---|---:|---:|---:|---:|---:|
| `iam_app_runtime` | não | não | não | sim | não/não |
| `iam_worker` | não | não | não | sim | não/não |
| `iam_migrator` | não | não | não | não | não/não |
| `iam_migrator_login` | sim | não | não | não | não/não |
| `iam_owner` | não | não | não | não | não/não |

### Privilégios por schema

- `iam_app_runtime` e `iam_worker`: USAGE em `iam`, `audit` e `app_private`; sem CREATE.
- `iam_migrator`: USAGE apenas em `iam`; sem CREATE.
- As três schemas pertencem a `iam_owner`.

### Matriz de tabelas — resumo efetivo

- `iam_app_runtime`: SELECT nas tabelas IAM tenant-scoped; INSERT/UPDATE/DELETE somente nos objetos operacionais explicitamente concedidos (incluindo `access_policies`, `idempotency_keys`, `identity_providers`, `invitations`, `organizations`, `security_events`, `service_accounts`, `sessions`, `tenants`); INSERT/SELECT em `audit.events`; INSERT em `audit.outbox`; SELECT em `iam.permissions`.
- `iam_worker`: SELECT/INSERT/UPDATE em `audit.outbox`; SELECT em `iam.permissions`; nenhum acesso às tabelas de tenant fora desses objetos.
- `iam_migrator`: SELECT em `iam.schema_migrations`; sem DML direto nas tabelas de aplicação.
- Nenhuma dessas três roles tem acesso direto a `app_private.context_keys`.
- As 20 tabelas tenant-scoped mantêm RLS + FORCE RLS; privilégios SQL não substituem o filtro das policies.

### ACLs de funções — pontos de atenção

- `iam.acquire_migration_lock()` e `iam.record_migration(...)`: EXECUTE concedido a `iam_migrator`, não a runtime/worker/PUBLIC.
- `app_private.current_tenant_id()` e `iam.set_tenant_context(...)`: EXECUTE para runtime/worker; sem EXECUTE para PUBLIC.
- `iam.provision_membership(...)`: ACL observada apenas para `iam_owner`; runtime/worker não têm EXECUTE. Confirmar se o provisionamento é realizado por caminho privilegiado deliberado ou se há lacuna entre contrato de aplicação e grants.
- `iam.clear_tenant_context()` é SECURITY DEFINER e seu ACL contém `=X` (EXECUTE para PUBLIC). O corpo apenas limpa GUCs locais à transação; risco observado limitado, mas grant amplo é desnecessário e deve ser revisto.
- `iam.effective_permissions(uuid)` também possui EXECUTE para PUBLIC. O corpo exige membership ativa vinculada ao tenant do contexto validado; ainda assim, recomenda-se restringir PUBLIC e conceder apenas às roles consumidoras esperadas.
- Funções trigger `audit.reject_event_mutation()` e `iam.touch_updated_at()` têm ACL padrão (EXECUTE para PUBLIC), padrão PostgreSQL comum para trigger functions; não são endpoints SQL normais e devem permanecer vinculadas aos triggers previstos.

**Classificação:** inventário de privilégios efetivos concluído; duas concessões PUBLIC relevantes para revisão de least privilege (`clear_tenant_context`, `effective_permissions`) e uma possível lacuna de integração (`provision_membership`). Nenhuma alteração de ACL foi aplicada na fonte. Antes de corrigir, confirmar consumidores reais e testar grants/RLS em fixture descartável.

## Próximas etapas obrigatórias

1. Extrair DDL estrutural fiel e sem dados da fonte: schemas, tipos, sequências, tabelas, constraints, índices, view, funções, triggers, policies, grants, owners e configurações RLS.
2. Verificar dependências e ordenação de criação; não copiar valores de `app_private.context_keys`, tokens, hashes, payloads ou dados de negócio.
3. Comparar o DDL extraído com `0001_initial_iam_schema.sql` e produzir relatório objeto-a-objeto.
4. Definir a estratégia de versionamento da baseline. Não reescrever migrations já aplicadas; avaliar baseline nova para banco vazio versus migration de reconciliação para instalações existentes.
5. Gerar fixture descartável a partir da baseline reconciliada, com roles e grants controlados.
6. Executar testes cross-tenant de SELECT/INSERT/UPDATE/DELETE, `USING`, `WITH CHECK`, `FORCE RLS`, views, funções SECURITY DEFINER e privilégios efetivos.
7. Vincular os resultados ao SHA exato da branch e do fixture.

## Limites e segurança

- Coleta realizada por consultas de catálogo somente leitura.
- Nenhum dado de aplicação foi exportado.
- Nenhum segredo foi lido ou copiado.
- Nenhum DDL foi executado na fonte `iam_database`.
- Nenhuma alteração foi feita em Development, Preview, Production, Auth0 ou Vercel.
- Os testes anteriores de HMAC ocorreram em database isolada com fixture mínima; não constituem evidência de RLS ou isolamento cross-tenant integral.

## Estado dos gates

| Gate | Estado |
|---|---|
| Fonte oficial confirmada | PASS |
| Inventário estrutural agregado | PASS |
| Divergência bootstrap × fonte identificada | PASS |
| Extração detalhada parcial do catálogo | PASS (escopo parcial; saída composta truncada) |
| Export DDL integral sem dados | PENDING |
| Baseline reconciliada e versionada | PENDING |
| Fixture integral fiel à fonte | PENDING |
| Testes RLS cross-tenant | PENDING |
| Privilégios efetivos por role | PENDING |
| Revisão de segurança da baseline | PENDING |
| Aplicação em qualquer ambiente persistente | NOT AUTHORIZED |

**Regra:** não declarar PASS para RLS, isolamento multi-tenant ou baseline integral até haver execução reproduzível em PostgreSQL descartável, vinculada ao SHA atual.
