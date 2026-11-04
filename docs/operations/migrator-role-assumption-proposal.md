# Proposta de cadeia de assunção de roles do migrator

**Status: topologia executada em Development; proposta de operação autenticada ainda bloqueada por ausência de credenciais LOGIN.**

## Estado atual do projeto Neon canônico

Projeto: wandering-wildflower-90908845.

No branch Development, o catálogo PostgreSQL confirma que as cinco roles IAM foram criadas e que as três memberships propostas estão presentes:
- iam_migrator_login → iam_migrator: INHERIT FALSE, SET TRUE, ADMIN FALSE.
- iam_migrator → iam_owner: INHERIT FALSE, SET TRUE, ADMIN FALSE.
- iam_app_runtime_login → iam_app_runtime: INHERIT TRUE, SET FALSE, ADMIN FALSE.

Os atributos observados são:
- iam_owner e iam_migrator: NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS.
- iam_migrator_login: LOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS.
- iam_app_runtime: NOLOGIN, INHERIT, NOSUPERUSER, NOBYPASSRLS.
- iam_app_runtime_login: LOGIN, INHERIT, NOSUPERUSER, NOBYPASSRLS.

O database não possui ainda schemas/tabelas de aplicação; a migration 0001 não foi executada. Nenhuma senha foi provisionada. A conexão pelo conector Neon usando os dois LOGINs falhou por ausência de credencial de senha. Logo, a membership e os atributos estão verificados, mas a autenticação real dos LOGINs permanece BLOCKED.

Preview e Production não receberam o bootstrap e não foram alterados. O inventário de roles nesses branches lista somente a role proprietária do database.

## Objetivo

Manter a distinção entre:
- iam_owner: owner NOLOGIN dos schemas/objetos IAM.
- iam_migrator: role intermediária de capacidade para executar migrations.
- iam_migrator_login: principal LOGIN dedicado, NOINHERIT e NOBYPASSRLS.
- iam_app_runtime: role de aplicação sem membership em owner/migrator.
- iam_app_runtime_login: principal LOGIN dedicado que herda somente iam_app_runtime, sem SET ROLE.

A cadeia de migration exige que o login assuma explicitamente iam_migrator e depois iam_owner, preservando session_user e alterando current_user. Não deve haver membership direta iam_migrator_login → iam_owner.

## Topologia

    iam_migrator_login (LOGIN, NOINHERIT, NOBYPASSRLS)
      └─ SET TRUE → iam_migrator (NOLOGIN, NOINHERIT, NOBYPASSRLS)
           └─ SET TRUE → iam_owner (NOLOGIN, NOBYPASSRLS)

O runtime segue uma cadeia separada:

    iam_app_runtime_login (LOGIN, INHERIT)
      └─ INHERIT TRUE / SET FALSE → iam_app_runtime (NOLOGIN, INHERIT)

## SQL de referência — não reaplicar no Development

As memberships abaixo já foram observadas no Development. Não reaplicar GRANT sem nova consulta read-only e uma justificativa de delta:

    GRANT iam_owner TO iam_migrator
      WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;

    GRANT iam_migrator TO iam_migrator_login
      WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;

    GRANT iam_app_runtime TO iam_app_runtime_login
      WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;

O bootstrap de roles está versionado em database/bootstrap/0000_iam_roles.sql na cadeia da PR #57, e seu contrato é validado por database/tests/0000_role_bootstrap_contract.sql.

## Controles obrigatórios

- iam_owner, iam_migrator e iam_app_runtime: NOLOGIN e NOBYPASSRLS.
- iam_migrator_login: LOGIN, NOINHERIT e NOBYPASSRLS.
- Memberships sem ADMIN OPTION.
- Nenhuma membership de iam_app_runtime para iam_migrator ou iam_owner.
- Nenhuma concessão a Iam-control-center_owner como substituto do login dedicado.
- A credencial de iam_migrator_login não deve ser compartilhada com aplicação, CI genérico ou runtime.
- A sessão real deve demonstrar session_user = iam_migrator_login e current_user = iam_owner imediatamente antes do preflight.
- O login de runtime não pode assumir iam_owner ou iam_migrator.

## Evidência automatizada e limite

O workflow database-tests.yml executa o bootstrap e a migration em PostgreSQL 18 descartável. O runner provisiona senhas aleatórias somente no container CI e executa a migration por uma conexão autenticada como iam_migrator_login, com os dois SET ROLE.

Os testes comprovam a semântica PostgreSQL da topologia em banco descartável. Não comprovam que os LOGINs Neon possuem credenciais, que a conexão Neon autentica, nem que a migration pode ser executada no Development.

## Decisão operacional pendente

Antes de qualquer execução da migration no Neon:
1. Provisionar a credencial de iam_migrator_login por mecanismo seguro e autorizado, sem expor o valor.
2. Validar uma sessão real autenticada como iam_migrator_login.
3. Provar os dois SET ROLE e confirmar session_user/current_user na mesma sessão.
4. Revisar migration 0001, checksum, ownership, rollback e compatibilidade.
5. Executar primeiro em PostgreSQL descartável e depois, sob autorização específica, em Development.
6. Não executar em Preview ou Production sem aprovação separada.

A cadeia transitiva concede ao migrator capacidade de assumir temporariamente a role proprietária do schema. Tratar essa credencial como altamente privilegiada, fora do runtime, com revisão humana e trilha de auditoria.
