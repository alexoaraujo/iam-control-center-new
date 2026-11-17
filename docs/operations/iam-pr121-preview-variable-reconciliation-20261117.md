# PEOS — Reconciliação GitHub / Vercel / Auth0 / Neon para PR #121 (17/11/2026)

> **Estado:** evidência técnica e configuração desejada, **NÃO APLICADA**. Este documento e o manifesto [JSON](iam-pr121-preview-variables-desired-20261117.json) não são um lease, uma revisão independente ou autorização de rollback. Nenhum valor de segredo deve ser versionado, copiado de Production ou exibido em logs.

## Identidade e escopo verificados
- GitHub: `alexoaraujo/iam-control-center-new`; PR [#121](https://github.com/alexoaraujo/iam-control-center-new/pull/121), branch `experiment/bun-native-tests-picomatch-removal-20261117`, HEAD `55dac1c52e3b9d453d2a8db4c5c2efb2ca1ff4c7`, **Draft**. A [PR #122](https://github.com/alexoaraujo/iam-control-center-new/pull/122) é a solicitação operacional, não o código em teste.
- Vercel: team `aoa4`, projeto `prj_OnuwD1iarOsXh6FFGkSpK4A5mj80`; deployment técnico da PR #121 `dpl_Dnd9G351VE9Au4sm5kwYsPq92h4V`, READY, SHA e branch iguais aos acima.
- **Desvio observado:** ambos `iam-control-center-new-ci-preview.vercel.app` e `iam-control-center-new-preview.vercel.app` constam vinculados à branch da **PR documental #122** `approval/iam-pr121-auth0-preview-callback-lease-20261117` e ao deployment `dpl_3AE28BoVmRnTbX5e2axf49F7rbSA`, READY, SHA `52f783628377442ab4bc8ed61d69af0594b71954`. Portanto, não apontam para o SHA técnico #121.
- **Baseline histórico de retorno, revalidar antes de qualquer ação:** ambos anteriormente vinculados ao deployment `dpl_4GGwBNDRGtVZHdkhF7kSB8GZsvee` (branch `feat/iam-api-rbac-lineage-20261110`, SHA `17a4e86fddecc02c4326049fdf3d95fea6f4e522`). Não executar rollback cego: confirmar quem moveu os aliases, se há lease externo e o operador designado.

## Inventário Vercel efetivo — leitura `decrypt=false`
| Variável | Estado efetivo | Estado desejado, APÓS autorização |
|---|---|---|
| `AUTH0_DOMAIN` | Uma variável plain compartilhada Production/Preview com valor correspondente a `iam-control-center.us.auth0.com` | **Preservar**; não recriar nem alterar Production |
| `AUTH0_CLIENT_ID` | Presente, plain, Production/Preview | Conferir ID da aplicação **IAM Control Center Web** no Auth0 antes de validar |
| `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` | Presentes como `sensitive` em Preview e Production | Preservar; validar identidade/escopo por fonte autorizada, nunca ler/copiar valores nem reproduzir em texto |
| `APP_BASE_URL` | **Ausente** no Preview da branch #121 | `https://iam-control-center-new-ci-preview.vercel.app`, `plain`, target `preview`, `gitBranch` exata #121 |
| `E2E_CALLBACK_HOST` | **Ausente** na branch #121; default Preview global `encrypted` não satisfaz o contrato `plain` | `iam-control-center-new-ci-preview.vercel.app`, `plain`, `preview`, branch exata #121 |
| `E2E_CALLBACK_BRANCH` | **Ausente** na branch #121; default Preview global `encrypted` não satisfaz o contrato `plain` | `experiment/bun-native-tests-picomatch-removal-20261117`, `plain`, `preview`, branch exata #121 |
| `DATABASE_URL` | Nenhuma variável Preview para branch #121 | Apenas secret/sensitive com usuário runtime isolado Neon **depois** de comprovar compute, RLS, custódia e lease; jamais banco Production |
| `AUTHZ_CONTEXT_SIGNING_KEY_HEX` | Nenhuma variável Preview para branch #121 | Secret/sensitive da mesma branch isolada, com correspondência à chave ativa; **não gerar, ler ou copiar** sem autorização |
| `DATABASE_RUNTIME_ROLE` | Default Preview ausente para branch #121 | `iam_app_runtime_login` após validação da role e política runtime |
| `AUTH0_NEON_SYNC_ENABLED` | Default Preview ausente; override `true` restrito a outra branch antiga | Manter desligado (`false`) até gate real de identidade/RLS |

**Precedência exigida:** somente `target=preview` + `gitBranch` exata da PR #121. Nunca transformar um override de branch em variável global de Preview/Production. O script [sync-auth0-e2e-preview.mjs](../../scripts/sync-auth0-e2e-preview.mjs) exige explicitamente as três variáveis como `plain`, valida `AUTH0_DOMAIN`, as credenciais existentes, domínio, alias, branch e SHA antes de emitir `auth0_ready=true`.

## Estado Neon — somente leitura
- Organização `org-billowing-mouse-09498904`; projeto `tiny-rice-70320263`, PostgreSQL 18, região `aws-sa-east-1`.
- Branch descartável `validation/pr-103-auth0-e2e-20261116`, `br-plain-cell-b68uorki`, contém database `iam_database`, role de login `iam_app_runtime_login` e roles `iam_owner`, `iam_worker`, `iam_app_runtime`, `iam_schema_export_reader`, `iam_migrator`.
- `list_branch_computes` retornou `data=[]`; tentativas SELECT sobre `pg_roles` e `pg_class` retornaram `HTTP 404 endpoint not found`. **Não foi possível validar NOBYPASSRLS, RLS ou privileges por SQL.** Não criar compute, rodar migration, rotacionar credenciais nem vincular URL até aprovar o gate. Esta branch também não é automaticamente atribuída à PR #121 apenas por existir.

## Governança e evidências ainda pendentes
- A [review #5946404985](https://github.com/alexoaraujo/iam-control-center-new/pull/122#pullrequestreview-5946404985) na PR #122 foi `APPROVED` em `2026-11-17T20:50:52Z` para `52f783628377442ab4bc8ed61d69af0594b71954`, mas tem **corpo vazio**. Não comprova `IAM_PR121_AUTH0_PREVIEW_LEASE_APPROVED` nem o aceite independente.
- **Auth0 Allowed Callback URLs:** sem readback autenticado da aplicação, não há confirmação de allowlist nem correspondência do client ID.
- **GitHub Environment `Preview`:** a conexão Github disponível não expõe as configurações administrativas de ambientes/segredos para validação de custódia; não presumir aprovação.
- **OIDC Trusted Sources no Vercel:** sem evidência do trust cloud-side e controle negativo.
- **Exclusividade:** no instante de consulta GitHub Actions tinha 0 `in_progress`, e 1 `queued` de workflow B2; isso não prova ausência de locks, jobs externos ou lease concorrente. Verificar o estado completo novamente imediatamente antes de qualquer mudança.
- **Rollback humano:** nenhum aceite pessoal verificável, janela UTC futura ou evidência de capacidade restaurativa. Nomear operador diferente do executor e anexar ID.
- **Integração:** CI `quality` anterior da PR #121 passou, mas `sync-auth0-preview` falhou, `auth0-e2e` não executou e `security-gate` integrado permaneceu FAIL (run [#44166210440](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44166210440)). Novo SHA exige nova execução.

## Procedimento de execução condicionado aos cinco controles
1. Revisor e operador independentes publicam IDs/links, horário UTC, SHA, escopo, custódia das credenciais, autorização OIDC e aceite de rollback **incluindo o desvio de alias observado neste documento**; identificar se existe lease externo e a origem da alteração.
2. Somente depois de autorização válida na PR #122, aplicar as três variáveis **plain**, Preview **somente para a branch #121**, conforme JSON. Verificar por readback sem decriptação; não usar `upsert` sem assegurar a ausência de duplicatas.
3. Validar compute e role Neon em branch isolada, SQL read-only para `rolbypassrls=false`, políticas RLS e grant/revoke. Somente então provisionar os dois secrets branch-scoped via custódia segura; nunca copiar Production.
4. Validar allowed callbacks no Auth0 e OIDC Trusted Sources efetivos; conferir restrições/reviewers do GitHub Environment.
5. Preparar nova implantação se alterações de variáveis não estiverem no deployment existente; **revalidar deployment ID/branch/SHA/READY** e reautorizar o alvo caso mude. Reservar lease único e realizar vínculo temporário de ambos os aliases.
6. Executar E2E Auth0 de identidade real + HTTP 200 após grant/403 após revoke + expiração de sessão e limpeza Neon, correlacionando run ID ao SHA. Em sucesso **ou falha**, operador aceito restaura os dois aliases e confirma readback. Não modificar Production.
7. Reexecutar `quality`, `security-gate` e demais required checks no SHA integrado; revisão independente antes de merge. Nenhum `PASS` deve ser atribuído sem execução e logs.

**Condição atual:** `CONFIG_INVENTORY=PARTIAL_READBACK`; `CALLBACK_ALIAS=DRIFT_TO_PR122`; `PR121_ENV_MISSING=TRUE`; `NEON_COMPUTE=ABSENT`; `AUTH0_ALLOWLIST=UNVERIFIED`; `OIDC_TRUST=UNVERIFIED`; `OPERATIONAL_LEASE=BLOCKED`; `REAL_E2E=NOT_RUN`; `MERGE_MAIN=BLOCKED`; `PRODUCTION=UNCHANGED_BY_THIS_AUDIT`.

Este artefato foi preparado como mudança documental, **sem executar alteração externa**.
