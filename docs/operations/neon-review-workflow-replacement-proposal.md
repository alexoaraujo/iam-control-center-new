# Proposta — substituição do workflow legado de verificação Neon

**Status:** proposta para revisão; workflow não executado e arquivo legado não alterado  
**Workflow legado:** `.github/workflows/neon-review-role-verification.yml`  
**Projeto Neon canônico:** `wandering-wildflower-90908845`

## 1. Problema identificado

O workflow legado é manual, mas seus guards e valores-alvo ainda apontam para infraestrutura antiga:
- branch `br-fancy-bird-b6j7etpp`;
- database `iam_control_center`;
- role `Administrador`;
- endpoint `ep-curly-shape-b6hv2xd4...`;
- environment `neon-review-maintenance`;
- secret `NEON_REVIEW_DATABASE_URL` e vars `NEON_REVIEW_BRANCH_ID` / `NEON_REVIEW_DATABASE`.

Essas referências não correspondem ao projeto/branches canônicos atuais. A existência e o conteúdo de secrets/vars do GitHub Environment não foram confirmados. O workflow legado não foi executado.

## 2. Objetivo da substituição

Criar, em entrega futura separada, um workflow de verificação de conexão/identidade que:
- seja manual por padrão (`workflow_dispatch`);
- seja restrito a Development, com aprovação/environment protection se disponível no plano utilizado;
- não possua alvo Production;
- use branch ID e database allowlisted explicitamente;
- use uma credencial runtime dedicada, nunca owner, migrator ou administrador;
- falhe fechado se projeto, branch, database, hostname ou identidade divergirem;
- não executar migrations nem SQL de escrita;
- não imprimir connection strings, senhas, tokens ou variáveis completas.

## 3. Princípios de implementação

### Permissões e execução
- `permissions: contents: read` como baseline; não conceder `write-all`.
- `workflow_dispatch` restrito à branch default protegida e com confirmação literal.
- `concurrency` por ambiente, sem cancelamento de execução em andamento.
- `timeout-minutes` curto e runner hospedado.
- Não usar `pull_request_target` para executar código de PR.
- Não fazer checkout nem executar scripts fornecidos por PR para uma conexão com segredo.
- Não disparar em push, pull_request ou schedule.

### Segredos e variáveis
- Secret de conexão somente em GitHub Environment dedicado a Development, se necessário.
- Branch ID, database e hostname allowlisted como variables não secretas.
- Não criar nem reutilizar secrets antigos até que os responsáveis confirmem sua finalidade.
- Não duplicar connection strings em repository secrets e environment secrets.
- Não conceder acesso a Preview/Production.
- Se o plano gratuito não oferecer proteção/aprovação de environment, documentar a limitação; não simular uma barreira de aprovação.

### Guard de conexão
Antes de conectar, validar:
1. repository e ref esperados;
2. environment Development;
3. branch ID e database allowlisted;
4. hostname esperado para o endpoint da branch;
5. conexão direta enquanto o pooler estiver desabilitado;
6. TLS obrigatório;
7. role efetiva runtime esperada.

A URL deve ser analisada em memória; não enviar seu conteúdo para stdout, logs de debug, outputs, artifacts ou annotations.

### Consultas read-only
Após conexão, executar apenas verificações read-only:
- `SELECT current_database(), session_user, current_user`;
- leitura de atributos da role efetiva;
- `SELECT 1`.

Não executar DDL/DML, `SET ROLE` para owner/migrator, grants, revokes, migrations ou criação de tabelas temporárias.

## 4. Separar verificação de conexão de teste RLS

O workflow de verificação de conexão não prova isolamento multi-tenant. Testes RLS cross-tenant devem ser uma suíte separada, com:
- fixtures efêmeras e controladas;
- principal autenticado representativo;
- tenant A e tenant B;
- leitura/alteração cruzada explicitamente negada;
- evidência dos SQLSTATE/resultados esperados;
- sem usar owner/BYPASSRLS para representar runtime.

CI PostgreSQL descartável não é prova de que o Neon remoto ou Vercel está conectado.

## 5. Plano de transição

1. Manter o workflow legado inalterado e não executá-lo enquanto os guards apontarem para infraestrutura antiga.
2. Confirmar existência, finalidade e consumidores dos secrets/vars do environment legado sem revelar valores.
3. Validar roles e connection string Development por procedimento separado.
4. Implementar novo workflow em PR Draft independente, somente depois de a identidade runtime existir.
5. Testar guards em fixtures sem secrets.
6. Executar conexão real somente após revisão e autorização explícita.
7. Depois de evidência suficiente, propor desativação/remoção do workflow antigo em mudança separada.

## 6. Critérios de aceite

- [ ] O workflow não contém branch, database, endpoint ou role antiga.
- [ ] O alvo é exclusivamente Development.
- [ ] A role de conexão é runtime dedicada, sem atributos privilegiados.
- [ ] Nenhuma URL/credencial aparece em logs ou artifacts.
- [ ] O job executa somente consultas read-only.
- [ ] Guards negativos rejeitam branch, database, hostname e role incorretos.
- [ ] A execução real é manual e explicitamente autorizada.
- [ ] Resultado é associado a SHA, branch, environment e horário.
- [ ] O workflow não é tratado como prova de RLS cross-tenant.

## 7. Estado atual

| Item | Estado |
|---|---|
| Workflow legado identificado | PASS — leitura do arquivo em `main` |
| Workflow legado executado | NÃO |
| Secrets/vars do GitHub Environment | NOT VERIFIED |
| Nova workflow implementada | PENDING |
| Roles runtime Neon | NOT VERIFIED |
| Conectividade real | PENDING |
| Teste RLS cross-tenant | PENDING |

Nenhum workflow foi executado ou modificado durante a preparação desta proposta.


## Atualização do inventário Neon — 2026-11-02

A consulta read-only mais recente identificou os seguintes alvos canônicos:

| Ambiente | Branch ID | Endpoint ID | Host direto | Pooler |
|---|---|---|---|---|
| Development | `br-nameless-wave-b49yqod7` | `ep-shiny-glade-b4awlrlg` | `ep-shiny-glade-b4awlrlg.c-6.us-east-2.aws.neon.tech` | Desabilitado |
| Preview | `br-broad-base-b4gnjmg5` | `ep-soft-night-b4xgjlht` | `ep-soft-night-b4xgjlht.c-6.us-east-2.aws.neon.tech` | Desabilitado |
| Production | `br-dry-mouse-b4gyjp04` | `ep-dawn-river-b4xl1228` | `ep-dawn-river-b4xl1228.c-6.us-east-2.aws.neon.tech` | Desabilitado |

A API de roles Neon retornou somente `Iam-control-center_owner` nas três branches. Esse retorno não prova inexistência de roles adicionais no catálogo PostgreSQL nem valida a identidade das URLs Vercel. A proposta de workflow continua bloqueada até existir e ser validada uma role runtime dedicada e uma connection string Development correspondente.

O Vercel mantém `NEON_PROJECT_ID` canônico em Development e Preview. `DATABASE_MIGRATION_URL` existe em Development e Preview, mas seu consumidor/finalidade continuam desconhecidos. O workflow futuro não deve reutilizar nem ler esse secret sem uma revisão de propósito e autorização separada.

O workflow legado continua sem execução e sem alteração. Esta atualização é documental; não cria workflow, environment, secret, variable ou conexão remota.


## Atualização de estado — 03/11/2026 (supersede os snapshots anteriores)

Projeto canônico: wandering-wildflower-90908845.

O bootstrap de roles IAM foi executado somente em Development, sob autorização específica, pela proposta integrada na PR #80. A inspeção SQL read-only confirmou cinco roles e três memberships:
- iam_migrator_login → iam_migrator (INHERIT FALSE, SET TRUE, ADMIN FALSE).
- iam_migrator → iam_owner (INHERIT FALSE, SET TRUE, ADMIN FALSE).
- iam_app_runtime_login → iam_app_runtime (INHERIT TRUE, SET FALSE, ADMIN FALSE).

As roles iam_owner e iam_migrator são NOLOGIN/NOINHERIT/NOSUPERUSER/NOBYPASSRLS. iam_migrator_login é LOGIN/NOINHERIT/NOSUPERUSER/NOBYPASSRLS. iam_app_runtime é NOLOGIN/INHERIT/NOSUPERUSER/NOBYPASSRLS. iam_app_runtime_login é LOGIN/INHERIT/NOSUPERUSER/NOBYPASSRLS.

Portanto, a afirmação anterior de que a API Neon listava somente Iam-control-center_owner é um snapshot histórico da API e não substitui a inspeção SQL posterior. O estado atual do Development possui as cinco roles IAM. Preview e Production não receberam bootstrap e o inventário continua sem relações de aplicação.

Nenhuma senha foi provisionada para iam_migrator_login ou iam_app_runtime_login. A tentativa de conexão via conector Neon falhou com “missing authentication credentials: required password”. O novo workflow de verificação real continua BLOCKED até existir credencial runtime apropriada e uma connection string Development validada.

O workflow legado permanece sem execução. Seus guards ainda apontam para branch/endpoint antigos (br-fancy-bird-b6j7etpp / ep-curly-shape-b6hv2xd4), não para o Development canônico. Não o execute nem o use como fonte de conectividade atual. A substituição proposta continua sendo apenas documentação; nenhum workflow novo foi instalado.

Auth0 permanece como IdP. A PR #55 registrou E2E Auth0 PASS no SHA 678dbcf595937625e98974db787e189d9d8b81b2, run 41562860012. Essa evidência é limitada à branch/Preview testada; APP_BASE_URL de Preview continua branch-scoped para fix/next16-proxy-r2.

A Vercel está no plano Hobby. A auditoria histórica #45 registrou restrição de elegibilidade para SaaS comercial; confirmar os termos vigentes antes de qualquer uso comercial. Não promover Production nem iniciar upgrade/teste pago automaticamente.

**Decisão:** manter esta proposta em revisão. Não executar workflow, SQL, migration, provisionamento de credenciais, alteração de environment ou operação em Production.
