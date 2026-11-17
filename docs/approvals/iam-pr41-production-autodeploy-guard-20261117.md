# PEOS — PR #41: Controle de não promoção automática de Production antes do merge

**Status: BLOQUEADO até comprovação e autorização independente.** Esta PR é um documento de decisão operacional, não altera a aplicação nem configura automaticamente GitHub/Vercel.

## 1. Identidades fixas da operação

| Campo | Valor |
| --- | --- |
| Repo | `alexoaraujo/iam-control-center-new` |
| PR de código | #41 |
| SHA HEAD aprovado | `f2cfa570e282463d4e7457613de3f4a527df8149` |
| SHA de `main` esperado | `469339973b03009de68e505fe1aeb2da5f169117` |
| Método autorizado | `Create a merge commit` (`merge`) |
| Autorizações já emitidas | `IAM_PR41_MAIN_RECONCILED_FINAL_REVIEW_APPROVED`, `IAM_PR41_MAIN_MERGE_OWNER_APPROVED` |
| Vercel project | `prj_OnuwD1iarOsXh6FFGkSpK4A5mj80` |
| Production domain | `iam-control-center-new.vercel.app` |
| Production alias baseline | `dpl_4sd7DPf8nnr5WuzieAkn2CZcbSq1` |
| Production SHA baseline | `665b41008d16e88d6cd6f9857951a294ddb112f2` |
| Escopo máximo | Merge de código GitHub sem deploy/promoção de Production, sem G1 e sem cutover |

## 2. Risco observado e não resolvido

- Em 17/11/2026, GitHub apresentou PR #41 `mergeable_state=clean`, HEAD e base nos SHAs acima, revisão independente e autorização operacional completas, CI #44008496103 concluído SUCCESS, `quality`, `security-gate`, `auth0-e2e` e PG18/RLS PASS.
- O Vercel ainda mantinha o domínio de Production no deployment READY `dpl_4sd7DPf8nnr5WuzieAkn2CZcbSq1` / SHA `665b41008d16e88d6cd6f9857951a294ddb112f2`.
- **Evidência crítica:** pushes anteriores na branch `main` criaram **automaticamente deployments Vercel target=`production`**. Os três deployments recentes `dpl_CtMdevRLE64npH24f8WJJVxKB2cg` (`469339973b...`), `dpl_Dn1bYSiSN9DYdsCbKiHRftnEhoJu` e `dpl_FbNiPPD8sq9DkfAEFk5uyJ4kL9sx` terminaram `CANCELED`. O fato de terem sido cancelados **não prova** que um novo deployment será bloqueado antes de ficar READY ou assumir o domínio.
- A ruleset `protect-main` ID `26988310` está ativa, exige revisão e checks. Ela **não bloqueia deployments automáticos de Production após merge**. O workflow `vercel-deployment-guard.yml` faz lint, typecheck, testes e build, **não** atua como trava de promoção.
- A autorização `IAM_PR41_MAIN_MERGE_OWNER_APPROVED` inclui expressamente `scope=main_code_merge_only_no_production_promotion_no_g1_backup_no_cutover` e `condition=verify_main_and_head_unchanged_checks_green_ruleset_and_production_guard_before_merge`. Este último controle ainda não foi comprovado.

## 3. Plano operacional proposto — sem bypass, limitado ao plano Free

**Fase P0 — Verificar, sem mutação**
1. Registrar efetivamente a configuração atual do Git vinculado ao projeto Vercel: branch Production, condições para criação automática de deployment e associação automática do domínio. Não inferir controles que a API não expõe.
2. Confirmar se há opção disponível no plano Free para **impedir a criação e/ou promoção automática** de novos deployments de `main`, de maneira reversível, por configuração Vercel suportada. Cancelamento manual posterior **não satisfaz** a garantia.
3. Confirmar a diferença entre prevenção de deploy, prevenção de alias automático e mera proteção de acesso: Vercel Authentication, lock de domínio e revisão no GitHub não são prova de que o deployment não será promovido.
4. Reconfirmar a baseline do domínio, a ruleset ativa, os approvals e o CI no SHA exato antes de qualquer operação.

**Fase P1 — Implementar trava somente após autorização específica**
1. O operador independente deve selecionar uma configuração **documentada, suportada e efetivamente verificável** que bloqueie a criação ou autopromoção em Production para o próximo push em `main`. Usar somente capacidades Free.
2. Aplicar a trava no projeto Vercel, com captura da configuração efetiva e readback independente. Não alterar variáveis sensíveis, domínio Production, alias Preview, callback Auth0, RLS ou Neon. Se a opção de trava não existir, **não executar merge**.
3. Comprovar que a trava permanecerá eficaz durante o evento de push do merge e impediria o destino `production` de assumir o alias. Não usar “cancelaremos depois” como controle.
4. Criar plano de rollback da trava para momento posterior, **mediante gate de promoção Production separado**.

**Fase P2 — Revalidar merge de código já autorizado**
1. Confirmar `main=469339973b03009de68e505fe1aeb2da5f169117` e `PR41 HEAD=f2cfa570e282463d4e7457613de3f4a527df8149`, autorização formal no mesmo SHA e todos os checks obrigatórios SUCCESS.
2. Confirmar baseline `production_alias=dpl_4sd7DPf8nnr5WuzieAkn2CZcbSq1` e SHA baseline `665b41008d16e88d6cd6f9857951a294ddb112f2`.
3. Executar **Create a merge commit** com `expected_head_sha` (nunca squash/rebase), somente após P1 PASS; não desativar ruleset ou checks.
4. Após o merge, confirmar CI em `main`, ref final, novo SHA, Production alias e estado do deployment. Se a proteção não se mantiver, interromper promoção e avaliar rollback controlado; nenhuma alteração destrutiva automática.
5. Manter backup/restore G1, Neon cutover, alteração de Production e liberação de domínio fora do escopo.

## 4. Critérios para o revisor

- [ ] Confirmar os SHAs da PR #41 e de `main` sem alteração.
- [ ] Validar os resultados PASS dos checks e o escopo limitado da autorização anterior.
- [ ] Validar evidência de autodeploy histórico e baseline do domínio Production.
- [ ] Confirmar que a proposta **não** depende de cancelamento manual após o push.
- [ ] Identificar controle Vercel preventivo suportado no plano Free, sua reversibilidade e forma de readback.
- [ ] Se controle não for suportado, marcar a operação `BLOCKED_UNVERIFIED_PRODUCTION_GUARD`.
- [ ] Separar explicitamente aprovação da **trava** da execução do **merge** e de qualquer futura promoção Production.

## 5. Decisão operacional — somente por GitHub Review APPROVED nesta PR

Uma aprovação genérica, comentário em Issue ou texto sem campos não autoriza aplicar a trava.

```text
IAM_PR41_PRODUCTION_AUTODEPLOY_GUARD_APPROVED
repository=alexoaraujo/iam-control-center-new
pull_request=41
approved_head_sha=f2cfa570e282463d4e7457613de3f4a527df8149
expected_main_sha=469339973b03009de68e505fe1aeb2da5f169117
vercel_project=prj_OnuwD1iarOsXh6FFGkSpK4A5mj80
production_domain=iam-control-center-new.vercel.app
production_alias_baseline=dpl_4sd7DPf8nnr5WuzieAkn2CZcbSq1
production_baseline_sha=665b41008d16e88d6cd6f9857951a294ddb112f2
required_control=prevent_automatic_production_deploy_or_promotion_before_main_merge
scope=vercel_production_guard_only_no_production_promotion_no_g1_no_cutover
condition=effective_free_tier_control_and_independent_readback_required_before_merge
```

Esta revisão autoriza **somente a implementação/revalidação da trava preventiva**, caso suportada. Não é autorização para contornar checks, mover aliases, executar backup G1/cutover ou promover Production. A autorização de merge da PR #41 permanece sujeita a todos os gates.

**Estados:** `PR41_TECH_REVIEW=PASS` · `PR41_MAIN_MERGE_OWNER_APPROVAL=PASS` · `PRODUCTION_AUTODEPLOY_PREVENTION=UNVERIFIED` · `PR41_MAIN_MERGE=BLOCKED` · `G1_FULL_BACKUP_OWNER_APPROVED=BLOCKED`.
