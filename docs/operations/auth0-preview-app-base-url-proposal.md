# Proposta: configuração de APP_BASE_URL para Preview Auth0

**Status:** proposta revisável; nenhuma variável ou configuração externa foi alterada.  
**Escopo:** Vercel Preview da aplicação IAM Control Center, mantendo Auth0 como IdP.  
**Base de evidência:** código da branch `proposal/neon-vercel-workflow-reconciliation`; metadados Vercel consultados em 2026-11-02 sem descriptografar variáveis; painel Auth0 e documentação oficial do SDK `@auth0/nextjs-auth0` v4.33.0.

## 1. Achados reproduzíveis

O código instancia o SDK Auth0 v4 em `apps/web/src/lib/auth0.ts` e passa:

```ts
appBaseUrl: process.env.APP_BASE_URL!,
```

A asserção TypeScript `!` não valida a existência da variável em runtime. A documentação atual do SDK v4.33.0 informa que `APP_BASE_URL`/`appBaseUrl` é opcional e, quando omitido, a origem pode ser inferida do host da requisição. Portanto, a presença explícita dessa propriedade no código não prova que uma variável Vercel deva obrigatoriamente existir.

A consulta de metadados Vercel (sem descriptografia) confirmou:

- o domínio `iam-control-center-preview.vercel.app` está verificado no projeto `iam-control-center`;
- esse domínio está vinculado exclusivamente à branch `feat/iam-migrator-role-assumption-review`;
- o domínio não é um alias genérico para todos os deployments Preview;
- o deployment mais recente encontrado para essa branch está `READY`, com ID `dpl_EwCLAEen7xEBHYTHrMZBeNXcZM1G`, SHA `55376fa7059b6ddbe20debfbf21a78dd8c04a1e2` e commit `docs: reconcile migrator ownership review with schema preflight`;
- esse deployment confirma a atividade da branch proprietária do domínio, mas não corresponde à branch `proposal/auth0-preview-app-base-url` da PR #67;
- a branch `proposal/auth0-preview-app-base-url` não possui domínio associado;
- existe uma variável `APP_BASE_URL` Preview branch-scoped para `fix/next16-proxy-r2`;
- não há variável Preview genérica;
- não foi possível confirmar o valor da variável branch-scoped porque nenhum valor foi descriptografado.

Não inferir o valor da variável existente nem alterar seu escopo sem uma inspeção segura dos consumidores e do comportamento do deployment.

## 2. Evidência Auth0 disponível

A inspeção do painel da aplicação **IAM Control Center Web** confirmou que as listas de URLs permitidas incluem:

- Callback: `https://iam-control-center-preview.vercel.app/auth/callback`;
- Logout: `https://iam-control-center-preview.vercel.app`;
- Web Origin: `https://iam-control-center-preview.vercel.app`.

Também há entradas para localhost e o domínio canônico de Production. Isso comprova somente o cadastro das URLs no tenant; não comprova login, callback, sessão ou logout E2E.

O allowlist conhecido não demonstra que URLs efêmeras de deployment estejam autorizadas. Não adicionar curingas ou domínios efêmeros ao Auth0 automaticamente.

Não alterar Allowed Callback URLs, Allowed Logout URLs, Allowed Web Origins, client secret, sessão, consentimento ou qualquer outra configuração Auth0 nesta proposta.

## 3. Decisão técnica recomendada

**Não criar uma variável `APP_BASE_URL` Preview genérica.** O domínio canônico está vinculado a uma única branch, logo uma origem fixa genérica poderia direcionar vários deployments Preview para o deployment de outra branch.

Para a validação Auth0, usar o domínio canônico somente no deployment da branch à qual ele está efetivamente vinculado:

`feat/iam-migrator-role-assumption-review` → `https://iam-control-center-preview.vercel.app`

A documentação oficial do SDK v4.33.0 permite omitir `APP_BASE_URL` e inferir a origem do host da requisição. Essa opção evita fixar a origem de um deployment efêmero. O Auth0 ainda precisa reconhecer a URL de callback resultante; portanto, o E2E deve ocorrer pelo domínio canônico já cadastrado, não pela URL aleatória do deployment.

| Item | Decisão |
|---|---|
| Vercel Project | `iam-control-center` |
| Domínio Preview canônico | `https://iam-control-center-preview.vercel.app` |
| Branch proprietária do domínio | `feat/iam-migrator-role-assumption-review` |
| Preview genérico `APP_BASE_URL` | Não recomendado |
| APP_BASE_URL para PR #67 | Não configurar; domínio não está vinculado à branch |
| APP_BASE_URL branch-scoped existente | Preservar até verificar consumidor e valor sem expor segredo |
| Development | Manter localhost; nenhuma alteração |
| Production | Nenhuma alteração |

Se futuramente houver necessidade comprovada de fixar `APP_BASE_URL`, fazê-lo somente na branch que recebe o domínio correspondente e após confirmar o valor esperado. Não usar uma variável genérica para domínios que não compartilham o mesmo destino.

## 4. Compatibilidade SDK v4.33.0 com Next.js 16

A inspeção do código identificou:

- `apps/web/package.json`: Next.js `16.4.3` e `@auth0/nextjs-auth0` `^4.33.0`;
- `apps/web/src/middleware.ts`: exporta `middleware(request: NextRequest)` e chama `auth0.middleware(request)`;
- não foi encontrado `apps/web/src/proxy.ts` na branch inspecionada.

A documentação oficial atual do SDK recomenda a convenção `proxy.ts` no Next.js 16. Ela informa que `middleware.ts` continua compatível por retrocompatibilidade no runtime Edge, mas está depreciado para o runtime Node e será removido em versão futura.

Isso é uma pendência técnica separada da variável `APP_BASE_URL`. Não alterar o código nesta proposta documental. Antes de qualquer E2E, reconciliar a convenção `proxy.ts` com a PR de migração Next.js 16 já existente, evitando mudanças duplicadas ou conflitantes.

## 4.1 Reconciliação da implementação Proxy e do harness E2E existente

A auditoria de branches identificou uma implementação Next.js 16 já existente em `fix/next16-proxy-r2`:

- `apps/web/src/proxy.ts` delega `Request` para `auth0.middleware(request)` (blob SHA `731f7e40235fc2ac1033a43c01672afed30815e1`);
- `apps/web/src/proxy.test.ts` testa delegação e matcher (blob SHA `243930e6ea0903d23ee56703f2ce4a7557689f15`);
- `.github/e2e/auth0.spec.cjs` cobre login, callback, sessão persistente e logout (blob SHA `b2c3b5394c8c8f1d1f`);
- `.github/workflows/quality.yml` nessa branch contém job `auth0-e2e`, condicionado a `vars.AUTH0_E2E_ENABLED == 'true'`.

A comparação entre `proposal/neon-vercel-workflow-reconciliation` (base SHA `7de15f57297d14296e6a24fc89b5ea6b86dc1aaa`) e `fix/next16-proxy-r2` retornou `diverged`, com 30 commits à frente e 5 atrás. Portanto, a implementação não deve ser integrada por merge/cherry-pick cego; a cadeia de PRs e os contratos precisam ser reconciliados primeiro.

**Bloqueio E2E identificado:** o workflow dessa branch define `E2E_BASE_URL=https://iam-control-center-preview.vercel.app`, mas a consulta atual ao Vercel mostra que esse domínio está vinculado à branch `feat/iam-migrator-role-assumption-review`, não a `fix/next16-proxy-r2`. Assim, executar o job com essa URL não provaria que o código da branch testada está publicado. Além disso, o workflow da branch desta proposta (`proposal/auth0-preview-app-base-url`) contém somente `quality` e `preview-deployment`; não contém o job `auth0-e2e`.

A implementação E2E existente usa secrets `AUTH0_E2E_USERNAME` e `AUTH0_E2E_PASSWORD`, variável `AUTH0_E2E_ENABLED` e token GitHub Actions OIDC para Vercel Trusted Sources. Nenhum valor secreto foi lido. O README afirma que o fluxo não cobre autorização IAM, RBAC, isolamento multi-tenant ou RLS.

**Decisão:** não habilitar `AUTH0_E2E_ENABLED` nem declarar E2E PASS até que (1) a branch proprietária do domínio seja alinhada à branch/commit sob teste, (2) o workflow e a cadeia de PRs sejam reconciliados, e (3) a execução real seja observada no SHA exato.

## 5. Plano de validação após aprovação

1. Confirmar que a branch `feat/iam-migrator-role-assumption-review` continua sendo a destinatária do domínio canônico.
2. Verificar se a variável `APP_BASE_URL` branch-scoped existente para `fix/next16-proxy-r2` possui consumidor e valor coerentes, sem imprimir ou registrar valores secretos.
3. Confirmar que o deployment canônico usa a branch e o SHA esperados.
4. Reconciliar `middleware.ts` versus `proxy.ts` com a implementação Next.js 16.
5. Validar resposta HTTP e redirecionamento de `/auth/login` para o tenant Auth0 correto.
6. Concluir login com conta de teste autorizada e verificar retorno ao callback canônico.
7. Verificar sessão server-side sem registrar tokens, cookies ou dados sensíveis.
8. Executar logout e confirmar retorno ao destino esperado.
9. Testar falhas: callback inválido, state/nonce inválido, sessão ausente e configuração ausente.
10. Registrar evidências por deployment ID, branch, SHA, horário e resultado redigido.

O teste E2E deve usar conta de teste e não deve expor authorization code, access token, ID token, refresh token, cookie ou client secret nos logs/artefatos.

## 6. Critérios de aceite

- [ ] Domínio canônico e branch de destino confirmados no Vercel.
- [ ] Variável Preview branch-scoped existente inventariada sem expor valor.
- [ ] Decisão de não usar APP_BASE_URL Preview genérica registrada.
- [ ] Compatibilidade `proxy.ts`/Next.js 16 reconciliada.
- [ ] Login, callback, sessão e logout E2E passam no domínio canônico.
- [ ] Testes negativos de callback/sessão passam.
- [ ] CI e deployment correspondem ao SHA exato.
- [ ] Evidências anexadas sem tokens, cookies ou secrets.
- [ ] Production permanece inalterada.

## 7. Limites e rollback

Esta proposta não altera Vercel, Auth0, Neon, GitHub Environments, secrets ou código de autenticação. Não habilita Neon Auth; Auth0 permanece como provedor de identidade.

Antes de uma alteração futura, registrar somente metadados não secretos da variável anterior (target, gitBranch, comentário e existência). Se uma mudança Preview for aprovada e falhar, reverter somente a configuração Preview alterada, reimplantar a branch afetada e confirmar o retorno ao estado anterior. Não alterar Production como tentativa de correção.

## 8. Estado atual

| Controle | Estado |
|---|---|
| SDK Auth0 v4 recebe `APP_BASE_URL` no construtor | PASS — inspeção do código |
| SDK v4.33.0 permite inferir host sem APP_BASE_URL | PASS — documentação oficial |
| Domínio Preview canônico verificado | PASS — metadados Vercel |
| Branch proprietária do domínio identificada | PASS — `feat/iam-migrator-role-assumption-review` |
| Domínio canônico vinculado à branch da PR #67 | FAIL — consulta Vercel retornou zero domínios |
| APP_BASE_URL Preview genérica | NOT CONFIGURED — manter assim |
| Valor da variável Preview branch-scoped existente | NOT VERIFIED — descriptografia não realizada |
| Branch base desta proposta usa `proxy.ts` | FAIL — contém `middleware.ts`; implementação alternativa já existe em `fix/next16-proxy-r2` |
| Implementação `proxy.ts` na branch `fix/next16-proxy-r2` | PASS — arquivo e teste unitário inspecionados |
| Branch `fix/next16-proxy-r2` reconciliada com a base desta proposta | BLOCKED — comparação divergiu: 30 commits à frente e 5 atrás |
| Workflow E2E testa a branch que possui o domínio canônico | FAIL — URL fixa aponta para domínio vinculado a outra branch |
| Job `auth0-e2e` disponível na branch da PR #67 | NOT CONFIGURED — workflow contém somente quality e preview-deployment |
| Login/callback/logout E2E | NOT RUN |
| Alterações externas executadas | NONE |

## 9. Referências oficiais

- [Auth0 Next.js SDK v4.33.0 — documentação](https://auth0.github.io/nextjs-auth0/)
- [Auth0 Next.js SDK — V4 Migration Guide](https://github.com/auth0/nextjs-auth0/blob/main/V4_MIGRATION_GUIDE.md)
- [Auth0 — Next.js 16 e autenticação](https://auth0.com/blog/handling-auth-nextjs16-with-server-actions-middleware/)

**Conclusão:** não aplicar `APP_BASE_URL` Preview genérica. O domínio canônico é branch-scoped no Vercel e o SDK v4.33.0 pode inferir o host quando a variável é omitida. O próximo gate é reconciliar o proxy Next.js 16 e executar o E2E exclusivamente pelo domínio canônico/branch proprietária. Nenhuma alteração externa foi autorizada ou executada.
