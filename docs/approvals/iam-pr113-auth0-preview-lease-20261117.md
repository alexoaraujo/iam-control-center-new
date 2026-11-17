# IAM — Autorização operacional independente do lease Auth0/Preview para a PR #113

> **Solicitação — NÃO é autorização concedida.** Este artefato documenta um procedimento de validação não produtiva. A criação da branch/PR, o review sem marcador ou o merge deste documento não autoriza modificar Vercel, Auth0, Neon, secrets ou Production.

## 1. Identidades e pré-condições imutáveis

- Repositório: `alexoaraujo/iam-control-center-new`.
- `main` na inspeção: `17a4e86fddecc02c4326049fdf3d95fea6f4e522`. Se o SHA mudar, revalidar a base e os controles.
- PR de código: [#113](https://github.com/alexoaraujo/iam-control-center-new/pull/113), branch `fix/peos-ci-offline-security-gate-20261117`, HEAD `810cc0e88cd16981d2f74a5ae9acc83b921d2b8e`. Qualquer novo push invalida a autorização de SHA.
- Vercel equipe `aoa4`, projeto `prj_OnuwD1iarOsXh6FFGkSpK4A5mj80`.
- Callback compartilhado: `iam-control-center-new-ci-preview.vercel.app` (project domain `verified=true`).
- Baseline de project domain: `gitBranch=feat/iam-api-rbac-lineage-20261110`.
- Baseline de alias: `dpl_AHt58aoFXCAJXzkXngm2ZgrVS72w`, READY, proveniente de `feat/iam-api-rbac-lineage-20261110@f2cfa570e282463d4e7457613de3f4a527df8149`.
- Preview candidato PR #113: `dpl_GfYemN9v1C9vNBC2iuD8EuWG12Sc`, READY, `fix/peos-ci-offline-security-gate-20261117@810cc0e88cd16981d2f74a5ae9acc83b921d2b8e`.
- Production baseline: domínio `iam-control-center-new.vercel.app` apontando para `dpl_4sd7DPf8nnr5WuzieAkn2CZcbSq1`, commit `main@665b41008d16e88d6cd6f9857951a294ddb112f2`.
- GitHub ruleset `protect-main` ID `26988310`: ativo, 1 revisão independente, checks `quality` e `security-gate`, sem bypass.
- CI anterior: [run #44025495927](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44025495927), quality/Preview PASS; `sync-auth0-preview=FAIL` com `AUTH0_GATE_REVIEW_REQUIRED`, `auth0-e2e=SKIPPED`, `security-gate=FAIL`. Esse bloqueio é esperado e **não** deve ser removido.
- Job independente PostgreSQL 18/RLS: [run #44025496010](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44025496010), SUCCESS, mas NÃO equivale a Auth0 E2E.

Os deployments, domínios e seus metadados são **referências temporais** de leitura autenticada. Nenhuma execução deve confiar nesses valores sem novo readback.

## 2. Escopo solicitado, estritamente limitado

Autorizar, **somente depois de decisão humana independente expressa e com todos os campos obrigatórios**, uma janela única de lease do domínio/alias de callback Auth0 para o Preview READY da PR #113 no mesmo SHA. A janela serve exclusivamente para executar Auth0 E2E real da alteração de política, confirmar autenticação segura e restaurar o baseline original ao fim da janela, inclusive após falha.

É proibido: aceitar `SKIPPED` como E2E PASS; alterar `protect-main`; transferir o alias para Production; fazer deploy/promoção Production; rotacionar credenciais; criar wildcard Auth0; usar audit M2M para `update:clients`; DDL/DML/migração ou mudanças de URL Neon; habilitar RBAC fixture write/grant/revoke sem autorização específica; iniciar backup G1/cutover; imprimir segredos.

## 3. Preflight obrigatório (somente leitura, com evidências)

1. Confirmar **Auth0 Regular Web App**: a URL exata `https://iam-control-center-new-ci-preview.vercel.app/auth/callback` está em Allowed Callback URLs; conferir logout/web origins. Nunca publicar client secret nem alterar allowlist sem aprovação.
2. Confirmar ausência de leases concorrentes ou jobs em execução que dependam do mesmo callback, incluindo PRs #98, #101 e #44 e seus runs.
3. Reler `get_project_domain`, `get_alias`, `get_deployment` do callback e do deployment candidato; exigir `READY`, `meta.githubCommitSha` e `meta.githubCommitRef` equivalentes aos valores da PR #113, repo/projeto/equipe corretos.
4. Reler Preview config `decrypt=false` para metadados de `AUTH0_DOMAIN`, `APP_BASE_URL`, `E2E_CALLBACK_HOST`, `E2E_CALLBACK_BRANCH`, client IDs e secrets presentes; garantir ausência de ambiguidade entre defaults e branch-scoped, sem divulgar valores confidenciais.
5. Verificar que OIDC Trusted Sources, `AUTH0_E2E_ENABLED`, variáveis de sessão e permissões de GitHub Environment `Preview` estão compatíveis. Dados Neon de Preview devem permanecer isolados; runtime sem BYPASSRLS.
6. Confirmar que o candidato continua no SHA exato, `protect-main` ativo, revisão humana do código no HEAD, nenhum merge em andamento, nenhuma promoção/alteração do alias Production.

Qualquer divergência implica `BLOCKED_PRECHECK`.

## 4. Execução autorizada apenas após aprovação explícita

1. Registrar snapshot privado **before** do callback: project domain `gitBranch`, alias/deployment ID, Preview env non-secret metadata, Production alias e jobs em voo. Um operador autorizado é responsável pelo rollback.
2. Sob change window exclusiva, atribuir o **project domain gitBranch** da callback à branch da PR #113 e reatribuir o **alias** ao deployment READY correspondente à HEAD exata; as duas operações devem ser verificadas separadamente.
3. Validar snapshot **leased**: callback, SHA, branch, deployment `READY`, APP_BASE_URL, client Auth0, origem OIDC, ausência de secrets inesperados e ausência de colisões entre branches. Se o Preview exigir novos valores protegidos, obtê-los por custódia privada e redeploy controlado da mesma SHA, nunca pela conversa.
4. Executar CI/E2E real da PR #113 em HEAD exata, incluindo login/callback/logout, identidade correta, expiração de sessão e controles negativos de OIDC. Qualquer operação RBAC write continua proibida sem fixture própria e autorização distinta. Exigir `auth0-e2e=SUCCESS` e `security-gate=SUCCESS` no mesmo SHA.
5. **Rollback obrigatório antes de encerrar a janela, inclusive após qualquer FAILURE**: restaurar `gitBranch` original e alias ao deployment do snapshot before, validando por GET independente o projeto, a origem e a Production inalterada. O retorno não é inferido por ausência de erro no PUT.
6. Arquivar evidências sanitizadas: preflight, before, leased, E2E run, negative tests, after/rollback; códigos de sucesso/falha, SHA, revisor e executor. Somente então reavaliar Ready for Review/merge do código, sujeitando ao ruleset vigente.

## 5. Campos obrigatórios da decisão do revisor independente

Uma review GitHub `APPROVE` **com corpo textual completo** deve conter o seguinte contrato, e só deve ser publicada após verificação efetiva de todos os campos; **não** deixar `true` por padrão ou copiar sem conferir:

```text
IAM_PR113_AUTH0_PREVIEW_LEASE_APPROVED
approval_pr=<NUMERO_DA_PR_DE_AUTORIZACAO>
repository=alexoaraujo/iam-control-center-new
target_pr=113
approved_target_head_sha=810cc0e88cd16981d2f74a5ae9acc83b921d2b8e
expected_main_sha=17a4e86fddecc02c4326049fdf3d95fea6f4e522
vercel_team=aoa4
vercel_project=prj_OnuwD1iarOsXh6FFGkSpK4A5mj80
callback_domain=iam-control-center-new-ci-preview.vercel.app
source_branch=feat/iam-api-rbac-lineage-20261110
source_deployment_before=<READBACK_IMEDIATO>
target_branch=fix/peos-ci-offline-security-gate-20261117
target_deployment_ready=<READY_SHA_EXATO_CONFIRMADO>
auth0_callback_allowlist_verified=<true|false>
github_environment_custody_verified=<true|false>
preview_branch_env_verified=<true|false>
oidc_trusted_source_verified=<true|false>
no_concurrent_lease_jobs=<true|false>
production_alias_unchanged=<true|false>
protect_main_enabled=<true|false>
rollback_operator_identified=<true|false>
rollback_required=true
scope=single_branch_single_sha_preview_only_auth0_e2e
neon_write_authorized=false
g1_backup_restore_authorized=false
production_promotion_authorized=false
main_merge_authorized=false
decision=APPROVED_ONLY_IF_ALL_PREFLIGHT_CHECKS_PASS
```

Se faltar qualquer campo, o HEAD divergir, houver reviewer igual ao executor sem independência ou um booleano obrigatório for `false`, **o lease permanece BLOCKED**. A revisão da PR #113 com corpo vazio confirma apenas revisão de código, não esta autorização.

## 6. Gate posterior separado

Após restauração da callback e readback independente, a PR #113 poderá ser novamente avaliada sob `protect-main`, exigindo CI `quality=SUCCESS`, `security-gate=SUCCESS` e revisão humana no SHA final. Nada neste documento libera automaticamente merges da #44/#98/#101, restore Neon, custódia Backblaze ou cutover.

**Marcadores:** `PR113_AUTH0_PREVIEW_LEASE=PENDING_INDEPENDENT_OPERATIONAL_APPROVAL`; `MERGE_MAIN=BLOCKED`; `G1_FULL_BACKUP_OWNER_APPROVED=BLOCKED`; `PRODUCTION=UNCHANGED`.
