# IAM / PEOS — Solicitação de autorização operacional independente: lease Auth0/Preview para PR #121

**Data de levantamento:** 2026-11-17 (UTC). **Estado:** `REQUESTED_NOT_APPROVED`.
**Natureza:** documento de solicitação e plano de execução; **não** é aprovação, execução, concessão de privilégios, alteração de callback ou autorização de merge. **Não mesclar esta PR documental em `main`**: após decisão formal, encerrar sem merge preservando evidências.

## 1. Escopo imutável solicitado

| Identificador | Valor confirmado |
|---|---|
| Repositório | `alexoaraujo/iam-control-center-new` |
| PR que precisa de E2E | [#121](https://github.com/alexoaraujo/iam-control-center-new/pull/121), **Draft**, stacked sobre [#119](https://github.com/alexoaraujo/iam-control-center-new/pull/119) |
| HEAD de #121 | `55dac1c52e3b9d453d2a8db4c5c2efb2ca1ff4c7` |
| Branch de #121 | `experiment/bun-native-tests-picomatch-removal-20261117` |
| Base HEAD de #119 | `da387c510301b1af686d46f2760c522792ab5f26` |
| `main` observada | `17a4e86fddecc02c4326049fdf3d95fea6f4e522`, com `protect-main` |
| Vercel project/team | `prj_OnuwD1iarOsXh6FFGkSpK4A5mj80` / `aoa4` |
| Callback aprovado por **verificar**, não presumir | `https://iam-control-center-new-ci-preview.vercel.app/auth/callback` (exigir readback da aplicação Auth0 real) |
| Domínio callback fixo da CI | `iam-control-center-new-ci-preview.vercel.app` |
| Domínio Preview complementar | `iam-control-center-new-preview.vercel.app` |
| Deployment **alvo** Preview | `dpl_Dnd9G351VE9Au4sm5kwYsPq92h4V`, `READY`, SHA de #121, branch de #121 |
| URL imutável do alvo | `iam-control-center-j1dxsijk5-aoa4.vercel.app` |

Este documento não amplia a aprovação histórica das PRs [#112](https://github.com/alexoaraujo/iam-control-center-new/pull/112), [#114](https://github.com/alexoaraujo/iam-control-center-new/pull/114) e [#115](https://github.com/alexoaraujo/iam-control-center-new/pull/115); os SHAs e destinatários são outros.

## 2. Snapshot de rollback — Vercel autenticado, somente leitura

| Controle | Snapshot efetivo verificado |
|---|---|
| Project Domain callback | `iam-control-center-new-ci-preview.vercel.app` → `gitBranch=feat/iam-api-rbac-lineage-20261110`, `verified=true` |
| Project Domain Preview | `iam-control-center-new-preview.vercel.app` → `gitBranch=feat/iam-api-rbac-lineage-20261110`, `verified=true` |
| Alias callback → deployment | `dpl_4GGwBNDRGtVZHdkhF7kSB8GZsvee` |
| Alias Preview → deployment | `dpl_4GGwBNDRGtVZHdkhF7kSB8GZsvee` |
| Baseline READY metadata | `feat/iam-api-rbac-lineage-20261110` / SHA `17a4e86fddecc02c4326049fdf3d95fea6f4e522` |
| Env Preview específica para branch #121 | `APP_BASE_URL`, `E2E_CALLBACK_HOST`, `E2E_CALLBACK_BRANCH`: **nenhuma entrada `gitBranch=experiment/bun-native-tests-picomatch-removal-20261117` no inventário** |
| Auth0 tenant allowlist atual | **UNVERIFIED** — não há leitura autenticada da aplicação Auth0 nesta solicitação |
| Vercel OIDC Trusted Source cloud-side | **UNVERIFIED** — sem leitura da política efetiva de confiança |
| Protection bypass | **PROIBIDO** modificar ou publicar tokens/links de bypass; exige OIDC esperado |

**Snapshot auditável por Vercel API:** `GET /v9/projects/{projectId}/domains/{domain}`, `GET /v4/aliases/{host}`, `GET /v13/deployments/{deploymentId}`, `GET /v10/projects/{projectId}/env?decrypt=false`. Logs protegidos, headers e valores secretos não devem ser copiados para GitHub. Snapshot anterior da #114 registra deployment antigo `dpl_AHt58...`; **não reutilizar** como baseline atual: este snapshot prevalece para um eventual lease de #121, depois de novo readback no instante da autorização.

## 3. O que a CI já provou e o que NÃO provou

[CI #44166210440](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44166210440): no SHA #121, `quality=SUCCESS`, `pnpm audit=PASS` (sem waiver), **97/97** testes de app Bun, 126/126 contratos Node, lint, typecheck e Next build PASS. [Deployment guard #44166210218](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44166210218) SUCCESS. [Bun proof #44166210337](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44166210337) SUCCESS. [PG18 #44166210246](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44166210246) SUCCESS **como workflow separado**.

**Falha efetiva:** `sync-auth0-preview=FAIL` no [job #134333500953](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44166210440/job/134333500953), texto: `Auth0-sensitive changes require a separately authorized callback branch; refusing to skip E2E`. `auth0-e2e=SKIPPED`, **CI `security-gate=FAIL`**. Não converter SKIPPED ou o PG18 homônimo em PASS da CI integrada.

Contrato fonte: [scripts/sync-auth0-e2e-preview.mjs](https://github.com/alexoaraujo/iam-control-center-new/blob/55dac1c52e3b9d453d2a8db4c5c2efb2ca1ff4c7/scripts/sync-auth0-e2e-preview.mjs) valida branch, domínio, quatro variáveis Preview em texto plano, alias, `READY` e deployment do exato SHA. Há prevenção intencional de bypass para arquivos `apps/web/`.

## 4. Cinco preflight controls — bloquear até evidência atual

- [ ] `auth0_callback_allowlist_verified`: leitor autenticado à aplicação **IAM Control Center Web** no tenant `iam-control-center.us.auth0.com` comprova, sem segredos, Allowed Callback URLs contendo exatamente a URI de callback acima; identifica `client_id` apenas por referência privada ou digest e confirma Allowed Logout URLs conforme fluxo.
- [ ] `github_environment_custody_verified`: configuração efetiva do environment protegido `Preview` (reviewers, branches, GitHub secrets só **nomes**, job autorizado e permissões) verificada com fonte/ID; segredo e senha jamais expostos.
- [ ] `oidc_trusted_source_verified`: política cloud-side Vercel Trusted Sources e GitHub OIDC para issuer `https://token.actions.githubusercontent.com`, audience `https://github.com/alexoaraujo`, subject imutável `repo:alexoaraujo@325264809/iam-control-center-new@1451861889:environment:Preview` **comprovados por readback**, mais controle negativo de requisição anônima.
- [ ] `no_concurrent_lease_jobs`: consultar GitHub Actions e locks/automação externa antes e durante a janela UTC; exclusão mútua do callback compartilhado entre #112/#114/#115/#121 e jobs externos confirmada. Consultas parciais de GitHub não atestam exclusão global.
- [ ] `rollback_operator_identified`: operador **humano independente do executor** indicado por identidade verificável, aceitou pessoalmente com review e demonstrou acesso para restaurar project domains, aliases e env Preview; janela UTC **futura** e duração limitada, mais contato e plano de emergência.

**Nenhum dos cinco itens pode ser convertido em `true` pelo autor desta solicitação.** Uma review de código aprovada não substitui autorização operacional. Ausência de evidência = `BLOCKED`.

## 5. Plano de operação condicionado à aprovação

1. **Novo snapshot/freeze:** revalidar HEAD de #121, domínio e aliases Vercel, Auth0 allowlist, environment `Preview`, claims OIDC, estado das PRs e ausência de lease concorrente. Se qualquer SHA mudar, **revogar a autorização do SHA anterior** e emitir nova review.
2. **Preparo específico da branch, sem tocar Production:** somente após aprovação independente, configurar no Vercel Preview variáveis do tipo `plain`, `gitBranch=experiment/bun-native-tests-picomatch-removal-20261117`:
   - `APP_BASE_URL=https://iam-control-center-new-ci-preview.vercel.app`
   - `E2E_CALLBACK_HOST=iam-control-center-new-ci-preview.vercel.app`
   - `E2E_CALLBACK_BRANCH=experiment/bun-native-tests-picomatch-removal-20261117`.
   Confirmar `AUTH0_DOMAIN=iam-control-center.us.auth0.com` e que credenciais Auth0 Preview já estão em custódia protegida; **não copiar, rotacionar nem imprimir secrets**. Revalidar `APP_BASE_URL` no deployment do SHA exato, reconstruindo Preview da mesma revisão se variáveis de build exigirem.
3. **Lease temporário controlado:** atribuir project domain callback e alias callback para **a mesma branch e deployment READY SHA #121** (outros domínios somente se exigidos e explicitamente autorizados). Reavaliar `GET /domains`, `GET /aliases`, `GET /deployments` antes de execução; a atribuição automática por Vercel não dispensa readback.
4. **Executar CI no mesmo SHA, sem commit de disparo** (por exemplo, `Re-run all jobs` do workflow de PR apropriado). Exigir `sync-auth0-preview=SUCCESS`, `auth0-e2e=SUCCESS` com identidade Auth0 real e controles negativos OIDC, `quality=SUCCESS`, `security-gate` **integrado SUCCESS**; trilha PG18/RLS e, se necessária, fixture Neon isolada grant→HTTP200/revoke→HTTP403 com cleanup; nunca declarar resultado de suíte sintética como E2E real.
5. **Rollback SEMPRE, mesmo em falha:** restaurar `gitBranch=feat/iam-api-rbac-lineage-20261110` dos project domains modificados; restaurar ambos aliases ao **baseline verificado no início do lease**, atualmente `dpl_4GGwBNDRGtVZHdkhF7kSB8GZsvee` (não usar ID antigo da #114); remover apenas overrides de Preview criados para #121 **após** a trilha E2E; provar por novo readback que domínio, aliases, deployment SHA, isolamento e proteção voltaram ao estado original. Registrar operador, UTC, status e links.
6. **Encerramento:** anexar logs sanitizados, eventos de revisão, artefatos e rollback. O lease **não autoriza** merge #121/#119: ainda precisam de revisão independente do `test-preload.ts`, cadeia do executável Bun e paridade das 86 regras ESLint→Biome, além de `protect-main` sem bypass.

**Se qualquer readback divergir, interromper o lease, executar rollback e marcar `BLOCKED`; não prosseguir com E2E em alias compartilhado.**

## 6. Texto-modelo de aprovação para revisor independente

**Modelo, NÃO publicar como aprovado antes dos cinco controles serem efetivamente verdadeiros:**

```text
IAM_PR121_AUTH0_PREVIEW_LEASE_APPROVED
decision=APPROVE_ONCE_ONLY
repo=alexoaraujo/iam-control-center-new
pr=121
pr_head_sha=55dac1c52e3b9d453d2a8db4c5c2efb2ca1ff4c7
pr_branch=experiment/bun-native-tests-picomatch-removal-20261117
vercel_project_id=prj_OnuwD1iarOsXh6FFGkSpK4A5mj80
callback_host=iam-control-center-new-ci-preview.vercel.app
target_deployment=dpl_Dnd9G351VE9Au4sm5kwYsPq92h4V
rollback_baseline_deployment=<revalidated ID just before lease>
auth0_callback_allowlist_verified=<true ONLY with authenticated evidence ID>
github_environment_custody_verified=<true ONLY with authenticated evidence ID>
oidc_trusted_source_verified=<true ONLY with authenticated evidence ID>
no_concurrent_lease_jobs=<true ONLY with global evidence ID>
rollback_operator_identified=<true ONLY with named independent operator + acceptance ID>
auth0_evidence_id=<real authenticated ID>
github_environment_evidence_id=<real authenticated ID>
vercel_oidc_evidence_id=<real authenticated ID>
lease_lock_evidence_id=<real ID>
rollback_operator=<independent person, distinct from executor>
rollback_operator_acceptance_id=<real review or signed attestation ID>
window_start_utc=<future ISO8601>
window_end_utc=<future ISO8601>
executor=<named authorized operator>
rollback_procedure=restore_branch_domain_and_aliases_verify_readback
secrets_disclosed=false
production_authorized=false
main_merge_authorized=false
```

**Postar como review GitHub `APPROVE` com identidade independente e horário da janela; a review deve vincular exatamente a PR #121 e seu SHA, anexando IDs de evidência.** Não representar placeholders ou o próprio autor da solicitação como aprovação independente.

**Status ao registrar:** `AUTH0_LEASE=BLOCKED_PENDING_INDEPENDENT_APPROVAL`, `AUTH0_E2E=NOT_RUN_FOR_PR121`, `MERGE_MAIN=BLOCKED`, `PRODUCTION=UNCHANGED`.
