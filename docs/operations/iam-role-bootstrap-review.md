# IAM role bootstrap — revisão independente

**Status: PR DRAFT / TOPOLOGIA EM REVISÃO / BOOTSTRAP EXECUTADO SOMENTE EM DEVELOPMENT SOB AUTORIZAÇÃO ESPECÍFICA**

Este bootstrap é pré-requisito separado da migration `0001_initial_iam_schema.sql`. A migration 0001 não cria roles: exige sessão autenticada como `iam_migrator_login`, a cadeia de `SET ROLE` para `iam_migrator` e `iam_owner`, e privilégio `CREATE` no database.

## Topologia proposta

| Role | LOGIN | INHERIT | Finalidade |
|---|---:|---:|---|
| `iam_owner` | Não | Não | Owner dos schemas/objetos IAM; recebe somente `CREATE` no database |
| `iam_migrator` | Não | Não | Grupo de migração; pode assumir `iam_owner` por `SET ROLE` |
| `iam_migrator_login` | Sim | Não | Principal autenticável e sem atributos administrativos para executar migration |
| `iam_app_runtime` | Não | Sim | Grupo de runtime, sem `BYPASSRLS` ou atributos administrativos |
| `iam_app_runtime_login` | Sim | Sim | Principal de conexão da aplicação; herda runtime sem `SET ROLE` |

Memberships exatas:
- `iam_migrator_login → iam_migrator`: `INHERIT FALSE / SET TRUE / ADMIN FALSE`.
- `iam_migrator → iam_owner`: `INHERIT FALSE / SET TRUE / ADMIN FALSE`.
- `iam_app_runtime_login → iam_app_runtime`: `INHERIT TRUE / SET FALSE / ADMIN FALSE`.
- Nenhum membership direto `iam_migrator_login → iam_owner`.
- Nenhum `ADMIN OPTION` nas memberships concedidas aos principals IAM; nenhuma role IAM é membro de roles administrativas/provider-managed.

### Observação específica do Neon

No Development, o catálogo PostgreSQL mostrou cinco memberships adicionais cujo **member é `Iam-control-center_owner`**, cujo **grantor é `cloud_admin`** e que têm `ADMIN OPTION`. O Neon cria essas associações administrativas para o proprietário do database quando roles são criadas. Elas permitem a administração das roles pelo owner e **não são memberships concedidas a principals IAM** pelo bootstrap.

Por isso, o teste do grafo IAM deve contar as associações cujo membro é uma das cinco roles IAM e validar exatamente as três arestas aprovadas. Não deve contar as associações gerenciadas pelo Neon em que `Iam-control-center_owner` é o membro. Essas associações provider-managed não devem ser revogadas como correção do teste.

## Principal administrativo do bootstrap

O principal administrativo atual observado no projeto canônico é `Iam-control-center_owner`. O inventário read-only mostrou atributos administrativos, incluindo `CREATEDB`, `CREATEROLE`, `REPLICATION` e `BYPASSRLS`. Ele pode ser necessário para bootstrap, mas **não é runtime** e não deve ser colocado em `DATABASE_URL` da aplicação.

O SQL proposto exige que o principal seja uma sessão direta, não-superuser, com `CREATEROLE` e owner do database. A presença de `BYPASSRLS` no principal administrativo não é transferida às roles IAM criadas. O bootstrap falha se qualquer uma das cinco roles já existir; não tenta corrigir nem reutilizar roles parciais.

## Segurança e limites

1. O script é transacional, não idempotente e falha fechado. Se qualquer etapa falhar, PostgreSQL reverte as alterações da transação.
2. As duas roles LOGIN são criadas **sem senha**. Não há senha, hash, token ou secret no repositório. Credenciais devem ser emitidas separadamente por processo aprovado e armazenadas nos secrets/variáveis apropriados; nunca no Git.
3. `iam_owner` recebe somente `CREATE` no database. Não há `CREATEDB`, `CREATEROLE`, `BYPASSRLS` ou `SUPERUSER` nas roles IAM.
4. Não são concedidos privilégios de schema/tabela/sequence, policies RLS, permissões de aplicação, seeds, extensões ou ownership fora do necessário.
5. Runtime permanece **default-deny**. A role runtime não poderá acessar as tabelas IAM até que grants mínimos e políticas RLS sejam objeto de uma revisão separada.
6. O SQL não é chamado pela inicialização da aplicação, CI de deploy ou Vercel.
7. Não executar em Preview ou Production. O bootstrap foi executado em Development após autorização específica e preflight. O recovery point usado foi uma branch operacional copy-on-write, sem proteção contra exclusão e sem teste de restore; portanto, não equivale a snapshot restaurável comprovado.

## Testes

O workflow PostgreSQL 18 deve validar:
- atributos de cada role e ausência de atributos administrativos;
- grafo de memberships concedidas aos cinco principals IAM exatamente igual às três memberships aprovadas, sem associações adicionais; associações provider-managed em que o owner do database é o membro ficam fora desse grafo e são verificadas separadamente;
- ACL do database: sem CONNECT/TEMP para PUBLIC, CREATE apenas para `iam_owner`, CONNECT explícito para os dois LOGINs e sem TEMP para roles IAM;
- ausência de password hash no catálogo protegido `pg_authid` após bootstrap;
- opções exatas das três memberships;
- `CREATE` somente para `iam_owner` e `CONNECT` explícito para os dois logins;
- ausência de `CREATE` para runtime e logins;
- rejeição de segunda execução (bootstrap não idempotente);
- atomicidade/rollback de DDL de roles em uma transação descartável;
- senhas aleatórias efêmeras no runner e senha de serviço derivada do identificador da execução, sem credenciais fixas versionadas.

Esses testes validam o SQL em PostgreSQL 18 descartável. Não provam privilégios, memberships, autenticação ou comportamento RLS reais no Neon.

## Estado operacional após o bootstrap

1. Bootstrap aplicado somente em Development, no database `Iam-control-center`, a partir do arquivo `database/bootstrap/0000_iam_roles.sql` com blob SHA `e39ec33c5b72e697acca4cff5d6675d190ff8d90`.
2. As cinco roles IAM, as três memberships da topologia e os ACLs de database foram observados no catálogo após a execução.
3. As cinco memberships adicionais em que `Iam-control-center_owner` é membro foram identificadas como associações gerenciadas pelo Neon (`grantor=cloud_admin`); não foram removidas.
4. A validação inicial do teste falhou porque contava essas associações provider-managed. O teste foi corrigido para medir somente memberships concedidas aos cinco principals IAM. A correção ainda depende de CI no novo SHA.
5. Credenciais LOGIN não foram provisionadas. Não configurar `DATABASE_URL` de aplicação com o principal administrativo.
6. Não executar a migration `0001` até o CI atualizado, revisão da cadeia PR #57 → PR #80 e validação de autenticação do migrator estarem concluídos.
7. Preview e Production continuam bloqueados e não foram alterados.

**Auth0 permanece como IdP; Neon Auth não faz parte desta arquitetura.**
