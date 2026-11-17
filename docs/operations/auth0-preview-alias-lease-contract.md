# IAM-008 — Guarda de lease do callback Auth0/Vercel

**Somente inspeção**. Não altera domínio, alias, variáveis, segredos, branches Neon, SQL ou aplicação Auth0. Não é um mecanismo de concessão de aprovação operacional.

O contrato em `scripts/preview-alias-lease-guard.mjs` verifica snapshots sanitizados de Vercel nas fases `before`, `leased` e `rollback`. Utilize o retorno do conector Vercel/Get Project Domain, Get Alias, Get Deployment e Filter Project Envs com `decrypt=false`. Os snapshots devem vir de **leituras autenticadas reais**, não de dados inventados. Não serializar ou publicar valores de `DATABASE_URL`, `AUTHZ_CONTEXT_SIGNING_KEY_HEX` ou `VERCEL_API_TOKEN`.

## Referências iniciais, que precisam ser revalidadas antes de agir

- Projeto Vercel `prj_OnuwD1iarOsXh6FFGkSpK4A5mj80`, team `aoa4`.
- Host compartilhado `iam-control-center-new-ci-preview.vercel.app`, atualmente vinculado à PR #41.
- Origem: PR #41, branch `feat/iam-api-rbac-lineage-20261110`, SHA `0a681b73f40cd1b28db54e57f3813eefcdf0e64c`, deployment `dpl_28LtLPW4oRs1vjgbA5uHUunnZQsU`.
- Destino pretendido: PR #103, branch `fix/security-next-16-4-5`, SHA `fb14b5b76c6bb52446b126b8c3fddfe77d8a3ea8`, deployment `dpl_38TsYyHC1C5GYbvdLNw8uBVVVjiy`.
- Fixture isolada **reservada, não conectada**: Neon `tiny-rice-70320263`, branch `br-plain-cell-b68uorki`, criada como clone copy-on-write de `development`, sem compute.

Esses IDs são um checkpoint, **não** um lease permanente. Ao mudar qualquer SHA, recalcule o contrato e solicite nova aprovação. A PR #103 contém a correção Next.js 16.4.5 e está bloqueada pelo E2E Auth0.

## Contrato de validação (fail closed)

A função `verifyLeaseSnapshot(snapshot)` exige:
1. Repositório exato e SHAs de 40 dígitos para PR #41 e PR #103, mais deployments READY correspondentes à branch, SHA, projeto, repositório e **hostname do Preview verificado** (URL do deployment ou alias exato).
2. Domain verificado e alias pertencentes ao mesmo projeto.
3. Na fase `before`, ambos continuam apontando à origem; em `leased`, apontam ao destino aprovado; em `rollback`, voltam à origem.
4. Nas fases `before` e `leased`, metadados, **sem decriptação**, mostrando `APP_BASE_URL`, `DATABASE_URL` e `AUTHZ_CONTEXT_SIGNING_KEY_HEX` com `target=preview` e `gitBranch` exata da PR #103. No `rollback`, a validação do vínculo original continua possível mesmo depois da remoção das variáveis do destino. A presença dos nomes não prova valores corretos, validade dos segredos, RBAC ou RLS.

Retornos `PASS_PREVIEW_LEASE_*_READ_ONLY` só atestam a coerência do snapshot. Os campos `operationalApproval`, `dataSourceAndRls` e `auth0LoginAndGrantRevoke` permanecem `NOT_ATTESTED` / `NOT_TESTED` intencionalmente.

## Aprovação e rollback

Antes de qualquer mutação Vercel, exigir: aprovação **operacional independente** registrada na [Issue #17](https://github.com/alexoaraujo/iam-control-center-new/issues/17), revisão do owner da PR #41, ausência de jobs concorrentes que dependam do alias, fixture Neon com runtime `NOBYPASSRLS` e isolamento por branch, segredos dedicados do Preview e verificação das callbacks permitidas no Auth0. Executar o E2E no SHA exato sem desabilitar verificação de OIDC, HTTP grant/revoke ou limpeza.

Uma vez autorizada a mudança, a alteração de `gitBranch` do project-domain e a atribuição do alias ao deployment devem ser atômicas do ponto de vista operacional: verificar ambas no readback; caso não coincidam, parar e restaurar `gitBranch=feat/iam-api-rbac-lineage-20261110` e `deploymentId=dpl_28LtLPW4oRs1vjgbA5uHUunnZQsU` (revalidando IDs no momento do rollback). Não alterar Production.

**Sem aprovação:** `PREVIEW_ALIAS_LEASE=BLOCKED`. **Sem sucesso do E2E:** `PR103_MERGE=BLOCKED`. **Sem readback B2 e aprovação independente:** `G1_FULL_BACKUP_OWNER_APPROVED=BLOCKED`.

### Testes automatizados

`node --test scripts/preview-alias-lease-guard.test.mjs` usa somente dados sintéticos (sem tokens, rede ou SQL) e cobre divergência de branch/SHA, alias dividido, origem, destino, rollback, fork, projeto incorreto e ausência de variáveis isoladas. O job `quality` atual já executa `node --test scripts/*.test.mjs`.
