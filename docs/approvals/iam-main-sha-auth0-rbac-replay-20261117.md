# IAM Control Center NEW — Aprovação independente para replay E2E do SHA da main (2026-11-17)

## 1. Identidade imutável e finalidade
- Repositório: `alexoaraujo/iam-control-center-new`
- PR técnica já integrada: **#41**; método **Create a merge commit**.
- SHA EXATO de código da main a verificar: `17a4e86fddecc02c4326049fdf3d95fea6f4e522` (**não substituir por SHA de uma PR documental**).
- SHA Git tree do merge: `951d6997bb4cb5ad1b137a106e689718a1399e55`; é idêntica à árvore do HEAD aprovado da PR #41 `f2cfa570e282463d4e7457613de3f4a527df8149`.
- Baseline anterior à PR #41: `469339973b03009de68e505fe1aeb2da5f169117`.
- Finalidade restrita: gerar uma execução nova do **E2E Auth0 real + RBAC HTTP 200 após grant → 403 após revoke na mesma sessão + cleanup 0/6** no SHA EXATO do merge, em Preview e clone Neon descartável. Equivalência de Git tree **não** é execução E2E do SHA integrado.

## 2. Bloqueio e necessidade desta aprovação
- `.github/workflows/quality.yml` executa `auth0-e2e` apenas em `pull_request`; em push ou dispatch da `main` o job é **SKIPPED**.
- `.github/e2e/auth0-rbac.spec.cjs` ainda verifica evento `pull_request`, `GITHUB_HEAD_REF=feat/iam-api-rbac-lineage-20261110`, projeto/branch Neon específicos e callback Vercel exato. **Nunca falsificar variáveis do evento, ignorar os guards, modificar os testes em runtime ou declarar SKIPPED como PASS.**
- A branch GitHub `feat/iam-api-rbac-lineage-20261110` foi apagada após a PR #41; a configuração Vercel do callback continua vinculada a esse nome. Sua **recriação é uma alteração operacional explícita que exige aprovação independente**.
- Os aliases Preview `iam-control-center-new-ci-preview.vercel.app` e `iam-control-center-new-preview.vercel.app` estão associados à branch de callback aprovada; registrar seus deployment IDs e readback antes de criar qualquer ref. O CI callback aponta, no momento da preparação, para `dpl_AHt58aoFXCAJXzkXngm2ZgrVS72w` (SHA `f2cfa570...`).
- Nenhum workflow dispatch existente permite E2E real da `main` sem ajustes; não contornar essa limitação por reexecução de job ignorado.

## 3. Neon — fixture descartável, sem Production
- Projeto `tiny-rice-70320263`; database `iam_database`; child `br-quiet-night-b6cfeq4j`; parent `br-muddy-bar-b63ksdy7`; endpoint `ep-broad-bonus-b6c5jc2y.c-2.sa-east-1.aws.neon.tech`.
- TTL/lease: `2026-11-20T01:30:00Z`; guarda de expiração de 15 minutos deve ser aplicada antes de ler qualquer segredo/realizar SQL de escrita.
- Preflight SQL real, **somente leitura**, executado antes desta PR: PostgreSQL 18.7, `neon.branch_id` e DB corretos; owner pode `SET ROLE iam_owner`; `iam_owner` é `NOLOGIN/NOBYPASSRLS/NOSUPERUSER`; runtime é `NOBYPASSRLS/NOSUPERUSER`; seis conjuntos de IDs sintéticos 0/6; 1 chave de contexto ativa, ledger 0 e 1 permissão canônica de leitura.
- Reusar **somente o segredo protegido existente** `NEON_RBAC_TEST_OWNER_DATABASE_URL` no Environment GitHub `Preview`, se seu vínculo privado ainda for válido; não revelar, imprimir, trocar, gravar ou exportar credenciais. Nunca usar a URL admin no runtime Vercel. O teste deve efetuar DML **somente** com `SET LOCAL ROLE iam_owner` no clone, fazer revoke HTTP 403 e cleanup final 0/6 com verificação independente posterior.

## 4. Execução *proposta e condicionada* — replay PR isolado
Somente após revisão GitHub **Approve** com marcador e campos completos desta PR:
1. Readback da `main`, da árvore Git, do clone e do TTL; não prosseguir com divergência.
2. Registrar baseline dos **três** aliases Production e **dois** aliases Preview e verificar `autoAssignCustomDomains=false` + Ignored Build Step de Production. Nenhuma alteração em domínio Production.
3. Criar **baseline histórico descartável** `validation/pr41-premerge-baseline-20261117` apontando exclusivamente para `469339973b03009de68e505fe1aeb2da5f169117`.
4. Recriar, sem sobrescrever ref existente, a branch **de callback já autorizada** `feat/iam-api-rbac-lineage-20261110` apontando **diretamente** para o SHA de merge `17a4e86fddecc02c4326049fdf3d95fea6f4e522`. Não criar commit, não atualizar `main` ou alterar código-fonte do teste.
5. Abrir PR **de replay**, head da branch callback, base da baseline histórica, **estritamente para disparar o evento `pull_request` verdadeiro**, sem merge, auto-merge ou permissão de promoção. Conferir que o head do novo PR é literalmente o SHA de merge.
6. Autorizar **somente** um Preview Vercel com metadados da identidade real do replay PR: `githubCommitSha=17a4e86...`, `githubCommitRef=feat/iam-api-rbac-lineage-20261110`, `githubPrId=<número real da PR de replay>`, ambiente `preview`, callback alias verificado e **mesmo deployment** do Preview; erro ou mismatch = BLOCKED. Não aceitar deployment antigo, URL genérica, CI simulada, troca de Auth0 allowed callbacks ou acesso sem Vercel Trusted OIDC.
7. Sob o GitHub Environment `Preview` já protegido, executar o Playwright real existente com usuário Auth0 real, `POST /api/authorization/check` HTTP **200 com grant → 403 após revoke na mesma sessão**, verificar **cleanup 0/6** e guardar os IDs de workflow/job/artefatos. Confirmar que o evento, head e commit SHA do workflow coincidem com a identidade aprovada. Não expor sujeito Auth0 em claro, tokens, URI ou senhas.
8. Comparar novamente o clone, os aliases Production e os metadados do replay. Após conclusão, **restaurar e comprovar** os aliases Preview à baseline registrada quando tiverem sido alterados; só permitir rollback do Preview autorizado, nunca fazer promoção Production. Encerrar a PR de replay sem merge e registrar a necessidade de limpeza das refs temporárias com método autorizado. Se o rollback não puder ser executado e comprovado, bloquear antes de modificar aliases.
9. Se o Vercel não gerar Preview READY com metadados do **SHA e número do PR** corretos, ou se qualquer guarda de segurança falhar, **parar sem concessão de RBAC** e registrar o bloqueio; não fabricar evidência positiva.

## 5. Critérios PEOS e marcadores
- `MAIN_SHA_GIT_TREE_PARITY=PASS` já verificado; **`MAIN_SHA_AUTH0_RBAC_E2E=NOT_RUN`** até run real completo.
- `NEON_DISPOSABLE_READONLY_PREFLIGHT=PASS`, `NEON_DISPOSABLE_WRITES=NOT_RUN`.
- Aprovação precisa ser uma revisão **Approve** no HEAD desta PR e conter `IAM_MAIN_SHA_RBAC_E2E_REPLAY_APPROVED` + todos os campos de escopo. Um comentário simples, revisão vazia, aprovação em issue ou revisão de outro SHA não autoriza.
- Passos PEOS: Executar → Verificar → Corrigir → Testar → Revisar → Validar → Avançar, sem bypass da ruleset. Registrar tanto erros quanto resultados positivos.
- Revisão independente requerida para qualquer nova atualização da baseline/escopo/lease.

## 6. Exclusões inegociáveis
**NÃO** fazer merge na main, rebase/squash, release/promoção Production, troca de aliases Production, atualização/rotação de segredo, modificação de código de E2E no SHA fixado, criação de banco Production, G1 backup/restore, B2, cutover, alterações Auth0 Management API, modificação de outras PRs ou concessão permanente. **NÃO** interpretar aprovação deste documento como aprovação de qualquer uma dessas operações.

## 7. Texto de autorização do revisor
O revisor independente deve incluir **exatamente um novo Approve no SHA desta PR** com:
```text
IAM_MAIN_SHA_RBAC_E2E_REPLAY_APPROVED
repository=alexoaraujo/iam-control-center-new
approval_pr=<numero_real>
approval_reviewed_sha=<head_sha_exato_desta_pr>
source_pr=41
target_main_sha=17a4e86fddecc02c4326049fdf3d95fea6f4e522
target_git_tree=951d6997bb4cb5ad1b137a106e689718a1399e55
baseline_sha=469339973b03009de68e505fe1aeb2da5f169117
replay_head_branch=feat/iam-api-rbac-lineage-20261110
replay_base_branch=validation/pr41-premerge-baseline-20261117
neon_project=tiny-rice-70320263
neon_branch=br-quiet-night-b6cfeq4j
neon_expires_at=2026-11-20T01:30:00Z
vercel_project=prj_OnuwD1iarOsXh6FFGkSpK4A5mj80
callback_alias=iam-control-center-new-ci-preview.vercel.app
scope=one_true_pr_event_exact_main_sha_preview_auth0_rbac_grant_revoke_cleanup_preview_rollback
condition=verify_exact_sha_pr_metadata_neon_lease_oidc_and_fail_closed_before_writes
exclusions=no_main_merge_no_production_no_g1_no_b2_no_cutover_no_secret_change
```
