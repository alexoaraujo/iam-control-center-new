# Evidências de validação técnica — 31/10/2026

## Escopo e limites

Este registro consolida evidências do repositório `alexoaraujo83/iam-control-center`, da branch `fix/next16-proxy-r2`, e dos ambientes de Preview e Neon consultados durante a validação.

- Política de custo: manter GitHub Free, Auth0 Free, Neon Free e Vercel Hobby.
- Nenhuma migration foi aplicada nesta validação.
- Nenhuma alteração foi feita na branch `main`, em secrets, no Auth0 ou no Neon Production.
- Nenhum deployment foi promovido para Production.
- A branch e os PRs permanecem em revisão; CI verde não equivale a autorização para merge ou release.

## GitHub — evidência por commit

| Item | Resultado |
|---|---|
| Repositório | `alexoaraujo83/iam-control-center` |
| Branch | `fix/next16-proxy-r2` |
| SHA examinado | `f3e9fdd93f84d1118fd0ff38b0cdda8f20c54ece` |
| PR | [#55 — migração Auth0 para proxy do Next.js 16](https://github.com/alexoaraujo83/iam-control-center/pull/55) |
| Workflow | [CI #41252437301](https://github.com/alexoaraujo83/iam-control-center/actions/runs/41252437301) |
| `quality` | SUCCESS — install congelado, audit, lint, typecheck, testes e build |
| `preview-deployment` | SUCCESS |
| `auth0-e2e` | SKIPPED — não contabilizar como PASS |
| Estado do PR | Draft / aberto / não mergeado |

A execução mais recente foi concluída em 31/10/2026 às 23:25 UTC. O job `auth0-e2e` depende da variável de repositório `AUTH0_E2E_ENABLED=true` e de secrets de usuário de teste e bypass do Preview. A execução não demonstrou login interativo, callback, persistência de sessão ou logout.

A PR #48 é a base da cadeia de dependências e permanece Draft. O SHA da #55 deriva da base reconciliada. A branch `main` não recebeu essas correções; não declarar a vulnerabilidade de dependências resolvida em `main` até a promoção controlada e a nova validação dessa branch.

## Vercel — Preview

O comentário automático da Vercel na PR #55 reportou deployment Preview em estado **Ready**, associado ao projeto `iam-control-center` e ao domínio:

- https://iam-control-center-preview.vercel.app

O job `preview-deployment` passou para o SHA registrado acima. Isso comprova a conclusão do deploy de Preview, não a funcionalidade completa da aplicação.

Smoke tests GET feitos anteriormente no Preview demonstraram:
- `/` → HTTP 200;
- `/api/health` → HTTP 200;
- `/auth/login` → redirecionamento HTTP 307 para o tenant Auth0;
- `/auth/logout` → redirecionamento HTTP 307 para o fluxo OIDC de logout.

Esses smoke tests não comprovam autenticação interativa nem devem ser tratados como teste E2E do SHA atual sem reexecução vinculada ao SHA. O plano Vercel identificado para o projeto é Hobby. O Hobby é destinado a uso pessoal e não comercial; a elegibilidade depende do uso efetivo do projeto.

## Auth0 — estado da integração

O código contém:
- cliente server-side em `apps/web/src/lib/auth0.ts`;
- proxy Next.js 16 em `apps/web/src/proxy.ts`, delegando para `auth0.middleware(request)`;
- rota protegida `/protected`, que chama `auth0.getSession()` e redireciona sessão ausente para login;
- testes unitários para delegação do proxy e proteção da página.

O teste Playwright de login/callback/sessão/logout está preparado, mas o job foi **SKIPPED** na execução registrada. A configuração do tenant Auth0 e suas allowlists não foram verificadas diretamente no Dashboard nesta execução. Portanto, o fluxo OIDC real permanece **PENDENTE**.

## Neon PostgreSQL — estado e bloqueios

Projeto Neon identificado: `iam-control-center`, PostgreSQL 18, região `aws-sa-east-1`.

Consultas somente de leitura foram feitas em branches não produtivas:
- `development`: schema `iam` sem tabelas e sem `iam.schema_migrations`;
- branches de revisão/teste: schema `iam` presente, tabelas multi-tenant com RLS habilitado e FORCE RLS;
- `iam.schema_migrations` existe nas branches de revisão/teste, porém está vazia.

A migration versionada em `database/migrations/0001_initial_iam_schema.sql` cria tabelas e policies cuja função `app_private.current_tenant_id()` lê o GUC `app.tenant_id`. Um GUC customizado pode ser alterado pela própria sessão SQL; portanto, essa policy, isoladamente, não garante isolamento forte contra SQL arbitrário executado pela role de runtime.

A RFC `docs/architecture/tenant-context-rfc.md` registra contexto assinado e verificado no banco como proposta, ainda não implementada nem aprovada.

A conexão do conector Neon estava fixada na role `Administrador`; a tentativa de selecionar `iam_app_runtime_dev_safe` ou `iam_app_runtime` foi rejeitada. As roles de teste observadas com `BYPASSRLS=true` não servem como prova de isolamento. Não foi possível concluir teste de isolamento positivo/negativo usando a role efetiva da aplicação. Não há integração real do driver Neon no runtime da aplicação neste estado.

**Não executar a migration em Development compartilhado, Preview, Test, Review ou Production até que o alvo seja explicitamente autorizado e os gates de segurança sejam concluídos.** A validação descrita não realizou escrita no banco nem acessou a branch Production.

## Matriz de aceitação atual

| Requisito | Estado | Evidência / pendência |
|---|---|---|
| Instalação congelada e auditoria de dependências | PASS no SHA documentado | CI #41252437301 |
| Lint, TypeScript, testes unitários e build | PASS no SHA documentado | Job `quality` |
| Deploy de Preview | PASS no SHA documentado | Job `preview-deployment` e status Vercel |
| Smoke test de rotas públicas e redirects | PASS em execução anterior | Não é E2E e não prova o SHA atual |
| Login Auth0 interativo | PENDENTE | Job E2E skipped |
| Callback OIDC e sessão persistente | PENDENTE | Job E2E skipped |
| Logout e invalidação da sessão | PENDENTE | Job E2E skipped |
| Autorização por tenant/RBAC | PENDENTE | Não implementada/validada ponta a ponta |
| Driver Neon e query real na aplicação | PENDENTE | Runtime ainda sem integração real |
| Migration aplicada e registrada | PENDENTE | Nenhuma migration executada |
| Isolamento RLS com role runtime sem BYPASSRLS | BLOQUEADO | Role efetiva não validada; contexto GUC é falsificável |
| Teste cruzado tenant A/B | BLOQUEADO | Exige contexto confiável e role efetiva |
| Promoção para `main` | BLOQUEADA | Segurança e validação funcional incompletas |
| Deploy Production | BLOQUEADO | Não autorizado nesta etapa |

## Próximas atividades documentais e técnicas

1. Habilitar o E2E somente após configurar manualmente usuário de teste dedicado, secrets e allowlists exatas do Auth0 e do Preview; executar e registrar o resultado no SHA atualizado.
2. Documentar e implementar, em branch isolada, a integração real do SDK Auth0 v4 e do driver `@neondatabase/serverless`, sem expor credenciais.
3. Revisar a RFC de contexto confiável de tenant e projetar o verificador criptográfico no PostgreSQL, incluindo rotação de chaves, privilégios mínimos e falha segura.
4. Preparar harness de integração Neon em branch descartável, com role de runtime real, `NOBYPASSRLS`, e testes positivos e negativos entre tenants.
5. Versionar e testar migrations com checksum e rollback/recovery documentados, exclusivamente em branch de teste isolada após autorização.
6. Atualizar evidências por SHA, reexecutar CI e Preview e só então submeter a cadeia para revisão de merge.
7. Antes de qualquer merge em `main`, verificar explicitamente os gatilhos de Production da Vercel e a elegibilidade comercial do plano Hobby.

## Regra de status

- **PASS**: teste realmente executado, concluído com sucesso e vinculado ao SHA/ambiente indicados.
- **SKIPPED / NOT RUN**: teste não executado; nunca equivale a PASS.
- **PENDENTE**: falta evidência ou implementação.
- **BLOQUEADO**: existe risco ou dependência de segurança que impede prosseguir.


## Atualização de evidências — 01/11/2026

A atualização abaixo corrige o status do último workflow conhecido e diferencia o commit validado do material documental adicionado posteriormente.

| Item | Resultado |
|---|---|
| Commit validado pelo workflow | `6f5d625201d1cfea17364ecada000f897075948a` |
| Workflow | [CI #41257983546](https://github.com/alexoaraujo83/iam-control-center/actions/runs/41257983546) |
| Job quality | SUCCESS — install, audit, lint, typecheck, testes e build |
| Job preview-deployment | SKIPPED |
| Job auth0-e2e | SKIPPED |
| Deployment Vercel | READY — Preview, SHA `6f5d625201d1cfea17364ecada000f897075948a` |
| URL Preview | https://iam-control-center-ebfjk5e2b-alexoaraujo83-8387s-projects.vercel.app |
| Alias Preview | https://iam-control-center-preview.vercel.app |

O status READY foi consultado diretamente no deployment Vercel e está associado ao SHA acima. O job preview-deployment do workflow #41257983546 foi SKIPPED; não o classificar como PASS. O job auth0-e2e também foi SKIPPED. Assim, somente o job quality foi aprovado neste workflow.

Depois desse SHA foram adicionados os guias:
- `docs/auth/auth0-free-nextjs16.md`
- `docs/database/neon-free-nextjs.md`

Esses commits documentais ainda precisam de CI vinculado ao HEAD mais recente. Não inferir que o CI #41257983546 validou esses arquivos. A documentação não instalou o driver Neon, não alterou runtime, não aplicou migrations e não configurou tenant/secrets Auth0.

## Estado da PR após a atualização

PR #55 permanece aberta, Draft, não mergeada. O HEAD informado após a inclusão dos dois guias é `7b452a4409922619ebc33ac0a33c3c32479cd6cb`. A branch não deve ser marcada Ready até CI completo e revisão técnica dos bloqueios Auth0/RLS. Nenhuma alteração em Production foi autorizada ou realizada.
