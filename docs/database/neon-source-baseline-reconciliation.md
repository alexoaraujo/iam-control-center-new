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
