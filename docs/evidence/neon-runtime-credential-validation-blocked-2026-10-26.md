# Evidência — validação de runtime bloqueada pela conexão Neon

- Data: 2026-10-26
- Projeto Neon: `floral-surf-85783683`
- Branch isolado: `rls-test-isolated-2026-10-26`
- Branch ID: `br-super-darkness-b6a0w5vc`
- Parent: Development (`br-mute-pine-b6lc6bip`)
- Banco solicitado: `neondb`
- Repositório: `alexoaraujo83/iam-control-center`
- PR: [#27 — Draft](https://github.com/alexoaraujo83/iam-control-center/pull/27)
- Estado: **BLOCKED — não foi possível autenticar como a role runtime pelo conector disponível**.

## Verificações realizadas

1. GitHub Actions `quality` do SHA `9188549ad0b11152eba9e33dca01359f0416345c` foi consultado e concluiu com sucesso em duas execuções.
2. Vercel Preview Comments concluiu com sucesso; o check de Preview deployment teve uma execução `success` e outra `skipped`.
3. A branch Neon isolada foi encontrada em estado `ready`, derivada de Development.
4. Foi tentada uma consulta exclusivamente de leitura para inspecionar privilégios de sessão usando `role_name = iam_app_runtime_dev_safe`.
5. O conector recusou a tentativa antes de executar SQL: a conexão está fixada na role PostgreSQL `Administrador` e não permite trocar `role_name` para `iam_app_runtime_dev_safe`.

## Interpretação

- **Não existe evidência de login real com a role runtime.** A tentativa foi bloqueada pela configuração da conexão do conector.
- Não usar os privilégios da role `Administrador` como substituto de runtime.
- Não executar `SET ROLE` a partir da conexão administrativa como se fosse um teste de autenticação independente.
- O estado da branch `ready` apenas confirma que o branch Neon existe e está disponível; não comprova RLS nem autenticação runtime.
- Nenhuma consulta SQL foi executada com a role runtime. Nenhum DDL, DML, grant, mudança de role ou migration foi aplicado.
- Production não foi acessada.

## Próximo passo exigido

Obter um caminho de conexão real para `iam_app_runtime_dev_safe` (ou para a role login runtime oficialmente destinada ao teste) no branch isolado, sem expor credenciais em logs, chat ou commits. Em seguida, executar uma bateria somente de leitura primeiro para confirmar `current_user`, `rolsuper`, `rolbypassrls`, privilégios de schema e tabela; depois, com autorização de teste e fixture isolada, validar as políticas e registrar os resultados.

Até essa evidência existir, a validação runtime/RLS permanece **BLOCKED** e não se deve preparar ou aplicar migration executável.


## Revalidação automática — 2026-10-26

- SHA da ADR de descoberta/catálogos: `9188549ad0b11152eba9e33dca01359f0416345c`.
- GitHub Actions `quality`: duas execuções concluídas com `success` para esse SHA.
- Vercel Preview Comments: `success`; um check de deployment Preview concluiu `success` e o segundo foi `skipped`.
- PR #27 permanece aberto, Draft e não mesclado.
- Nova tentativa de consulta read-only no branch isolado, solicitando `role_name = iam_app_runtime_dev_safe`, retornou explicitamente: `This connection is pinned to Postgres role "Administrador"; role_name "iam_app_runtime_dev_safe" is not allowed.`
- A tentativa foi recusada antes da execução do SQL. Assim, o bloqueio de autenticação runtime foi reproduzido e continua sem solução por este conector.
- Não houve alteração de schema, dados, roles, grants ou migrations; Production não foi acessada.
