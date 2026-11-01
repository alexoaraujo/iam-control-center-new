# Proposta revisável — hardening das roles runtime Neon

Status: **PROPOSTA / NÃO EXECUTADA**  
Escopo: roles observadas em Development e Preview do projeto `floral-surf-85783683`, database `iam_control_center`.  
Data da evidência de origem: 01/11/2026.

## 1. Evidência observada (somente leitura)

Nas sessões SQL autenticadas como `app_runtime_login` em Development e Preview, o catálogo `pg_roles` indicou:

| Role | LOGIN | CREATEDB | CREATEROLE | REPLICATION | BYPASSRLS | Membership |
|---|---:|---:|---:|---:|---:|---|
| `app_runtime` | true | true | true | true | true | `neon_superuser` |
| `app_runtime_login` | true | true | true | true | true | `neon_superuser` |
| `iam_app_runtime` | false | false | false | false | false | nenhuma |
| `iam_app_runtime_login` | true | false | false | false | false | `iam_app_runtime` |

A consulta SQL também confirmou que `app_runtime_login` conecta e tem `CREATE` no database. A role `app_runtime` não foi autenticada pelo conector por falta de credencial. A listagem da API Neon divergiu do catálogo SQL em `authentication_method/rolcanlogin` para algumas roles; a conexão direta com `iam_app_runtime_login` não foi comprovada.

**Não usar `app_runtime` nem `app_runtime_login` como credencial da aplicação.** Não inferir que a role alternativa `iam_app_runtime_login` está operacional até executar teste de conexão real, sem expor credenciais.

## 2. Estado final proposto

- `iam_app_runtime`: role de grupo, `NOLOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`.
- `iam_app_runtime_login`: login dedicado, `LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`, membro apenas de `iam_app_runtime` para as capacidades runtime explicitamente aprovadas.
- `app_runtime` e `app_runtime_login`: retirar associação a `neon_superuser`, remover atributos administrativos e colocar ambos em `NOLOGIN` (quarentena, sem DROP).
- Nenhuma role runtime pode alcançar `neon_superuser`, `iam_owner` ou `iam_migrator` por membership direta ou transitiva.
- Allowlist de memberships diretas: `iam_app_runtime_login → iam_app_runtime`, com `INHERIT TRUE`, `SET TRUE`, `ADMIN FALSE`; as demais roles runtime não podem ter memberships.
- Roles owner/migrator permanecem isoladas do runtime.
- Não conceder policies, grants de tabelas ou permissões funcionais nesta proposta.

A proposta não decide senha, rotação, conexão de produção, grants de objetos, policies RLS ou remoção definitiva das roles antigas.

## 3. SQL proposto — somente após revisão e autorização separada

O arquivo `database/proposals/neon-runtime-role-hardening.sql` é uma proposta explícita. O preflight falha de modo fechado se encontrar memberships diretas fora do snapshot revisado ou qualquer caminho transitivo até role administrativa. Antes de qualquer aplicação real, confirmar branch, database, existência e membership atuais, dependências, grants, credenciais e plano de rollback. Executar inicialmente apenas em Development após autorização específica. Preview somente após evidência de Development. Production exige aprovação independente.

O SQL de proposta é testado apenas em PostgreSQL descartável no CI; o CI não o executa no Neon.

## 4. Contrato de segurança exigido

1. Nenhuma role runtime com `BYPASSRLS`, `CREATEDB`, `CREATEROLE` ou `REPLICATION`.
2. Nenhuma role runtime alcança `neon_superuser`, `iam_owner` ou `iam_migrator` por membership direta ou transitiva.
3. Role de grupo runtime permanece `NOLOGIN`.
4. Login runtime dedicado permanece `LOGIN`, NOBYPASSRLS e sem atributos administrativos.
5. Allowlist de membership direta é exata: somente `iam_app_runtime_login` membro de `iam_app_runtime`.
6. Roles antigas `app_runtime*` ficam sem login e sem memberships até decisão posterior de descarte.
7. A membership permitida exige opções explícitas `INHERIT TRUE`, `SET TRUE`, `ADMIN FALSE`; qualquer `ADMIN OPTION` em role runtime bloqueia a proposta.
8. O teste negativo cria uma cadeia transitiva runtime → role intermediária → `neon_superuser` e comprova que o detector a identifica.

## 5. Divergência API Neon × catálogo PostgreSQL

A API de roles e `pg_roles.rolcanlogin` apresentaram divergência histórica para algumas roles. A validação operacional deve registrar, para a mesma branch e instante:

- resposta da API Neon `list_postgres_roles` (`authentication_method`);
- SQL read-only de `pg_roles.rolcanlogin`, `rolbypassrls`, `rolcreatedb`, `rolcreaterole`, `rolreplication`;
- membership completa via `pg_auth_members`;
- resultado de autenticação real por role, sem registrar senha ou connection string.

Não reconciliar a divergência por suposição. Se persistir, abrir investigação e manter a credencial bloqueada.

## 6. Evidência e gates

- [x] Inspeção SQL read-only Development e Preview em 01/11/2026 registrada na PR #57 comentário 6565096441.
- [x] Nenhuma alteração de role ou membership foi executada durante a inspeção.
- [ ] Revisão humana desta proposta.
- [ ] Aprovação separada para alterar roles em Development.
- [ ] Aplicação manual controlada e evidência read-only pós-mudança em Development.
- [ ] Teste real de conexão com `iam_app_runtime_login` e teste negativo de atributos administrativos.
- [ ] Repetir em Preview somente após Development validado e autorização.
- [ ] Production permanece fora do escopo e exige aprovação independente.

**Status Neon: BLOCKED para uso runtime até validação real.**  
**Status desta proposta: DRAFT; não aplicar no Neon, não mesclar automaticamente.**
