# Neon — baseline canônico e reconciliação de evidências

Status: **evidência read-only; nenhuma alteração de banco autorizada ou executada**  
Data da verificação: 2026-11-02  
Escopo: IAM Control Center — projeto Neon canônico `control-center`.

## 1. Identificadores canônicos

| Item | Valor |
|---|---|
| Projeto Neon | `control-center` |
| Project ID | `wandering-wildflower-90908845` |
| Database | `Iam-control-center` (case-sensitive) |
| Production | `br-dry-mouse-b4gyjp04` |
| Development | `br-nameless-wave-b49yqod7` |
| Preview | `br-broad-base-b4gnjmg5` |
| PostgreSQL | 18.6 |

Não utilizar como alvo deste projeto os identificadores históricos `floral-surf-85783683`, database `iam_control_center` ou branch IDs antigos mencionados em documentos anteriores. Esses dados pertencem a uma configuração anterior e não descrevem o projeto canônico atual.

## 2. Estado das branches

Consulta Neon `list_branches`, em 2026-11-02:

| Branch | ID | Estado | Parent | Default | Protected |
|---|---|---|---|---:|---:|
| production | `br-dry-mouse-b4gyjp04` | ready | — | sim | não |
| development | `br-nameless-wave-b49yqod7` | ready | production | não | não |
| preview | `br-broad-base-b4gnjmg5` | ready | production | não | não |

As três branches estavam `ready`. Nenhuma alteração de proteção foi realizada. A proteção das branches permanece pendente de decisão e configuração revisável.

## 3. Evidência SQL read-only repetida nas três branches

Consulta executada em Production, Development e Preview no database `Iam-control-center`. Em cada sessão, o resultado foi:

- `current_database()`: `Iam-control-center`.
- `current_user`: `Iam-control-center_owner`.
- Schemas não sistêmicos: somente `public`, owner `pg_database_owner`.
- Relações de aplicação: **0**.
- Roles não sistêmicas de aplicação: somente `Iam-control-center_owner`.
- `Iam-control-center_owner`: LOGIN, INHERIT, NOSUPERUSER, BYPASSRLS, CREATEDB e CREATEROLE.
- Nenhuma role `iam_owner`, `iam_migrator`, `iam_migrator_login`, `iam_app_runtime`, `iam_app_runtime_login`, `app_runtime` ou `app_runtime_login` foi encontrada.

A role administrativa `Iam-control-center_owner` tem `BYPASSRLS` e privilégios administrativos. **Não é credencial de runtime e não prova isolamento RLS.** A consulta foi executada como essa role administrativa; não prova autenticação real por um login dedicado de aplicação ou migrator.

Nenhuma instrução DDL/DML, criação/alteração de role, membership, grant, migration ou alteração de senha foi executada. Os resultados são observação de catálogo, não evidência de conectividade da aplicação.

## 4. Consequência para PRs existentes

As seguintes descrições/artefatos precisam ser tratados como históricos ou reconciliados antes de qualquer merge ou execução:

- PR #57 e `docs/operations/iam-migration-review-checklist.md`: trechos que descrevem o projeto `floral-surf-85783683`, database `iam_control_center` e roles IAM preexistentes não representam o baseline canônico verificado em 2026-11-02.
- PR #61 e `docs/operations/auth0-neon-integration-readiness.md`: referências ao projeto antigo, schemas `iam`, `audit`, `app_private` preexistentes e roles já provisionadas não representam o baseline canônico atual.
- PR #60 e `docs/operations/neon-runtime-role-hardening-proposal.md`: a proposta de quarentena de `app_runtime*` e revogação de memberships para `neon_superuser` é baseada em evidência do projeto/estado anterior. Não executar esse SQL no projeto canônico atual: essas roles não foram encontradas no baseline atual.
- PR #59: a cadeia de assunção de roles é um desenho de teste PostgreSQL, não prova que as roles ou memberships existem no projeto canônico.

As PRs continuam Draft; este documento não aprova merge, execução, nem altera o conteúdo delas.

## 5. Topologia alvo — proposta ainda não aplicada

Manter Auth0 como único provedor de identidade. Neon fornece somente PostgreSQL. Não habilitar Neon Auth ou Managed Better Auth.

| Role | Atributos pretendidos | Finalidade |
|---|---|---|
| `iam_owner` | NOLOGIN, NOBYPASSRLS | Owner dos schemas e objetos IAM |
| `iam_migrator` | NOLOGIN, NOINHERIT, NOBYPASSRLS | Capacidade privilegiada para migrations revisadas |
| `iam_migrator_login` | LOGIN, NOINHERIT, NOBYPASSRLS | Credencial exclusiva do executor de migrations |
| `iam_app_runtime` | NOLOGIN, NOBYPASSRLS | Grupo de privilégios mínimos de runtime |
| `iam_app_runtime_login` | LOGIN, NOBYPASSRLS | Identidade de conexão do runtime |

Memberships candidatas, a testar em PostgreSQL 18:

- `iam_migrator_login → iam_migrator`: SET TRUE, INHERIT FALSE, ADMIN FALSE.
- `iam_migrator → iam_owner`: SET TRUE, INHERIT FALSE, ADMIN FALSE.
- `iam_app_runtime_login → iam_app_runtime`: INHERIT TRUE, SET TRUE, ADMIN FALSE.
- Nenhuma membership direta ou transitiva entre runtime e owner/migrator; nenhuma role de aplicação com BYPASSRLS, CREATEDB, CREATEROLE ou REPLICATION.

A cadeia de migrator confere capacidade de assumir a role proprietária e, portanto, é privilégio administrativo efetivo. Deve ser isolada em credencial e processo dedicados, com migration revisada e checksum registrado. A role administrativa Neon atual não deve ser convertida em runtime nem compartilhada com a aplicação.

## 6. Gates antes de qualquer bootstrap

1. Revisar o SQL exato de criação de roles e memberships, sem senha literal ou segredo no repositório.
2. Testar atributos, memberships, opções INHERIT/SET/ADMIN e fechamento transitivo em PostgreSQL 18 descartável.
3. Testar que runtime não consegue `SET ROLE` para owner/migrator, não possui DDL, não administra roles e não acessa o ledger de migrations.
4. Confirmar o privilégio mínimo necessário de `iam_owner` no database e ownership esperado dos objetos.
5. Planejar geração/armazenamento/rotação de credenciais fora do Git e sem exibição em logs.
6. Executar primeiro em Development somente após apresentação do SQL exato e autorização explícita separada.
7. Validar Development com evidência read-only e conexão real sob o login dedicado antes de propor Preview.
8. Preview exige gate e autorização separados.
9. Production permanece fora do escopo e exige aprovação independente.

## 7. Separação de evidências

| Alegação | Evidência necessária | Estado após esta verificação |
|---|---|---|
| Branches canônicas existem e estão prontas | Neon branch inventory | **PASS — inventário read-only** |
| Baseline sem objetos de aplicação | SQL de catálogo em cada branch | **PASS — 0 relações** |
| Roles IAM de aplicação provisionadas | Catálogo PostgreSQL | **NOT CONFIGURED** |
| Membership migrator → owner | `pg_auth_members` no alvo | **NOT CONFIGURED** |
| Login runtime efetivo | Conexão real como `iam_app_runtime_login` | **NOT VERIFIED** |
| Migration aplicada | Histórico/checksum no Neon | **NOT EXECUTED** |
| RLS multi-tenant real | Testes adversariais com login runtime | **NOT CONFIGURED** |
| Auth0 callback E2E | Login/callback real e evidência por SHA | **NOT VERIFIED** |
| Conectividade Vercel → Neon | Deploy Preview e query real com runtime | **NOT VERIFIED** |

CI em PostgreSQL descartável, deployment Preview READY, presença nominal de variáveis e inspeção administrativa não substituem as evidências de integração real listadas acima.

## 8. Decisão atual

**Neon runtime: BLOCKED / NOT CONFIGURED.**  
**Migration 0001: revisão pendente; não executar.**  
**Bootstrap de roles: proposta pendente; não executar.**  
**Production: sem alterações e fora do escopo.**

Este documento registra o baseline canônico e invalida o uso operacional de evidências históricas de outro projeto. Qualquer bootstrap, membership, migration, grant, credencial ou mudança de proteção exige revisão e autorização específica.
