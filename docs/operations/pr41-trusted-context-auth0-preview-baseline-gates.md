# PR #41 — Emissão confiável, Auth0 Preview e baseline canônica

**Repositório:** `alexoaraujo/iam-control-center-new`. **Base de referência:** `main@e95b938c889c3d2d45f056f946f2351df68b7823`.  
**Escopo:** somente PR #41, Preview Vercel e branch Neon isolada; **Production e cutover não autorizados**.  
**Estado:** implementação parcial e tests PASS por SHA; Auth0 real E2E **FAIL**, aprovação formal de baseline **BLOCKED**.

## 1. Trust boundaries corrigidos

O endpoint `POST /api/authorization/check` exige sessão Auth0 ativa. O navegador fornece apenas `{tenantId, identityId, permission}`; campos adicionais (incluindo `signature`, `nonce`, `expires` ou `context`) são rejeitados. O servidor não fornece qualquer endpoint que emita/retorne prova assinada. `apps/web/src/lib/authorization.ts` gera HMAC-SHA256 usando segredo de **Vercel Sensitive**, nonce aleatório de 128 bits e expiração de 60 segundos, apenas em memória e após autenticação.

A conexão com o PostgreSQL é verificada por `current_user = session_user = iam_app_runtime_login`, sem SUPERUSER ou BYPASSRLS. A função `iam.set_tenant_context` é chamada na primeira de duas instruções **na mesma transação** read-only Neon; a segunda verifica `issuer+subject` Auth0 contra `iam.identities`, membership ativa, tenant RLS, `iam.effective_permissions` e ausência de `access_policies` habilitadas cujo formato ainda não foi aprovado. Erro de configuração, HMAC inválido, role insegura e qualquer falha de SQL retornam apenas `403`. O login Auth0 sozinho nunca concede uma permissão.

**Riscos pendentes:** avaliações ABAC detalhadas ainda bloqueadas por regra deny-all; não há prova E2E positiva com o test account real, nem monitoramento/auditoria das decisões administrativas. A chave HMAC é de poder elevado e precisa de gestão e rotação compatíveis com o destino; **não** deve ser copiada da Production, do browser, dos logs nem do GitHub.

## 2. Configuração real, por branch, sem divulgação de segredos

| Item | Metadados verificados |
|---|---|
| Vercel project | `prj_OnuwD1iarOsXh6FFGkSpK4A5mj80` |
| Preview Git branch | `feat/iam-api-rbac-lineage-20261110` |
| Alias Auth0 e Vercel | `iam-control-center-new-ci-preview.vercel.app`, bound to this branch and verified |
| `APP_BASE_URL` | `https://iam-control-center-new-ci-preview.vercel.app`, Preview branch-scoped only |
| `DATABASE_RUNTIME_ROLE` | `iam_app_runtime_login`, Preview branch-scoped only |
| `DATABASE_URL` | Vercel **Sensitive**, Preview branch-scoped, from provider-issued runtime LOGIN URL pointing to Neon ephemeral compute's **provider-verified direct host**; `sslmode=require` and `channel_binding=require`; pooler disabled |
| `AUTHZ_CONTEXT_SIGNING_KEY_HEX` | Vercel **Sensitive**, Preview branch-scoped, generated via PostgreSQL `gen_random_bytes(32)` on test branch; value not exported to GitHub, logs or this document |
| Neon project / branch / db | `tiny-rice-70320263 / br-shy-scene-b67zm2v7 / iam_database` |
| Neon signing-key id | `preview-pr41-signer-20261111` active; prior synthetic key inactive; `app_private.context_keys` is privileged and not readable by runtime role |
| Neon expiry | `2026-11-12T23:00:00Z`, recorded through Neon branch TTL |
| Production | **No** Production env var, database, alias or credential changed |

**Post-expiry action:** the temporary Preview variables `DATABASE_URL` and `AUTHZ_CONTEXT_SIGNING_KEY_HEX` must be retired/rotated once the disposable database expires or the PR is closed. Do not leave a stale HMAC or URL configured for a future deployment.

## 3. Preview deployment and Auth0 E2E failure diagnosed

At Git HEAD `a080659c84089ab7074b6642150444aeabeea01f`, Vercel Preview deployment `dpl_AFZem1SZsrJ7mpxGLFord29jMoHm` was **READY** at the exact Git SHA and linked to `iam-control-center-new-ci-preview.vercel.app`. The branch-bound alias's `/api/health` returned HTTP 200 with `authConfigured=true` and `databaseConfigured=true`; this is liveness/configuration only, **not a successful DB connection or Auth0 session check**.

**CI #42953396464:** `quality=PASS`, `preview-deployment=PASS`, `auth0-e2e=FAIL` in the protected environment's `Bind E2E to the verified Preview and callback branch` preflight. The job log shows **actual** `E2E_CALLBACK_BRANCH=fix/proxy-mock-unused-request`, while the PR head and Vercel domain are `feat/iam-api-rbac-lineage-20261110`. Its `E2E_CALLBACK_HOST=iam-control-center-new-ci-preview.vercel.app` is already the correct alias. This failure is deliberate and cannot be called PASS; do not disable the preflight.

**Required protected GitHub setting** (cannot be changed by the connected read-only GitHub settings tool in this chat): repository **Settings → Environments → Preview → Environment variables**, set `AUTH0_E2E_CALLBACK_BRANCH` to `feat/iam-api-rbac-lineage-20261110`. Keep the existing `AUTH0_E2E_CALLBACK_HOST=iam-control-center-new-ci-preview.vercel.app`. Re-run CI on the *exact current PR SHA* and inspect both bind preflight and OIDC/Playwright results.

**Possible subsequent gate:** The Vercel Preview Comments hostname may be the automatic deployment hostname while Auth0 uses the canonical alias. The workflow still requires same-origin `deploymentOrigin.hostname === callbackHost` in the OIDC preflight. If this gate fails, independently verify that the canonical alias points at the **exact same SHA** in Vercel before updating the binding logic. Do not relax host-scoped OIDC header forwarding, accept wildcard callback URLs or claim E2E PASS based on a different SHA.

**Auth0 provider allowlist:** real login against this callback is not independently reverified for the new SHA (previous same-host E2E success is historical). If Auth0 rejects, verify Allowed Callback URLs = `https://iam-control-center-new-ci-preview.vercel.app/auth/callback`, Allowed Logout URLs and Allowed Web Origins for that exact origin using an authorized Auth0 browser session. No wildcard or Production changes.

## 4. Canonical source candidate, not formally approved

The read-only source dump is pinned in `database/baselines/legacy-source-candidate.json`:

- Source Neon `twilight-fire-88497009 / br-little-fire-b6adup9f / iam_database`;
- Git commit `e95b938c889c3d2d45f056f946f2351df68b7823`, file `iam_database_schema.sql`, size **87,885 bytes**;
- Git blob SHA1 `1920b7946c88e624ec224917dc0f7742d2174904`;
- SHA-256 of exact file bytes `4baea93fcbc157b93e62259f32f2439c19c0c53489d2df06de220eec890632cb`;
- structural restore fixture expectation: 23 tables, 41 RLS policies, 20 FORCE RLS tables, one view and nine application routines.

`scripts/verify-canonical-baseline.test.mjs` recalculates SHA-256 and Git blob identity and verifies that the legacy ledger provenance, migration authorization `false`, source/Development drift and six approval requirements are recorded. Test SUCCESS means **integrity of the pinned file and compatibility with the disposable PostgreSQL fixture**, not an independent authenticated export of present-day Neon source.

**Human approval BLOCKED** pending independent reviewer on the baseline, complete provider role/ACL classification, function-body hardening delta (`iam.set_tenant_context` legacy still includes `public` while NEW Development does not), full source/export provenance, signed source-to-restore manifest and recovery/PITR rehearsal. `0001_initial_iam_schema.sql`, `0002_sessions_touch_contract.sql` and `0003_set_tenant_context_search_path.sql` still target incompatible lineages; no new migrator runner should be enabled.

## 5. Gate table

| Gate | State |
|---|---|
| Authenticated server-only HMAC issuer contract with no client proof | **PASS** unit/contract tests; deployment configuration verified |
| Branch-scoped isolated Neon runtime and HMAC secret | **PASS** configured; external DB transaction E2E **BLOCKED** |
| Vercel exact-SHA READY and liveness | **PASS limited** |
| Auth0 real login/callback + RBAC deny E2E on PR #41 SHA | **FAIL** preflight env branch mismatch |
| RBAC positive authorization with real Auth0 identity and controlled grant/revoke | **BLOCKED** |
| Portable source dump byte-level SHA256 and Git blob attestation | **PASS** |
| Formal independent canonical-baseline approval | **BLOCKED** |
| Full migration runner and rollback/PITR | **NOT CONFIGURED / BLOCKED** |
| New Neon Production IAM schema / cutover | **NOT CONFIGURED / BLOCKED** |

This report was prepared without modifying Production or claiming a merge authorization.

## 6. PEOS 2026-11-13 — fixture substituta RBAC/Auth0 no plano gratuito

A antiga fixture `br-shy-scene-b67zm2v7` expirou em 12/11/2026 e foi arquivada pelo Neon.
No teste real [CI #43535594089](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43535594089),
o fluxo Auth0 de login/callback/logout e o TTL da sessão passaram; o RBAC HTTP falhou
**antes de mutações**, na primeira query com `password authentication failed for user 'neondb_owner'`.
A credencial é um bloqueio independente da expiração: não atribuir o erro exclusivamente ao TTL.

Nova child isolada confirmada diretamente no Neon:

| Controle | Valor autorizado para a fixture |
|---|---|
| Projeto | `iam-database-delivery` / `tiny-rice-70320263` |
| Parent | `validation/iam-cutover-audit-20261110` / `br-muddy-bar-b63ksdy7` |
| Child | `validation/pr-41-auth0-rbac-e2e-20261113` / `br-royal-dream-b6di0p2w` |
| Banco | `iam_database`, owner `neondb_owner` |
| Host Direct | `ep-shiny-pond-b6zifpoo.c-2.sa-east-1.aws.neon.tech` |
| Expiração automática | `2026-11-16T23:00:00Z` |
| Isolamento | 23 tabelas, 41 policies, 20 FORCE RLS, uma chave de contexto ativa; fixture reservada 0/6, ledger 0 |

Alterações desta PR sincronizam a allowlist do teste `.github/e2e/auth0-rbac.spec.cjs` com
`E2E_RBAC_BRANCH_ID` em `.github/workflows/quality.yml` e adicionam testes
estáticos para impedir o retorno silencioso ao ID expirado. Não criam nem armazenam
credenciais em Git.

**Ação separada necessária no GitHub → Settings → Environments → Preview → Secrets:**
substituir `NEON_RBAC_TEST_OWNER_DATABASE_URL` por uma **conexão nova, restrita à child**.
Use somente a string Direct gerada para `br-royal-dream-b6di0p2w`, role `neondb_owner`,
DB `iam_database`, SSL habilitado. Nunca reutilize Production, cole senha em issue, commit,
log ou variável não secreta. O E2E deve bloquear na allowlist de host/ID antes de qualquer DML
caso a credential continue antiga, e verificar `current_setting('neon.branch_id',true)` via
SELECT antes de criar a fixture. Verificar depois autorização HTTP 200/403 e cleanup 0.

A proteção de branch Neon é indisponível no plano gratuito desta conta; **não tentar
ativá-la nem exigir upgrade**. Preservar Production via segregação operacional,
branch de teste com TTL, segredos protegidos, GitHub Rulesets e gates fail-closed.
Nenhuma alteração de privilégio, migration, merge ou cutover é autorizada por este registro.
