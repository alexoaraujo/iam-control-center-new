# Validação operacional inicial — 2026-10-31

**Repositório:** `alexoaraujo83/iam-control-center`  
**Branch-base inspecionada:** `main`  
**SHA inspecionado:** `c0323194be7962cd9a641418e0746715a8bf2b82`  
**Status:** inspeção de código, evidência CI/Vercel e metadados Neon concluída; validação operacional completa BLOQUEADA.  
**Escopo:** somente leitura e testes HTTP em deployment Preview; sem alterações de produção, migrations, secrets ou recursos de infraestrutura.

## 1. Ambiente e reprodutibilidade local

O monorepo contém `apps/web`, workspace pnpm e lockfile.

| Item | Versão/estado encontrado |
|---|---|
| Node.js requerido | 24.x (`.node-version` = 24; `engines` >=24 <25) |
| pnpm | 10.12.1 |
| Next.js | 15.5.28 |
| React / React DOM | 19.1.10 |
| TypeScript | 5.8.3 |
| Auth0 SDK | @auth0/nextjs-auth0 4.33.0 |
| Vitest | 4.1.12 |

Ambiente local desta execução: Node v22.16.0, Corepack 0.32.0, pnpm indisponível e resolução de DNS para GitHub indisponível. Como o projeto exige Node 24 e não foi possível obter pnpm/repositório por rede, **não foram executados localmente** `pnpm install`, lint, typecheck, Vitest ou build. Não se deve registrar esses itens como PASS.

## 2. GitHub Actions e evidência de build

- Workflow `.github/workflows/quality.yml`: instala com `pnpm install --frozen-lockfile`, executa `pnpm audit`, lint, typecheck, testes e build.
- A execução 40133195417 passou em todos os passos de qualidade, mas corresponde ao SHA antigo `c0b0d19a9bc95d888a8ee77cd986da80e78cdf6d`; não é evidência para o SHA atual.
- Para o SHA atual `c0323194be7962cd9a641418e0746715a8bf2b82`, a consulta de status retornou apenas o contexto Vercel success; não foi obtida evidência GitHub Actions vinculada a esse SHA.
- O PR #43 tentou corrigir minimatch, mas as execuções 41231833311 e 41231976780 falharam no passo `pnpm install --frozen-lockfile` com `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. Audit, lint, typecheck, testes e build foram skipped nesses runs.

## 3. Dependência vulnerável — BLOQUEIO

O lockfile da `main` contém `minimatch@10.2.6` e `minimatch@3.1.5`. O advisory GHSA-g3hv-75wg-m249 / CVE-2026-118764 afeta versões anteriores a 11.0.1 e descreve DoS por amplificação de padrões glob. A versão corrigida indicada é 11.0.1.

Referências:
- https://github.com/advisories/GHSA-g3hv-75wg-m249
- https://github.com/isaacs/minimatch/releases/tag/v11.0.1

O PR #43 está fechado sem merge e contém uma proposta de override para 11.0.1 e patch para `@eslint/eslintrc@3.3.1`, mas não é aprovável enquanto o lockfile não for regenerado de forma reproduzível e todos os gates passarem no SHA final. **Bloquear release/deploy até corrigir e validar.**

## 4. Auth0 — teste parcial do fluxo

Código encontrado na `main`:
- `apps/web/src/lib/auth0.ts`: instancia `Auth0Client` com variáveis de ambiente.
- `apps/web/src/middleware.ts`: chama `auth0.middleware(request)`.
- `apps/web/src/app/page.tsx`: links para `/auth/login` e `/auth/logout`.

Teste HTTP no deployment não-production associado ao SHA da `main`:
- `GET /api/health`: HTTP 200; JSON indica `authConfigured=true` e `databaseConfigured=true`.
- `GET /auth/login`: HTTP 307, redirecionando para o endpoint Auth0 com `response_type=code`, PKCE S256 e `redirect_uri` `https://iam-control-center-preview.vercel.app/auth/callback`. A resposta também definiu cookie de transação HttpOnly/Secure; o valor não foi registrado.

**Limites:** o health endpoint verifica somente presença de AUTH0_DOMAIN/AUTH0_CLIENT_ID e DATABASE_URL; não verifica client secret, AUTH0_SECRET, troca de código, sessão, logout ou conectividade PostgreSQL. O fluxo OIDC não foi completado com usuário de teste e não foi verificado no Dashboard Auth0.

### Divergência de callback Preview

A consulta de domínios Vercel associou `iam-control-center-preview.vercel.app` à branch `test/auth0-playwright-preview-e2e` (branch de PR #41, fechado sem merge). O login foi iniciado a partir de deployment da branch `main`, mas gerou callback para esse domínio de outra branch. Confirmar e corrigir `APP_BASE_URL`, callback/logout URLs e domínio de Preview por ambiente antes de E2E. Não usar wildcard de callback.

## 5. Vercel

- Projeto `iam-control-center` vinculado ao repositório; plano do time: Hobby.
- Deployment da `main`, SHA `c0323194be7962cd9a641418e0746715a8bf2b82`, estado READY, target não-production.
- Existe deployment Production READY para o mesmo SHA; foi apenas inspecionado, não acessado nem alterado.
- O build da `main` concluiu, incluindo lint/type validation e geração estática, mas registrou warnings do SDK Auth0/Jose: uso de `DecompressionStream` não suportado no Edge Runtime e dependência dinâmica crítica. Requer validação de runtime.
- O build também reporta scripts de instalação ignorados para `esbuild` e `unrs-resolver`; manter bloqueados até revisão específica e evidência de necessidade.
- Nenhum deploy, promoção, rollback, alteração de domínio ou variável foi executado.

O plano Hobby é limitado a uso pessoal/não comercial; confirmar elegibilidade antes de qualquer operação comercial.

## 6. Neon — leitura de metadados e catálogo

Organização/projeto encontrados em plano Free; projeto PostgreSQL 18, região `aws-sa-east-1`, limite lógico de 1 GiB por branch e limite informado de 10 branches.

Branches identificadas: `production`, `development`, `preview`, `iam-migration-v1-test-2026-10-27`, `iam-migration-v1-review-2026-10-27` e `rls-test-isolated-2026-10-26`.

- Development: database `iam_control_center`, sem tabelas.
- Preview: sem tabelas.
- Review: dez tabelas IAM/audit, sem linhas nas tabelas centrais consultadas.
- `iam.schema_migrations` no Review está vazia.
- Não foi encontrado arquivo SQL de migration versionado na `main`; `database/migrations/README.md` contém apenas instruções.

### RLS e roles no Review

- RLS enabled + forced em `iam.tenants`, `iam.memberships`, `iam.roles`, `iam.membership_roles`, `iam.role_permissions`, `iam.invitations` e `audit.events`.
- `iam.identities` e `iam.permissions` não têm RLS (tratadas como tabelas globais); `iam.schema_migrations` também não.
- As policies usam `app_private.current_tenant_id()`, que lê `current_setting('app.tenant_id', true)`. Um GUC customizado pode ser definido pela sessão; portanto, isso não é por si só uma identidade tenant confiável.
- `iam_app_runtime` e `iam_migrator` são NOLOGIN; `iam_owner` tem BYPASSRLS. O role de owner não pode ser usado como prova de RLS.
- Existe `iam_rls_test_login_clean` com LOGIN e sem BYPASSRLS, mas não foi comprovado que esteja ligado aos grants/contextos reais do runtime.
- Não foi executado teste cross-tenant nem query de aplicação; não foi obtida evidência de execução como a credencial efetiva do runtime.

**Resultado:** a estrutura de schema existe em branch de revisão, mas não é reproduzível a partir da `main`, a tabela de migrations não registra aplicação e o isolamento RLS não está aprovado.

## 7. Integração Neon na aplicação

O `apps/web/package.json` não declara driver PostgreSQL/Neon, ORM ou camada de repositório. O health endpoint somente verifica se `DATABASE_URL` não está vazio. Portanto `databaseConfigured=true` **não prova conexão**. Não foi executada consulta do app ao banco.

## 8. Estado por gate

| Gate | Resultado |
|---|---|
| Estrutura monorepo e versões | PASS documental |
| Build Vercel da main | PASS com warnings |
| GitHub Actions no SHA atual | BLOCKED / sem evidência vinculada |
| Instalação e testes locais | BLOCKED (Node 24/pnpm/rede indisponíveis neste executor) |
| Dependência minimatch | FAIL / vulnerabilidade conhecida na main |
| Auth0 SDK e início de login | PASS parcial (307 + PKCE) |
| Login/callback/logout E2E | BLOCKED |
| Callback Preview por ambiente | FAIL / domínio aponta para branch de teste diferente |
| Neon runtime connectivity | BLOCKED / sem driver nem consulta pelo app |
| Migration reproduzível | FAIL / SQL não versionado e ledger vazio |
| RLS cross-tenant como runtime | BLOCKED |
| Production | NÃO TESTADO; nenhuma alteração executada |

## 9. Próximas ações recomendadas

1. Corrigir minimatch para >=11.0.1, resolver o patch ESM do ESLint e regenerar lockfile com Node 24 + pnpm 10.12.1.
2. Obter CI PASS no SHA final; não reutilizar evidência antiga.
3. Alinhar `APP_BASE_URL` e callback do Auth0 ao domínio exato de cada Preview.
4. Completar login/callback/logout E2E com tenant e usuário de teste.
5. Implementar driver Neon e conexão server-side com role runtime não-owner.
6. Versionar migration revisada, aplicar somente em branch isolada e preencher ledger.
7. Corrigir/validar o modelo de tenant context; executar testes positivos e negativos com role efetiva não-BYPASSRLS.
8. Repetir build/CI e gerar bundle de evidências antes de qualquer aprovação de produção.

## 10. Ações executadas e não executadas

Executado: leitura do GitHub, consulta de metadados Vercel/Neon, leitura de catálogo PostgreSQL e duas requisições HTTP GET no deployment não-production da main (`/api/health` e `/auth/login`). O acesso HTTP criou/reutilizou link temporário de compartilhamento do deployment Preview, sujeito à expiração automática do provedor.

Não executado: instalação local, comandos de teste locais, login OIDC completo, consulta PostgreSQL pela aplicação, migrations, escrita de dados, alteração de secrets/configurações, criação/exclusão de recursos, deploy/rollback ou acesso ao deployment Production.

**Conclusão:** o scaffold compila e o início do fluxo Auth0 responde, mas a solução não está operacionalmente aprovada. A vulnerabilidade minimatch, o callback Preview apontando para branch diferente, a ausência de driver Neon/migrations reproduzíveis e a falta de teste RLS como runtime bloqueiam produção.
