# IAM — Solicitação formal de autorização de lease Auth0/Preview por SHA (PRs #98, #101 e #44)

**Status da solicitação: PENDING_INDEPENDENT_APPROVAL.** Este documento é um veículo de aprovação, **não** representa autorização concedida, evidência de E2E executado, nem requisito de merge automático. Não contém segredos e não executa operações.

## Identidades imutáveis e baseline verificada em 2026-11-17
- Repositório: `alexoaraujo/iam-control-center-new`
- `main` (não modificar): `17a4e86fddecc02c4326049fdf3d95fea6f4e522`
- Vercel team/projeto: `aoa4` / `prj_OnuwD1iarOsXh6FFGkSpK4A5mj80`
- Callback autorizado para investigação: `iam-control-center-new-ci-preview.vercel.app` (project domain `verified=true`; **Auth0 Allowed Callback URL deve ser confirmada com leitura autenticada ANTES de qualquer transferência**).
- Baseline Vercel `get_project_domain.gitBranch=feat/iam-api-rbac-lineage-20261110`.
- Baseline `get_alias.deploymentId=dpl_AHt58aoFXCAJXzkXngm2ZgrVS72w`; o domínio `iam-control-center-new-preview.vercel.app` compartilha a mesma origem.
- Production `iam-control-center-new.vercel.app` = `dpl_4sd7DPf8nnr5WuzieAkn2CZcbSq1`, deve permanecer inalterada.
- `protect-main` ID 26988310 ativo: `quality` + `security-gate`, 1 revisão, dismiss stale, main estrita.
- Neon fixture existente `tiny-rice-70320263/br-quiet-night-b6cfeq4j`, READY, expiração `2026-11-20T01:30:00Z`; **não é autorizada como fixture das novas PRs por esta solicitação**.
- Readback Vercel `decrypt=false` de #98, #101 e #44: nenhuma configuração Preview `gitBranch`-scoped específica detectada. A origem possui variáveis com proteção; não compartilhá-las às cegas.

## Escopos de lease separados; aprovação individual obrigatória

| Fase | PR e branch destino | HEAD EXATO aprovado apenas após revisão independente | READY Preview atual (referência volátil) | Marcador exigido |
|---|---|---|---|---|
| A | #98 `fix/iam-g1-b2-environment-reconciliation` | `19328a6a8191d64499edadbfae97f86f4d59a00a` | `dpl_8Wm9J7SnXguu4QYi4NVFaXzAiAP5` | `IAM_PR98_AUTH0_PREVIEW_LEASE_APPROVED` |
| B | #101 `feat/iam-g1-b2-readback-independent-gate` | `c8d8621e86c4e51a255e586b702cf21b2a76225c` | `dpl_7ziUJ1DEt1PKL9UQej7X2yNJ3gCL` | `IAM_PR101_AUTH0_PREVIEW_LEASE_APPROVED` |
| C | #44 `test/canonical-manifest-diff-gate-20261112` | `8bfc89730c45e8b4cf433115ef202148ae086057` | `dpl_ATvDKUtUWNzRFmvUNmwoAcC389MN` | `IAM_PR44_AUTH0_PREVIEW_LEASE_APPROVED` |

As fases são **sequenciais**, nunca paralelas. Alterar qualquer HEAD invalida o consentimento para aquela fase. `gitBranch`, `deploymentId` e variáveis devem ser relidos imediatamente antes/depois do lease; os deployments listados são apenas evidência de disponibilidade, não aprovação.

## Pré-condições de cada fase (todas obrigatórias)
1. Revisão independente do código e decisão explícita com o marcador e SHA exatos na **Review desta PR**, por revisor distinto do executor. Sem aprovação tácita por comentários do autor.
2. Confirmar no Auth0 por leitura autenticada o cliente *Regular Web App*, a Allowed Callback URL exata `https://iam-control-center-new-ci-preview.vercel.app/auth/callback`, Allowed Logout URLs e Allowed Web Origins; registrar apenas metadados não sensíveis. **Não ampliar callbacks com curingas** nem conceder `update:clients` ao audit M2M.
3. Confirmar no Vercel a origem pelo `get_project_domain`, `get_alias`, `get_deployment`, ausência de workflows dependentes em execução e Production baseline inalterada.
4. Preparar na branch destino os valores não sensíveis `AUTH0_DOMAIN=iam-control-center.us.auth0.com`, `E2E_CALLBACK_HOST`, `E2E_CALLBACK_BRANCH=<branch exata>`, `APP_BASE_URL=https://iam-control-center-new-ci-preview.vercel.app`, **e credenciais Auth0/Neon dedicadas somente em ambientes protegidos**, por operador com custódia. Validar `DATABASE_URL` e `AUTHZ_CONTEXT_SIGNING_KEY_HEX` por metadados `decrypt=false`, com Neon TESTE isolado, tenant/sub/roles não elevados e `NOBYPASSRLS`; nenhum segredo em docs/comentários/logs.
5. Confirmar que a configuração efetiva do Preview não herda `APP_BASE_URL` ou `DATABASE_URL` de outra branch. Após atualização, criar novo Preview READY para a **mesma SHA** caso o build anterior tenha env desatualizado.
6. Validar que o workflow no HEAD exato preserva checks `quality`, `security-gate`, Auth0 login real, Vercel Trusted Sources OIDC, identidade do deployment, rollback e controle negativo (OIDC ausente = bloqueado).

## Procedimento operacional por fase (executar SOMENTE após aprovação)
1. Congelar o HEAD de destino e guardar snapshot privado de domínio, aliases, deployment IDs, metadados Preview e status dos Actions; rejeitar jobs concorrentes.
2. Validar `preview-alias-lease-guard.mjs` com snapshot **before** verdadeiro; escopo e custódia checados sem decriptação.
3. Em operação controlada, configurar o `gitBranch` do project domain para a branch aprovada **e** atribuir o alias do callback a um Preview `READY` da **SHA exata**, no projeto certo. A ferramenta de atribuição de alias isolada **não basta** se o project domain continuar ligado à origem.
4. Validar o snapshot **leased**, as variáveis efetivas, o `get_deployment.meta.githubCommitSha` e o `get_alias.deploymentId`; falhar fechado e reverter se houver divergência.
5. Executar o **Auth0 E2E real da PR HEAD** com login/logout, OIDC protegido e origem callback idêntica ao Preview; se for ativado RBAC write/grant-revoke, usar fixture Neon sintética previamente autorizada, exigir HTTP 200→403 e cleanup 0/6. Proibir migrações de Production, DDL real e alteração de secrets G1/B2.
6. **Rollback obrigatório na mesma janela operacional**, mesmo após E2E FAIL: restaurar project-domain `gitBranch=feat/iam-api-rbac-lineage-20261110` e alias para o deployment de origem **relido na fase before**, validar snapshot `rollback` e domínios Preview/Production; só avançar de A→B→C após o rollback da fase anterior.
7. Preservar evidências assinadas/links dos runs, SHA, jobs, status da fixture e veredito `PASS_AUTH0_EXACT_SHA_E2E_AND_PREVIEW_ROLLBACK` ou `BLOCKED`. Não declarar PASS com testes sintéticos ou com E2E de outra branch.

## Critério para merge protegido (separado da aprovação de lease)
- `main` imutável até revisão de cada PR; `quality=SUCCESS` e `security-gate=SUCCESS` de origem GitHub Actions, no HEAD final exato, além de review independente válida, threads resolvidas e `protect-main` intacto.
- #44 adicionalmente requer os 4 gates PostgreSQL 18 (schema, source restore, manifest e independent recovery), testes offline schema/ledger, sem concessão de privilégio/DDL em Neon.
- #98/#101 requerem testes offline G1/B2 pertinentes; nenhum backup/restore, readback real ou alteração de custódia é autorizado pelo lease.
- Revisar proteção de Production por SHA, ausência de auto-promoção ou mudança de aliases antes de cada merge. Não executar merge sem cumprir TODAS as condições.

## Texto formal para publicação pelo revisor independente (uma mensagem por fase)

```text
<SELECIONAR_UM_MARCADOR_DA_TABELA_ACIMA>
approval_pr=<NUMERO_DESTA_PR>
repository=alexoaraujo/iam-control-center-new
target_pr=<98|101|44>
approved_head_sha=<SHA_EXATO_DA_FASE>
expected_main_sha=17a4e86fddecc02c4326049fdf3d95fea6f4e522
vercel_project=prj_OnuwD1iarOsXh6FFGkSpK4A5mj80
callback_domain=iam-control-center-new-ci-preview.vercel.app
source_branch=feat/iam-api-rbac-lineage-20261110
source_deployment_before=<DEPLOYMENT_ID_VALIDADO_NO_MOMENTO_DO_LEASE>
target_branch=<BRANCH_EXATA>
target_deployment_ready=<DEPLOYMENT_ID_READY_SHA_EXATO>
scope=preview_only_sequential_nonproduction
auth0_callback_allowlist_verified=<true>
branch_scoped_secrets_custody_verified=<true>
neon_disposable_nobypassrls_verified=<true>
no_concurrent_alias_jobs=<true>
rollback_required=true
main_merge_authorized=false
production_promotion_authorized=false
g1_backup_restore_cutover_authorized=false
decision=APPROVED_ONLY_AFTER_ALL_PREFLIGHT_GATES_PASS
```

**Este documento não deve ser usado como autorização sem a review independente efetivamente publicada no GitHub.** Revisão `REQUEST_CHANGES` ou pré-condição incompleta mantém `BLOCKED`.
