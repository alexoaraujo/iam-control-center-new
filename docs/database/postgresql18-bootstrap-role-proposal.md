# Proposta isolada — bootstrap de roles PostgreSQL 18

**Status:** proposta para revisão; não é migration executável em Neon.  
**Base de evidência:** PR #62, SHA `3ffefe2ff22361bf1fbf742e4fabf5d201877fc9`.  
**Projeto Neon canônico:** `control-center` / database `Iam-control-center`.  
**Ambiente desta proposta:** PostgreSQL 18 descartável em CI.

## 1. Limites e invariantes

- Não conectar a Production, Development ou Preview do Neon.
- Não criar roles, memberships, grants ou objetos em qualquer branch Neon.
- Não configurar senhas ou connection strings reais.
- Não conceder ao runtime privilégios administrativos ou de DDL.
- Não considerar o nome do schema/ledger usado nos testes como contrato definitivo da aplicação.
- O Auth0 continua sendo o provedor de identidade; esta proposta trata exclusivamente de privilégios PostgreSQL.
- Nenhuma migration IAM de domínio, RLS multi-tenant ou grants funcionais de runtime está incluída.

A PR é deliberadamente isolada e deve permanecer Draft até revisão técnica. O SQL de teste cria roles e objetos apenas dentro do serviço PostgreSQL efêmero do GitHub Actions.

## 2. Topologia proposta

| Role | LOGIN | INHERIT | BYPASSRLS | Função |
|---|---:|---:|---:|---|
| `iam_owner` | NO | NO | NO | Proprietária de schemas e objetos |
| `iam_migrator` | NO | NO | NO | Role intermediária de execução de migrations |
| `iam_migrator_login` | YES | NO | NO | Identidade de conexão exclusiva do executor de migrations |
| `iam_app_runtime` | NO | YES | NO | Grupo de privilégios da aplicação |
| `iam_app_runtime_login` | YES | YES | NO | Identidade de conexão do runtime |

Todas as cinco roles também devem ser `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE` e `NOREPLICATION`. Nenhuma role recebe senha nesta proposta.

### Memberships explícitas

| Granted role | Member | INHERIT | SET | ADMIN | Intenção |
|---|---|---:|---:|---:|---|
| `iam_owner` | `iam_migrator` | FALSE | TRUE | FALSE | Migrator pode assumir owner, sem herdar seus privilégios automaticamente |
| `iam_migrator` | `iam_migrator_login` | FALSE | TRUE | FALSE | Login pode assumir migrator |
| `iam_app_runtime` | `iam_app_runtime_login` | TRUE | FALSE | FALSE | Runtime herda apenas grants do grupo, sem poder assumir a role |

As opções são definidas por membership, não apenas pelo atributo global da role. O teste consulta `pg_auth_members.inherit_option`, `set_option` e `admin_option`, disponíveis no PostgreSQL moderno.

**Cadeia do migrator:** os dois vínculos da cadeia têm `SET TRUE`; portanto, a sessão autenticada como `iam_migrator_login` pode executar `SET ROLE iam_migrator` e também `SET ROLE iam_owner`. O teste prova ambos os caminhos. A aplicação não é membro direto ou indireto de nenhuma dessas roles.

## 3. Escopo de privilégios

- O ledger de migrations de fixture é criado em schema de teste `bootstrap_fixture`, pertencente a `iam_owner`. Esse nome é exclusivamente de teste e não define o schema definitivo do produto.
- O runtime não recebe `USAGE` no schema de fixture nem privilégios sobre a tabela de ledger.
- O runtime não recebe `CREATE` no schema `public`, no schema de fixture ou no database; também não recebe `TEMPORARY`.
- O migrator acessa objetos de propriedade de `iam_owner` somente após assumir explicitamente essa role.
- Não são concedidos privilégios funcionais de leitura/escrita sobre futuras tabelas IAM. Isso será objeto de proposta posterior, após contratos de tenancy, contexto de tenant e políticas RLS.

## 4. Nuance de RLS para roles proprietárias

`NOBYPASSRLS` não impede, por si só, que a role proprietária de uma tabela ignore RLS: por padrão, o owner da tabela pode contornar as políticas, salvo quando a tabela usa `FORCE ROW LEVEL SECURITY`. Portanto:

- `iam_app_runtime_login` nunca será owner de tabelas ou schemas.
- Tabelas que contenham dados multi-tenant deverão ter RLS habilitada e, quando apropriado, `FORCE ROW LEVEL SECURITY`.
- A role owner permanece sem LOGIN e inacessível ao runtime; o migrator só a assume durante operações controladas.
- O teste de bootstrap não prova RLS nem isolamento cross-tenant; esses controles exigem uma suíte separada executada com a role real de runtime.

## 5. Testes negativos e positivos obrigatórios

| Controle | Teste | Resultado esperado |
|---|---|---|
| Roles de grupo | `LOGIN=false` e `BYPASSRLS=false` para owner, migrator e runtime group | PASS |
| Roles de conexão | LOGIN apenas nos dois logins; sem SUPERUSER/BYPASSRLS | PASS |
| Membership | Comparar exatamente INHERIT/SET/ADMIN dos três vínculos | PASS |
| Runtime → owner/migrator | `pg_has_role(..., 'MEMBER')` e `pg_has_role(..., 'SET')` | FALSE |
| Runtime elevado | CREATEDB, CREATEROLE, REPLICATION e SUPERUSER | FALSE |
| Runtime DDL | Tentativas reais de CREATE TABLE em `public` e schema de fixture | Devem falhar |
| Runtime temporário | Tentativa de CREATE TEMP TABLE | Deve falhar |
| Ledger | SELECT/INSERT/UPDATE/DELETE no ledger como runtime | Devem falhar |
| Cadeia migrator | SET ROLE migrator e SET ROLE owner a partir do login | Devem funcionar |
| ADMIN | ADMIN OPTION em todas as memberships | FALSE |

Os testes de falha devem confirmar erro de permissão (não apenas ausência de configuração). As verificações de catálogo são complementares, não substituem as tentativas reais.

## 6. Critérios de aceitação da proposta

1. Workflow executa em PostgreSQL 18 e confirma versão major 18.
2. Todas as assertions de catálogo passam.
3. Os comandos positivos do migrator retornam o `current_user` esperado.
4. Cada tentativa negativa do runtime retorna código de saída diferente de zero.
5. O workflow de qualidade já existente executa o harness por meio de `pnpm test`.
6. Nenhuma variável/secret Neon ou Auth0 é necessária; o container é efêmero e local ao runner.
7. Nenhuma etapa conecta a um banco externo.
8. O SHA exato da PR e os jobs do workflow ficam registrados antes de qualquer classificação PASS.

## 7. Riscos e decisões ainda abertas

- **Capacidade administrativa do Neon:** a role administrativa atual `Iam-control-center_owner` tem BYPASSRLS e não deve ser runtime. A compatibilidade e o escopo de concessão de roles no Neon devem ser confirmados separadamente antes de qualquer bootstrap real.
- **Ownership e schema definitivo:** o schema do ledger, nomes de schemas da aplicação, owners e grants ainda exigem revisão.
- **PostgreSQL 18 / Neon:** CI em PostgreSQL 18 comprova semântica PostgreSQL no container, não comportamento do plano Neon nem privilégios concedidos pelo serviço.
- **RLS:** NOBYPASSRLS é necessário, mas não prova isolamento. Políticas e testes cross-tenant são uma entrega separada.
- **Credenciais:** provisionamento e rotação dos logins de migrations/runtime ficam fora desta proposta.
- **Produção:** requer aprovação específica, plano de rollback/restore e evidência em ambiente isolado.

## 8. Rollback

Como a proposta não altera Neon, o rollback consiste em fechar a PR ou reverter o commit da branch. O harness inicia um container PostgreSQL 18 descartável no runner e o remove por meio de trap ao fim da execução.

## 9. Referências normativas

- [PostgreSQL 18 — CREATE ROLE](https://www.postgresql.org/docs/18/sql-createrole.html)
- [PostgreSQL 18 — GRANT](https://www.postgresql.org/docs/18/sql-grant.html)
- [PostgreSQL 18 — Role Membership](https://www.postgresql.org/docs/18/role-membership.html)
- [PostgreSQL 18 — Privileges](https://www.postgresql.org/docs/18/ddl-priv.html)

**Conclusão:** esta é uma proposta testável de segregação de privilégios. Não é autorização para executar DDL, provisionar credenciais, aplicar migrations ou modificar qualquer branch Neon.
