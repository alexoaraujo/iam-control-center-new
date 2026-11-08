# Auth0 + Neon PostgreSQL — prontidão e gates de execução

**Status: PARCIAL / EXECUÇÃO DA MIGRATION BLOQUEADA.**

**Data de revisão:** 03/11/2026  
**Projeto:** IAM Control Center  
**Neon canônico:** wandering-wildflower-90908845  
**Decisão de identidade:** Auth0 permanece como único provedor OIDC. Neon fornece PostgreSQL. Neon Auth / Managed Better Auth não deve ser habilitado.

## 1. Estado atual verificado no repositório

- O web app utiliza @auth0/nextjs-auth0 4.33.0.
- apps/web/src/lib/auth0.ts constrói Auth0Client no servidor.
- A PR #69 adiciona @neondatabase/serverless 1.2.0 e apps/web/src/lib/db.ts como módulo server-only.
- getSql() valida DATABASE_URL e instancia o factory neon(connectionString).
- O cliente ainda não executa query real, não comprova sessão, TLS, grants ou RLS.
- GET /api/health verifica presença/configuração; não comprova conectividade PostgreSQL.
- DATABASE_MIGRATION_URL existe como variável Vercel em Development e Preview, mas não há executor de migrations implementado nesta branch.
- A migration 0001 da PR #57 continua como artefato revisável, não executada.

## 2. Neon — inventário canônico atualizado

Projeto: wandering-wildflower-90908845 (control-center), PostgreSQL 18, plano free_v3.

Branches:
- production — br-dry-mouse-b4gyjp04, primary/default.
- development — br-nameless-wave-b49yqod7.
- preview — br-broad-base-b4gnjmg5.
- recovery-development-pre-bootstrap-2026-11-02 — br-fancy-wind-b4ura0x5.

As quatro branches estão READY. Production, Development e Preview não estão marcadas como protected no inventário da API. Pooler está desabilitado nos três endpoints consultados. Não alterar pooler até testar compatibilidade do driver e do fluxo de transação.

### 2.1 Development — roles e memberships observadas por SQL read-only

O bootstrap de roles foi executado somente em Development, sob autorização específica. O catálogo PostgreSQL confirmou:

| Role | LOGIN | INHERIT | SUPERUSER | CREATEDB | CREATEROLE | REPLICATION | BYPASSRLS |
|---|---:|---:|---:|---:|---:|---:|---:|
| iam_owner | Não | Não | Não | Não | Não | Não | Não |
| iam_migrator | Não | Não | Não | Não | Não | Não | Não |
| iam_migrator_login | Sim | Não | Não | Não | Não | Não | Não |
| iam_app_runtime | Não | Sim | Não | Não | Não | Não | Não |
| iam_app_runtime_login | Sim | Sim | Não | Não | Não | Não | Não |

Memberships:
- iam_migrator_login → iam_migrator: INHERIT FALSE / SET TRUE / ADMIN FALSE.
- iam_migrator → iam_owner: INHERIT FALSE / SET TRUE / ADMIN FALSE.
- iam_app_runtime_login → iam_app_runtime: INHERIT TRUE / SET FALSE / ADMIN FALSE.

O Neon mantém memberships provider-managed em que Iam-control-center_owner é membro e cloud_admin é grantor. Essas associações não são memberships concedidas aos principals IAM e não devem ser revogadas como correção dos testes.

Iam-control-center_owner é principal administrativo do Neon e possui atributos administrativos, incluindo CREATEDB, CREATEROLE, REPLICATION e BYPASSRLS. Não usar essa role como DATABASE_URL do runtime.

O database tem somente o schema public e nenhuma relação de aplicação. A migration 0001 não foi executada. iam_owner tem CREATE no database; os dois LOGINs têm CONNECT explícito, sem CREATE.

### 2.2 Credenciais e autenticação dos LOGINs

Nenhuma senha foi provisionada para iam_migrator_login ou iam_app_runtime_login.

Uma tentativa read-only de conexão pelo conector Neon com role_name iam_migrator_login e iam_app_runtime_login retornou “missing authentication credentials: required password”. Assim:
- os atributos LOGIN e as memberships estão verificados;
- a autenticação real dos principals ainda não está provada;
- o runtime e o migrator não estão prontos para uso pela aplicação;
- a emissão de credenciais exige processo separado, secret store e autorização específica.

### 2.3 Preview e Production

O inventário de branches, roles, databases e relações lista somente a role proprietária do database e nenhuma tabela de aplicação em Preview e Production. Não foi executado bootstrap nesses branches. Production não foi alterada.

A role owner do Neon não deve ser usada como runtime. Não promover migration, schema ou deploy com base somente no bootstrap Development.

## 3. Vercel — variáveis e deploy

O projeto Vercel iam-control-center está no plano Hobby e usa Next.js / Node 24.x.

**Elegibilidade comercial:** a auditoria histórica da PR #45 registrou que o plano Hobby não é elegível para hospedagem de SaaS comercial. Essa condição deve ser reconfirmada nos termos vigentes da Vercel antes de qualquer uso comercial. Enquanto o projeto permanecer no plano Hobby/free, não promover Production nem oferecer o serviço comercialmente se isso contrariar os termos. Não fazer upgrade nem iniciar teste pago automaticamente.

Metadados de variáveis consultados sem descriptografar valores:
- AUTH0_DOMAIN e AUTH0_CLIENT_ID: configuração não secreta nos três ambientes.
- AUTH0_CLIENT_SECRET e AUTH0_SECRET: secrets separados por Development, Preview e Production.
- APP_BASE_URL: localhost em Development, domínio vercel.app em Production e Preview limitado à branch fix/next16-proxy-r2.
- DATABASE_URL: entradas em Development, Preview e Production.
- DATABASE_MIGRATION_URL: entradas em Development e Preview; não há entrada de Production.
- NEON_PROJECT_ID: Development e Preview; não configurado em Production.

A presença de uma variável não prova validade, conectividade ou correspondência correta do endpoint. Valores de secrets não foram lidos nem exibidos.

A Vercel recusou novas deployments por limite gratuito diário (build-rate-limit). Não solicitar upgrade e não repetir builds até a janela gratuita permitir. Builds de Preview ausentes devem ser classificados como BLOCKED, não como falha de código nem PASS.

## 4. Auth0 — identidade e evidência

Auth0 permanece o único IdP. O SDK v4 deve obter a sessão no servidor; identidade externa é o par issuer + subject. E-mail é dado de perfil, não chave primária de identidade ou autorização.

A PR #55 possui execução E2E real de Auth0 no Preview:
- SHA: 678dbcf595937625e98974db787e189d9d8b81b2.
- Workflow: run 41562860012.
- Job auth0-e2e: SUCCESS.
- O run incluiu login/callback/sessão/logout e preflight de Trusted Sources conforme os logs do job.

Essa evidência vale somente para o SHA e o Preview testados. Não comprova que todas as configurações Auth0, todos os ambientes ou os callbacks de Production estejam corretos. Não houve leitura direta do dashboard Auth0 nesta sessão; callbacks, logout URLs, web origins e conexões devem ser confirmados no tenant antes de qualquer promoção.

## 5. Arquitetura-alvo

### Fronteira de identidade

1. Auth0 autentica o usuário e emite a sessão OIDC.
2. O servidor valida a sessão por meio do SDK Auth0.
3. A identidade durável é resolvida por issuer + subject.
4. O backend resolve identity e membership ativo no PostgreSQL.
5. Tenant selecionado, membership e permissões são validados no servidor.
6. GUC isolado ou tenant_id fornecido pelo cliente não autoriza acesso.
7. Queries utilizam login runtime dedicado, nunca Iam-control-center_owner, iam_owner ou iam_migrator.

### Conexão PostgreSQL

- O runtime deve usar o módulo server-only e @neondatabase/serverless.
- DATABASE_URL é exclusiva do runtime; não expor ao bundle cliente.
- DATABASE_MIGRATION_URL deve permanecer separada e não pode ser acessada pelo runtime web.
- Não habilitar pooler até validar prepared statements, transações, estado de sessão, advisory locks e comportamento do driver.
- Não instanciar cliente/pool por request sem estratégia de ciclo de vida adequada.
- Não adicionar ORM nem executor de migration sem ADR/revisão própria.

### Autorização e RLS

A baseline 0001 mantém default-deny: ainda não existem grants/policies de runtime para dados IAM. O contexto de tenant precisa de mecanismo confiável, validade, revogação e validação na própria operação. A assinatura de contexto não substitui a consulta de identity, membership e tenant ativos.

## 6. Gates antes de qualquer migration

| Ordem | Trabalho | Evidência exigida | Estado |
|---|---|---|---|
| 1 | Cliente Neon server-only | Dependência, módulo e testes unitários mockados | PASS parcial |
| 2 | Query PostgreSQL real descartável | SELECT 1, timeout e erro de conexão | Pendente |
| 3 | Credenciais dedicadas Development | Autenticação real como iam_migrator_login e iam_app_runtime_login | BLOCKED |
| 4 | Ownership e migration 0001 | SQL revisado, checksum, preflight, rollback | Pendente |
| 5 | Runtime grants e RLS | Testes com role runtime autenticada e cross-tenant | Pendente |
| 6 | Auth0 + API | 401/403, membership revogado, tenant suspenso | Parcial |
| 7 | Preview | Deployment, SHA, health e conexão runtime | BLOCKED por limite Vercel |
| 8 | Production | Aprovação específica, recuperação e rollback ensaiado | Não autorizado |

## 7. CI e evidências

- PR #55: Auth0 E2E PASS no SHA indicado acima.
- PR #57 + #80: quality e testes PostgreSQL 18 descartáveis PASS no SHA bed63d16ef7da090e08d369b2413cf61a3a41914; Preview falhou exclusivamente no status Vercel por build-rate-limit.
- PR #74: harness PostgreSQL 18 descartável 16/16 PASS local no SHA ef3667e1733ebc4b40dede211cb9115ff867c317; não prova crypto ou RLS no Neon.
- PR #69: driver Neon e factory server-only implementados, mas sem query real.

Cada conclusão deve apontar SHA, run ID, job, ambiente e artefato. CI PostgreSQL descartável não prova credenciais, grants, TLS, pooling ou RLS no Neon.

## 8. Decisão atual

**Integração Auth0 + Neon: PARCIAL. Migration executável: BLOCKED.**

Auth0 permanece como IdP. Neon permanece como PostgreSQL. O bootstrap de roles existe somente em Development, mas os LOGINs não possuem credenciais e a migration 0001 não foi executada. O cliente Neon está implementado como scaffold server-only, mas não executa query real. Preview está bloqueado por limite gratuito de deployment; Production não foi alterada.

Próximas ações permitidas: continuar revisão de código e testes em branches Draft, preparar teste PostgreSQL descartável e atualizar a cadeia de PRs. Provisionamento de credenciais, execução da migration em Neon, alteração de roles, mudança de pooler e deploy Production exigem autorização específica separada.


## 9. Adendo de reconciliação de identidade Neon — 03/11/2026

A consulta mais recente identificou dois projetos Neon ativos. A variável Vercel `NEON_PROJECT_ID` aponta para `floral-surf-85783683` em Development e Preview, enquanto este documento e a operação SQL de roles referem-se a `wandering-wildflower-90908845`. Não assumir que os endpoints `DATABASE_URL` apontam para o mesmo projeto sem validar a identidade da conexão. A decisão de projeto canônico está BLOCKED até reconciliação explícita.

A inspeção read-only de `wandering-wildflower-90908845` / Development confirmou os atributos catalogais e memberships da topologia IAM proposta, ACLs de database restritas e ausência dos schemas/tabelas IAM. Entretanto, tentativas de conexão como `iam_migrator_login` e `iam_app_runtime_login` retornaram `missing authentication credentials: required password`. Portanto, a topologia de roles está confirmada, mas a autenticação real permanece BLOCKED.

Importante: o campo `authentication_method` da API administrativa Neon não deve ser usado como substituto dos atributos SQL `pg_roles.rolcanlogin` e `rolinherit`. Use consultas catalogais read-only para essas afirmações.

Detalhes, IDs de branches e evidências: [neon-project-identity-reconciliation.md](./neon-project-identity-reconciliation.md).


## 10. Decisão canônica e reconciliação pós-seleção — 03/11/2026

O usuário confirmou `wandering-wildflower-90908845` como projeto Neon canônico. Essa decisão substitui o status “decisão de identidade BLOCKED” descrito no adendo da seção 9. A arquitetura de identidade está decidida; a configuração operacional da aplicação ainda não está alinhada.

### 10.1 Divergência Vercel ainda ativa

Consulta de metadados Vercel com `decrypt=false` confirmou:
- `NEON_PROJECT_ID=floral-surf-85783683` nos ambientes Development e Preview.
- Nenhuma variável `NEON_PROJECT_ID` em Production.
- `DATABASE_URL` existe em Development, Preview e Production; `DATABASE_MIGRATION_URL` existe em Development e Preview. Os valores secretos não foram descriptografados, portanto a identidade de projeto/branch desses endpoints não está confirmada por esta consulta.

Resultado: **BLOCKED — roteamento ainda aponta para o projeto antigo em Development e Preview**. Não afirmar que o app está conectado ao projeto canônico até corrigir e testar as conexões.

### 10.2 Estado de roles por branch

Read-only SQL em `wandering-wildflower-90908845` confirmou em Development as cinco roles IAM, seus atributos `pg_roles` e memberships documentadas na seção 2.1. Em Preview, a API de roles retornou somente `Iam-control-center_owner`; consulta catalogal confirmou que as roles IAM e schemas `iam`, `audit` e `app_private` estão ausentes. Portanto, Preview ainda requer bootstrap próprio, que não foi executado.

As consultas de autenticação como `iam_migrator_login` e `iam_app_runtime_login` anteriormente retornaram `missing authentication credentials: required password`. A autenticação real continua **BLOCKED**.

### 10.3 Limite de execução

Nenhuma alteração foi feita em Vercel, Neon ou Auth0. O próximo passo operacional é obter aprovação específica para atualizar `NEON_PROJECT_ID` em Development e Preview e alinhar os endpoints secretos com as branches Development e Preview do projeto canônico. Não alterar Production, não descriptografar/exibir secrets, não executar migrations e não habilitar Neon Auth. Auth0 continua sendo o único provedor de identidade.

## 11. Read-back atual — 04/11/2026

O read-back Vercel com `decrypt=false` confirmou `NEON_PROJECT_ID=wandering-wildflower-90908845` em Development e Preview; Production não possui essa variável. `DATABASE_URL` existe nos três ambientes, mas seus valores não foram descriptografados e a identidade dos endpoints permanece NOT VERIFIED. `DATABASE_MIGRATION_URL` não foi retornada na listagem atual e está classificada NOT CONFIGURED neste snapshot. A topologia do projeto Neon canônico (Production → Development, com Preview e recovery existentes) foi confirmada em leitura somente.

A variável `NEON_PROJECT_ID` do GitHub Actions é independente da variável Vercel e continua NOT VERIFIED; confirmar seu valor canônico antes de ativar o workflow privilegiado da PR #56. Nenhuma migration, credencial, role, secret ou configuração Production foi alterada. Consulte [neon-project-identity-reconciliation.md](./neon-project-identity-reconciliation.md) para IDs e estado das branches.

## 12. Atualização de identidade Neon — `iam-database-delivery` — 08/11/2026

A decisão operacional vigente para a entrega do banco IAM é o projeto `iam-database-delivery` (`twilight-fire-88497009`, `aws-sa-east-1`, PostgreSQL 18, plano Free). A escolha foi confirmada pelo usuário e conferida por leitura da API Neon.

- Branch default: `main` (`br-little-fire-b6adup9f`), READY.
- Development: `br-proud-brook-b6woqo6z`, READY, filha direta de `main`.
- Preview: `br-lingering-art-b6lzio6z`, READY, filha direta de `main`.
- Endpoint da branch main: `ep-twilight-shadow-b618ef5h`.
- Database: `iam_database`; owner: `iam_database_owner`.
- Login de migration esperado: `iam_migrator_login`; sua existência na API não comprova autenticação real ou atributos SQL.
- O endpoint principal reporta `pooler_enabled=false`; não utilizar hostname `-pooler` nem assumir PgBouncer.

O projeto `wandering-wildflower-90908845` e as referências deste documento às decisões de 03–04/11/2026 são registros históricos de uma topologia anterior. Não são o alvo da automação de entrega do banco após a decisão de 08/11/2026.

O projeto de destino está no limite atual do plano Free: 10 branches para um limite de 10. O lifecycle deve falhar fechado quando precisar criar outra branch, sem apagar branches existentes automaticamente. A criação de branch de PR depende de liberar capacidade por processo operacional revisado.

Esta atualização não executou migration, DDL, GRANT, alteração de dados, troca de senha, alteração de secret ou deploy. Auth0 continua sendo o único provedor OIDC.
